import { useMemo, useRef, useState } from 'react';

import { formatKronor, kronorString, type Ore } from '../../domain/belopp/ore';
import {
  allaLov,
  BESLUTSTRAD,
  BETALSATTSNAMN,
  lovMallId,
  lovTillMall,
  momsForLov,
  stigTill,
  type Hanvisning,
  type Lov,
  type Momssats,
  type Nod,
} from '../../domain/beslutstrad/beslutstrad';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import {
  delaMedUnderlag,
  sokMallar,
  tillampaMall,
  type Konteringsmall,
} from '../../domain/mall/konteringsmall';
import type { Uuid } from '../../domain/id/uuidv7';
import { datum, type Datum } from '../../domain/tid/datum';
import type { Kontering } from '../../domain/verifikat/verifikat';
import type { Kvittoforslag } from '../../domain/underlag/kvittotolkning';
import { formatKronor as visaKronor } from '../../domain/belopp/ore';
import {
  kurs,
  kursText,
  tillRedovisningsvaluta,
  valutakod,
} from '../../domain/belopp/valuta';
import { Beloppsfalt, tolkaBelopp, visaBelopp } from './Beloppsfalt';
import type { Friforslag } from './FriKontering';
import { Beskar } from '../underlag/Beskar';
import { Underlagsvisning } from '../../ui/Underlagsvisning';
import type { Forberedelse } from '../../platform/bild';

interface Props {
  readonly idag: Datum;
  /** How often each leaf has been booked, counted from the event log. */
  readonly anvandning: ReadonlyMap<Uuid, number>;
  /**
   * The account to start on, when the caller knows which one it was.
   *
   * A line from the company account's own statement was paid from the company
   * account; nothing else is possible. Used whenever the chosen leaf offers
   * it, so the choice stays the person's afterwards.
   */
  readonly forvaltBetalkonto?: Kontonummer;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /**
   * The receipt this booking is for, when it started from one.
   *
   * Shown throughout, because a picture is what someone recognises the
   * purchase by - the amount and the date are what they are about to type,
   * not what they remember.
   */
  readonly underlag?: {
    readonly filnamn: string;
    readonly url: string;
    readonly mime: string;
    /** What OCR read, shown on request so a wrong suggestion can be explained. */
    readonly text?: string;
  };
  readonly onSlappUnderlag?: () => void;
  /**
   * Stores a receipt photographed from inside the form and starts reading it.
   *
   * The other direction from the Kvitton screen, and the one that fits a
   * purchase made at a counter: pick what it was, photograph the receipt,
   * accept what it read, book. Nothing is stored until the crop is done, and
   * the picture is stored before it is read - the evidence is safe even if
   * the booking is abandoned.
   */
  readonly onFotografera?: (fil: File, forberedelse?: Forberedelse) => Promise<void>;
  /** What OCR read out of the receipt, once it has read it. */
  readonly forslag?: Kvittoforslag;
  /** The leaf the receipt's own words point at, when they point at one. */
  readonly foreslagetLov?: Lov;
  readonly ocrLaser?: boolean;
  readonly ocrFel?: string;
  /** This year's halvt prisbasbelopp, for the question that needs it. */
  readonly halvtPrisbasbelopp?: { readonly ar: number; readonly belopp: Ore };
  /** Opens the free posting, for what no answer fits. */
  readonly onFriKontering?: () => void;
  /** Opens the free posting with this booking's rows filled in. */
  readonly onAndraKontering?: (start: Friforslag) => void;
  /** Goes to the screen a leaf says the thing is done on. */
  readonly onHanvisning: (till: Hanvisning['till']) => void;
  readonly onBokfor: (val: {
    mall: Konteringsmall;
    brutto: Ore;
    betalkonto: Kontonummer;
    datum: Datum;
    beskrivning: string;
    konteringar: readonly Kontering[];
  }) => Promise<void>;
}

/**
 * The words for each direction.
 *
 * An income is not paid, it is received, and a form that says "Att betala"
 * over money coming in is simply wrong. A leaf that moves money says its own.
 */
const ORD = {
  utgift: { belopp: 'Att betala', konto: 'Betalat med' },
  inkomst: { belopp: 'Att få in', konto: 'Insatt på' },
} as const;

/** How many of the most used leaves are offered before the first question. */
const GENVAGAR = 4;

/**
 * Booking an entry: what happened, how much, paid how.
 *
 * What it was is found by answering a few questions - money out, money in,
 * money moved, moms - or by searching, and the leaf the answers lead to
 * carries the account, the moms and the ways it can have been paid. Nothing
 * here asks for an account number, but the posting is always one tap away
 * and can be changed before booking, since hard rule 10 makes this a
 * suggestion the person approves rather than an automatic booking.
 */
export function BokforUtgift({
  idag,
  anvandning,
  forvaltBetalkonto,
  konton,
  underlag,
  onSlappUnderlag,
  onFotografera,
  forslag,
  foreslagetLov,
  ocrLaser,
  ocrFel,
  halvtPrisbasbelopp,
  onBokfor,
  onFriKontering,
  onAndraKontering,
  onHanvisning,
}: Props) {
  const [sok, setSok] = useState('');
  /** The answers given so far, as indices from the first question. */
  const [stig, setStig] = useState<readonly number[]>([]);
  const [valtLovId, setValtLovId] = useState<string | undefined>();
  /** The rate picked where a leaf lets the receipt decide. */
  const [momsval, setMomsval] = useState<Momssats | undefined>();
  const [belopp, setBelopp] = useState('');
  /*
   * Today by default, because most entries are made on the day it happened.
   * But a field rather than an assumption: a booked verifikat cannot be
   * edited, so a wrong date costs an annulment and a re-entry.
   */
  const [datumtext, setDatumtext] = useState<string>(idag);
  /*
   * Prefilled with the leaf's name and editable. Bokföringslagen 5 kap. 7 §
   * wants a verifikation to say what the affärshändelse avser.
   */
  const [beskrivning, setBeskrivning] = useState('');
  const [betalkonto, setBetalkonto] = useState<Kontonummer | undefined>(
    forvaltBetalkonto,
  );
  const [sparar, setSparar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();
  const [visaKontering, setVisaKontering] = useState(false);
  /*
   * A receipt in another currency. Bokföringslagen 4 kap. 6 §: the books are
   * kept in kronor, so the amount is converted on the way in - and the rate
   * that was used is written into the description.
   */
  const [valuta, setValuta] = useState('');
  const [valutabelopp, setValutabelopp] = useState('');
  const [kurstext, setKurstext] = useState('');
  const [visaValuta, setVisaValuta] = useState(false);
  /*
   * The VAT the underlag states, when it states one that differs from the
   * leaf's own arithmetic. It belongs to the amount it was read with, so
   * changing the amount or the leaf drops it.
   */
  const [kvittomoms, setKvittomoms] = useState<Ore | undefined>();
  const [beskar, setBeskar] = useState<{ fil: File; url: string } | undefined>();
  const kamera = useRef<HTMLInputElement>(null);

  const lov = useMemo(() => allaLov(), []);
  /*
   * Every leaf as a template at the rate it proposes today, which is what
   * search ranks. The rate a booking uses is worked out again from its date.
   */
  const sokbara = useMemo(
    () => lov.map((kandidat) => lovTillMall(kandidat, momsForLov(kandidat, idag).sats)),
    [lov, idag],
  );
  const traffar = useMemo(
    () =>
      sok.trim() === ''
        ? []
        : sokMallar(sokbara, sok, anvandning)
            .slice(0, 8)
            .map((mall) => lov.find((kandidat) => lovMallId(kandidat.id) === mall.id)!),
    [sokbara, sok, anvandning, lov],
  );
  const genvagar = useMemo(
    () =>
      lov
        .map((kandidat) => ({
          lov: kandidat,
          antal: anvandning.get(lovMallId(kandidat.id)) ?? 0,
        }))
        .filter((post) => post.antal > 0)
        .sort((a, b) => b.antal - a.antal || a.lov.namn.localeCompare(b.lov.namn, 'sv'))
        .slice(0, GENVAGAR)
        .map((post) => post.lov),
    [lov, anvandning],
  );

  const vald = lov.find((kandidat) => kandidat.id === valtLovId);
  const valtDatum = giltigtDatum(datumtext);
  const moms = vald === undefined ? undefined : momsForLov(vald, valtDatum ?? idag);
  const sats =
    moms === undefined ? undefined : moms.valbar ? (momsval ?? moms.sats) : moms.sats;
  const mall =
    vald === undefined || sats === undefined ? undefined : lovTillMall(vald, sats);
  const aktivtBetalkonto =
    vald === undefined
      ? undefined
      : betalkonto !== undefined && vald.betalsatt.includes(betalkonto)
        ? betalkonto
        : vald.betalsatt[0];

  const vaxling = raknaOm(valuta, valutabelopp, kurstext);
  /*
   * In currency mode the amount in kronor is derived rather than typed. Two
   * fields that must agree is one field too many.
   */
  const brutto = visaValuta ? vaxling?.sek : tolkaBelopp(belopp);
  const konteringar = (() => {
    if (mall === undefined || brutto === undefined || aktivtBetalkonto === undefined) {
      return undefined;
    }
    try {
      return tillampaMall(mall, {
        brutto,
        betalkonto: aktivtBetalkonto,
        ...(kvittomoms === undefined ? {} : { moms: kvittomoms }),
      });
    } catch {
      // A receipt's moms that cannot belong to the amount; the split line says so.
      return undefined;
    }
  })();

  const kanBokfora =
    konteringar !== undefined &&
    brutto !== 0 &&
    valtDatum !== undefined &&
    beskrivning.trim().length > 0 &&
    !sparar;

  function valjLov(nytt: Lov) {
    setValtLovId(nytt.id);
    setKvittomoms(undefined);
    setMomsval(undefined);
    setBeskrivning(nytt.namn);
    setBetalkonto(
      forvaltBetalkonto !== undefined && nytt.betalsatt.includes(forvaltBetalkonto)
        ? forvaltBetalkonto
        : nytt.betalsatt[0],
    );
  }

  /**
   * Puts the receipt's figures into the fields.
   *
   * A button rather than something that happens by itself. Hard rule 10:
   * OCR proposes and the person accepts.
   */
  function fyllFranKvitto() {
    if (forslag === undefined && foreslagetLov === undefined) {
      return;
    }

    /*
     * The leaf is only chosen when none is - picking one is the answer to
     * "what is this", and the receipt has no business overruling someone who
     * has already answered.
     */
    if (foreslagetLov !== undefined && valtLovId === undefined) {
      valjLov(foreslagetLov);
      setBeskrivning(forslag?.leverantor ?? foreslagetLov.namn);
    } else if (forslag?.leverantor !== undefined && beskrivning.trim().length === 0) {
      setBeskrivning(forslag.leverantor);
    }

    if (forslag?.brutto !== undefined) {
      setBelopp(kronorString(forslag.brutto).replace('.', ','));
      /*
       * The VAT comes along with the amount it was read beside, and only if
       * it can belong to it - a misread that made the VAT larger than the
       * purchase is dropped rather than booked.
       */
      setKvittomoms(
        forslag.moms !== undefined && forslag.moms >= 0 && forslag.moms < forslag.brutto
          ? forslag.moms
          : undefined,
      );
    }
    if (forslag?.datum !== undefined) {
      setDatumtext(forslag.datum);
    }
  }

  /** Runs a step that can fail, and shows the failure where the form does. */
  async function kor(uppgift: () => Promise<void>): Promise<void> {
    setSparar(true);
    setFel(undefined);
    try {
      await uppgift();
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setSparar(false);
    }
  }

  function fullBeskrivning(): string {
    return vaxling === undefined || !visaValuta
      ? beskrivning.trim()
      : `${beskrivning.trim()} (${vaxling.text})`;
  }

  async function bokfor() {
    if (
      mall === undefined ||
      brutto === undefined ||
      aktivtBetalkonto === undefined ||
      valtDatum === undefined ||
      konteringar === undefined
    ) {
      return;
    }
    setSparar(true);
    setFel(undefined);
    try {
      await onBokfor({
        mall,
        brutto,
        betalkonto: aktivtBetalkonto,
        datum: valtDatum,
        beskrivning: fullBeskrivning(),
        konteringar,
      });
      setValtLovId(undefined);
      setStig([]);
      setSok('');
      setMomsval(undefined);
      setBelopp('');
      setDatumtext(idag);
      setBeskrivning('');
      setValuta('');
      setValutabelopp('');
      setKurstext('');
      setVisaValuta(false);
      setKvittomoms(undefined);
      setVisaKontering(false);
    } catch (orsak) {
      // Hard rule 11: this is shown, not logged and swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setSparar(false);
    }
  }

  if (vald === undefined || mall === undefined || moms === undefined) {
    const nod = folj(stig);
    return (
      <section aria-label="Vad har hänt?">
        {underlag !== undefined && (
          <Underlagskort
            underlag={underlag}
            laser={ocrLaser}
            fel={ocrFel}
            onSlapp={onSlappUnderlag}
          />
        )}

        <Forslagsknapp
          forslag={forslag}
          namn={foreslagetLov?.namn}
          onFyllI={fyllFranKvitto}
        />

        {stig.length === 0 && sok.trim() === '' && genvagar.length > 0 && (
          <div className="faltgrupp">
            <span className="listrad__sekundar">Brukar du bokföra</span>
            <div className="segment" data-testid="genvagar">
              {genvagar.map((kandidat) => (
                <button key={kandidat.id} type="button" onClick={() => valjLov(kandidat)}>
                  {kandidat.namn}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="faltgrupp">
          <label htmlFor="lovsok">Sök</label>
          <input
            id="lovsok"
            className="falt"
            type="search"
            autoComplete="off"
            placeholder="Till exempel foder, diesel eller lamm"
            value={sok}
            onChange={(handelse) => setSok(handelse.target.value)}
          />
        </div>

        {sok.trim() !== '' ? (
          traffar.length === 0 ? (
            <p className="tomt" data-testid="inga-traffar">
              Inget matchar ”{sok}”. Svara på frågorna i stället, eller kontera fritt.
            </p>
          ) : (
            <ul className="lista" data-testid="sokresultat">
              {traffar.map((kandidat) => (
                <li key={kandidat.id}>
                  <Lovknapp
                    lov={kandidat}
                    text={kandidat.namn}
                    under={(stigTill(kandidat.id) ?? []).join(' › ')}
                    konton={konton}
                    idag={idag}
                    onValj={valjLov}
                  />
                </li>
              ))}
            </ul>
          )
        ) : (
          <Tradsteg
            nod={nod}
            stig={stig}
            konton={konton}
            idag={idag}
            halvtPrisbasbelopp={halvtPrisbasbelopp}
            onSvar={(index, till) =>
              till.typ === 'lov' ? valjLov(till) : setStig([...stig, index])
            }
            onTillbaka={() => setStig(stig.slice(0, -1))}
            onHanvisning={onHanvisning}
          />
        )}

        {onFriKontering !== undefined && (
          <p>
            <button
              type="button"
              className="knapp knapp--text"
              data-testid="till-fri-kontering"
              onClick={onFriKontering}
            >
              Passar inget? Kontera fritt
            </button>
          </p>
        )}
      </section>
    );
  }

  if (beskar !== undefined) {
    return (
      <Beskar
        fil={beskar.fil}
        url={beskar.url}
        filnamn={beskar.fil.name}
        onKlar={(forberedelse) => {
          const bild = beskar;
          setBeskar(undefined);
          URL.revokeObjectURL(bild.url);
          void kor(() => onFotografera?.(bild.fil, forberedelse) ?? Promise.resolve());
        }}
        onAvbryt={() => {
          URL.revokeObjectURL(beskar.url);
          setBeskar(undefined);
        }}
      />
    );
  }

  const delar = (() => {
    if (brutto === undefined) {
      return undefined;
    }
    try {
      return delaMedUnderlag(mall, brutto, kvittomoms);
    } catch {
      return undefined;
    }
  })();
  const ord = vald.ord ?? ORD[vald.riktning];

  return (
    <section aria-label={`Bokför ${vald.namn}`}>
      {underlag !== undefined && (
        <Underlagskort
          underlag={underlag}
          laser={ocrLaser}
          fel={ocrFel}
          onSlapp={onSlappUnderlag}
        />
      )}

      {onFotografera !== undefined && underlag === undefined && (
        <>
          <input
            ref={kamera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            data-testid="fotografera-underlag"
            onChange={(handelse) => {
              const fil = handelse.target.files?.[0];
              if (kamera.current !== null) {
                // Cleared so the same picture can be taken again.
                kamera.current.value = '';
              }
              if (fil !== undefined) {
                setBeskar({ fil, url: URL.createObjectURL(fil) });
              }
            }}
          />
          <p>
            <button
              type="button"
              className="knapp"
              disabled={sparar}
              onClick={() => kamera.current?.click()}
            >
              Fotografera underlag
            </button>
          </p>
        </>
      )}

      <Forslagsknapp forslag={forslag} namn={undefined} onFyllI={fyllFranKvitto} />

      <div className="kort" data-testid="valt-lov">
        <span className="listrad__text">
          <strong>{vald.namn}</strong>
          <span className="listrad__sekundar">
            {vald.konto} {konton.get(vald.konto)?.namn ?? ''}
          </span>
          {vald.ledtext !== undefined && (
            <span className="listrad__sekundar" data-testid="ledtext">
              {vald.ledtext}
            </span>
          )}
        </span>
        <button
          type="button"
          className="knapp knapp--text"
          onClick={() => setValtLovId(undefined)}
        >
          Byt
        </button>
      </div>

      {visaValuta ? (
        <div className="faltgrupp" data-testid="valutafalt">
          <label htmlFor="valuta">Valuta</label>
          <input
            id="valuta"
            className="falt"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="EUR"
            value={valuta}
            onChange={(handelse) => setValuta(handelse.target.value)}
          />

          <label htmlFor="valutabelopp">Belopp i valutan</label>
          <input
            id="valutabelopp"
            className="falt falt--belopp"
            inputMode="decimal"
            autoComplete="off"
            value={valutabelopp}
            onChange={(handelse) => setValutabelopp(handelse.target.value)}
          />

          <label htmlFor="kurs">Kurs, kronor per enhet</label>
          <input
            id="kurs"
            className="falt falt--belopp"
            inputMode="decimal"
            autoComplete="off"
            placeholder="11,4523"
            value={kurstext}
            onChange={(handelse) => setKurstext(handelse.target.value)}
          />

          <p data-testid="omraknat">
            {vaxling === undefined
              ? 'Fyll i valuta, belopp och kurs.'
              : `${ord.belopp}: ${visaKronor(vaxling.sek)}`}
          </p>
        </div>
      ) : (
        <Beloppsfalt
          varde={belopp}
          onChange={(nytt) => {
            setBelopp(nytt);
            // The receipt's VAT belonged to the amount it was read with.
            setKvittomoms(undefined);
          }}
          etikett={ord.belopp}
          fokusera
        />
      )}

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          data-testid="vaxla-valuta"
          onClick={() => setVisaValuta(!visaValuta)}
        >
          {visaValuta ? 'Beloppet är i kronor' : 'Beloppet är i annan valuta'}
        </button>
      </p>

      <div className="faltgrupp">
        <label htmlFor="beskrivning">Vad avser det?</label>
        <input
          id="beskrivning"
          className="falt"
          type="text"
          autoComplete="off"
          value={beskrivning}
          onChange={(handelse) => setBeskrivning(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="datum">Datum</label>
        <input
          id="datum"
          className="falt"
          type="date"
          max={idag}
          value={datumtext}
          onChange={(handelse) => setDatumtext(handelse.target.value)}
        />

        {/*
         * A date that was not read leaves today's standing in the field, and
         * today looks exactly like an answer. On a receipt photographed weeks
         * after the purchase that is the wrong month, and the wrong month is
         * the wrong momsdeklaration - so the silence is said out loud.
         */}
        {underlag !== undefined &&
          forslag !== undefined &&
          forslag.datum === undefined && (
            <p className="hjalptext" data-testid="datum-olast">
              Datumet gick inte att läsa ur underlaget. Kontrollera det.
            </p>
          )}
      </div>

      {moms.valbar ? (
        <div className="faltgrupp">
          <label htmlFor="momsval">Moms</label>
          <div className="segment" id="momsval" data-testid="momsval">
            {([25, 12, 6, 0] as const).map((kandidat) => (
              <button
                key={kandidat}
                type="button"
                aria-pressed={sats === kandidat}
                onClick={() => {
                  setMomsval(kandidat);
                  setKvittomoms(undefined);
                }}
              >
                {kandidat === 0 ? 'Ingen' : `${kandidat} %`}
              </button>
            ))}
          </div>
          {moms.hjalp !== undefined && (
            <span className="listrad__sekundar">{moms.hjalp}</span>
          )}
        </div>
      ) : (
        <p className="hjalptext" data-testid="momsbesked">
          {moms.sats === 0 ? 'Ingen moms.' : `${moms.sats} % moms.`}
          {moms.hjalp === undefined ? '' : ` ${moms.hjalp}`}
        </p>
      )}

      {vald.betalsatt.length > 1 ? (
        <div className="faltgrupp">
          <label htmlFor="betalsatt">{ord.konto}</label>
          <div className="segment" id="betalsatt">
            {vald.betalsatt.map((konto) => (
              <button
                key={konto}
                type="button"
                aria-pressed={aktivtBetalkonto === konto}
                onClick={() => setBetalkonto(konto)}
              >
                {BETALSATTSNAMN.get(konto) ?? konto}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="hjalptext">
          {ord.konto}: {BETALSATTSNAMN.get(vald.betalsatt[0]!) ?? vald.betalsatt[0]}
        </p>
      )}

      {delar !== undefined && delar.moms !== 0 && (
        <p data-testid="momsdelning">
          Varav moms {visaBelopp(delar.moms)}, netto {visaBelopp(delar.netto)}.
          {kvittomoms !== undefined && ' Momsen är hämtad från underlaget.'}
        </p>
      )}

      {/*
       * The underlag states no moms where the leaf says there is some. Hard
       * rule 11: the disagreement is said out loud instead of leaving a
       * booking that looks finished and quietly deducts nothing - a card
       * terminal's "Varav moms: 0,00" printed under the real summary is
       * enough to cause it, and the cost is not discovered until the
       * momsdeklaration.
       */}
      {kvittomoms === 0 &&
        delar !== undefined &&
        delar.moms === 0 &&
        mall.momssats > 0 && (
          <p role="alert" data-testid="momsdelning-noll">
            Underlaget anger 0 kr moms, så hela {visaBelopp(delar.brutto)} bokförs som
            kostnad och ingenting dras av som ingående moms.{' '}
            <button
              type="button"
              className="knapp knapp--text"
              data-testid="rakna-ut-momsen"
              onClick={() => setKvittomoms(undefined)}
            >
              Räkna ut momsen från {mall.momssats} % i stället
            </button>
          </p>
        )}

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          aria-expanded={visaKontering}
          onClick={() => setVisaKontering((visas) => !visas)}
        >
          {visaKontering ? 'Dölj konteringen' : 'Visa konteringen'}
        </button>
        {onAndraKontering !== undefined && (
          <button
            type="button"
            className="knapp knapp--text"
            data-testid="andra-kontering"
            disabled={konteringar === undefined}
            onClick={() =>
              konteringar !== undefined &&
              onAndraKontering({
                datum: valtDatum ?? idag,
                beskrivning: fullBeskrivning(),
                konteringar,
                mall: mall.id,
              })
            }
          >
            Ändra konteringen
          </button>
        )}
      </p>

      {visaKontering && konteringar !== undefined && (
        <ul className="lista" data-testid="kontering">
          {konteringar.map((rad, index) => (
            <li key={`${rad.konto}-${index}`}>
              <div className={`listrad listrad--${rad.belopp < 0 ? 'kredit' : 'debet'}`}>
                <span className="listrad__text">
                  <span>{rad.konto}</span>
                  <span className="listrad__sekundar">
                    {konton.get(rad.konto)?.namn ?? ''}
                  </span>
                </span>
                <span className={`belopp${rad.belopp < 0 ? ' belopp--negativ' : ''}`}>
                  {formatKronor(rad.belopp)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="bokfor-fel">
          {fel}
        </p>
      )}

      <p>
        <button
          type="button"
          className="knapp knapp--primar"
          disabled={!kanBokfora}
          onClick={() => void bokfor()}
        >
          {sparar ? 'Bokför …' : 'Bokför'}
        </button>
      </p>
    </section>
  );
}

/** The node the answers so far lead to. */
function folj(stig: readonly number[]): Nod {
  let nod: Nod = BESLUTSTRAD;
  for (const index of stig) {
    if (nod.typ !== 'fraga' || nod.svar[index] === undefined) {
      return BESLUTSTRAD;
    }
    nod = nod.svar[index].till;
  }
  return nod;
}

/**
 * One question and its answers, or the screen a leaf points to.
 */
function Tradsteg({
  nod,
  stig,
  konton,
  idag,
  halvtPrisbasbelopp,
  onSvar,
  onTillbaka,
  onHanvisning,
}: {
  readonly nod: Nod;
  readonly stig: readonly number[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly idag: Datum;
  readonly halvtPrisbasbelopp: { readonly ar: number; readonly belopp: Ore } | undefined;
  readonly onSvar: (index: number, till: Nod) => void;
  readonly onTillbaka: () => void;
  readonly onHanvisning: (till: Hanvisning['till']) => void;
}) {
  const tillbaka = stig.length > 0 && (
    <p>
      <button
        type="button"
        className="knapp knapp--text"
        data-testid="tradsteg-tillbaka"
        onClick={onTillbaka}
      >
        Tillbaka
      </button>
    </p>
  );

  if (nod.typ === 'hanvisning') {
    return (
      <div data-testid="hanvisning">
        <p className="kort">{nod.text}</p>
        <p>
          <button
            type="button"
            className="knapp knapp--primar"
            data-testid={`hanvisning-${nod.till}`}
            onClick={() => onHanvisning(nod.till)}
          >
            Gå dit
          </button>
        </p>
        {tillbaka}
      </div>
    );
  }

  if (nod.typ === 'lov') {
    return null;
  }

  return (
    <div data-testid="tradfraga">
      <h2>{nod.fraga}</h2>
      {nod.hjalp !== undefined && <p className="hjalptext">{nod.hjalp}</p>}
      {nod.visaHalvtPrisbasbelopp === true && halvtPrisbasbelopp !== undefined && (
        <p className="hjalptext" data-testid="halvt-prisbasbelopp">
          Ett halvt prisbasbelopp är {visaBelopp(halvtPrisbasbelopp.belopp)} för{' '}
          {halvtPrisbasbelopp.ar}.
        </p>
      )}
      <ul className="lista" data-testid="svar">
        {nod.svar.map((svar, index) => (
          <li key={svar.text}>
            {svar.till.typ === 'lov' ? (
              <Lovknapp
                lov={svar.till}
                text={svar.text}
                konton={konton}
                idag={idag}
                onValj={() => onSvar(index, svar.till)}
              />
            ) : (
              <button
                type="button"
                className="listrad"
                onClick={() => onSvar(index, svar.till)}
              >
                <span className="listrad__text">
                  <span>{svar.text}</span>
                </span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {tillbaka}
    </div>
  );
}

/** An answer that books something: what it is, and where it lands. */
function Lovknapp({
  lov,
  text,
  under,
  konton,
  idag,
  onValj,
}: {
  readonly lov: Lov;
  readonly text: string;
  readonly under?: string;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly idag: Datum;
  readonly onValj: (lov: Lov) => void;
}) {
  const moms = momsForLov(lov, idag);
  return (
    <button type="button" className="listrad" onClick={() => onValj(lov)}>
      <span className="listrad__text">
        <span>{text}</span>
        <span className="listrad__sekundar">
          {under === undefined || under === '' ? '' : `${under} · `}
          {konton.get(lov.konto)?.namn ?? lov.konto}
          {moms.valbar ? '' : moms.sats > 0 ? ` · ${moms.sats} % moms` : ' · momsfritt'}
        </span>
      </span>
    </button>
  );
}

/** The date if the field holds one, undefined while it is being edited. */
function giltigtDatum(text: string): Datum | undefined {
  try {
    return datum(text);
  } catch {
    return undefined;
  }
}

/**
 * The one-tap offer, spelled out.
 *
 * Separate from the receipt card because a suggestion does not have to come
 * from a photograph: a line on a bank statement fills the same form from the
 * same fields, and the person accepts it the same way. Hard rule 10 is what
 * makes it a button rather than something that happens.
 */
function Forslagsknapp({
  forslag,
  namn,
  onFyllI,
}: {
  readonly forslag: Kvittoforslag | undefined;
  readonly namn: string | undefined;
  readonly onFyllI: () => void;
}) {
  const text = beskrivForslag(forslag, namn);
  if (text.length === 0) {
    return null;
  }
  return (
    <p>
      <button
        type="button"
        className="knapp knapp--text"
        data-testid="anvand-kvittot"
        onClick={onFyllI}
      >
        Fyll i {text}
      </button>
    </p>
  );
}

/**
 * The receipt riding along with the booking.
 *
 * It is attached when the verifikat is written, not before: hard rule 5 makes
 * a booked verifikat immutable, so the link is made in the same breath as the
 * booking rather than reserved in advance and confirmed afterwards.
 */
function Underlagskort({
  underlag,
  laser,
  fel,
  onSlapp,
}: {
  readonly underlag: {
    readonly filnamn: string;
    readonly url: string;
    readonly mime: string;
    readonly text?: string;
  };
  readonly laser: boolean | undefined;
  readonly fel: string | undefined;
  readonly onSlapp: (() => void) | undefined;
}) {
  const [visaText, setVisaText] = useState(false);
  const [visar, setVisar] = useState(false);

  return (
    <div className="kort underlagskort" data-testid="valt-underlag">
      {/*
       * Opens the receipt in full, so the figures can be checked against it
       * before anything is booked.
       */}
      <button
        type="button"
        className="underlagskort__oppna"
        aria-label={`Visa ${underlag.filnamn} i full storlek`}
        onClick={() => setVisar(true)}
      >
        <img src={underlag.url} alt="" />
      </button>
      {visar && <Underlagsvisning underlag={underlag} onStang={() => setVisar(false)} />}
      <span className="listrad__text">
        <strong>Kvittot bifogas</strong>
        <span className="listrad__sekundar">{underlag.filnamn}</span>

        {laser === true && (
          <span className="listrad__sekundar" data-testid="ocr-laser">
            Läser kvittot …
          </span>
        )}

        {fel !== undefined && (
          <span className="listrad__sekundar" data-testid="ocr-fel">
            {fel}
          </span>
        )}

        {/*
         * What the reading actually produced. Offered rather than shown,
         * because it is only interesting when the suggestion is wrong - and
         * then it is the difference between "it guessed badly" and knowing
         * which line it misread.
         */}
        {underlag.text !== undefined && underlag.text.trim().length > 0 && (
          <button
            type="button"
            className="knapp knapp--text"
            data-testid="visa-ocrtext"
            onClick={() => setVisaText(!visaText)}
          >
            {visaText ? 'Dölj vad appen läste' : 'Visa vad appen läste'}
          </button>
        )}
      </span>

      {visaText && underlag.text !== undefined && (
        <pre className="ocrtext" data-testid="ocrtext">
          {underlag.text}
        </pre>
      )}

      {onSlapp !== undefined && (
        /*
         * Detaches the receipt from this entry; the picture stays on the
         * Kvitton list. Named for what it does, because "Ta bort" next to a
         * photograph reads as throwing it away.
         */
        <button type="button" className="knapp knapp--text" onClick={onSlapp}>
          Använd inte
        </button>
      )}
    </div>
  );
}

/**
 * What the button offers, in the words on the receipt.
 *
 * Spelled out rather than "Fyll i från kvittot", because what it is about to
 * do is the thing worth checking - and reading it is faster than undoing it.
 */
function beskrivForslag(
  forslag: Kvittoforslag | undefined,
  namn: string | undefined,
): string {
  const pengar = [
    forslag?.brutto === undefined ? undefined : visaKronor(forslag.brutto),
    forslag?.datum,
  ]
    .filter((del): del is string => del !== undefined)
    .join(' den ');

  if (namn === undefined) {
    return pengar;
  }
  return pengar.length === 0 ? namn : `${namn}, ${pengar}`;
}

/**
 * Converts a typed amount at a typed rate, or nothing if either is not there
 * yet.
 *
 * Returns the sentence that goes into the verifikat's description as well as
 * the figure, so the two can never say different things.
 */
function raknaOm(
  valuta: string,
  belopp: string,
  kurstext: string,
): { sek: Ore; text: string } | undefined {
  const summa = tolkaBelopp(belopp);
  if (summa === undefined || summa === 0) {
    return undefined;
  }
  try {
    const kod = valutakod(valuta);
    const vaxelkurs = kurs(kurstext);
    return {
      sek: tillRedovisningsvaluta(summa, vaxelkurs),
      // Written without "kr", which is the one unit the amount is not in.
      text: `${kronorString(summa).replace('.', ',')} ${kod}, kurs ${kursText(vaxelkurs)}`,
    };
  } catch {
    // Half-typed input is the normal state of a form, not an error to shout
    // about. The line under the fields says what is still missing.
    return undefined;
  }
}
