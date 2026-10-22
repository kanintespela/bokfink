import { useMemo, useState } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import {
  BOKSLUTSPOSTER,
  bokslutspostKonteringar,
  type Bokslutspost,
  type Bokslutsposttyp,
} from '../../domain/bokslut/bokslutspost';
import { kontonummer, type Konto, type Kontonummer } from '../../domain/konto/konto';
import { forvaltMomskonto } from '../../domain/moms/momskonto';
import { nastaRakenskapsarsperiod } from '../../domain/bokslut/arsavslut';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import type { Kontering } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';
import { tolkaBelopp } from '../bokfor/Beloppsfalt';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly idag: Datum;
  readonly onBokfor: (val: {
    readonly ar: Rakenskapsar;
    readonly post: Bokslutspost;
    readonly beskrivning: string;
  }) => Promise<string>;
}

const TYPER = Object.keys(BOKSLUTSPOSTER) as Bokslutsposttyp[];

/**
 * What the förenklat årsbokslut takes up at the year's end: unpaid invoices
 * first, since they are what a business on the kontantmetod usually has, then
 * the rest of K1's short list. Each item is booked on the year's last day and
 * reversed on the next year's first, in one press.
 */
export function Bokslutspostsida({
  onTillbaka,
  rakenskapsar,
  konton,
  idag,
  onBokfor,
}: Props) {
  const aren = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  // The year most likely being closed: the newest that has ended and is open.
  const forvaltAr =
    aren.find((ar) => ar.slut < idag && !ar.avslutat) ??
    aren.find((ar) => !ar.avslutat) ??
    aren[0];

  const [arId, setArId] = useState(forvaltAr?.id);
  const [typ, setTyp] = useState<Bokslutsposttyp>('obetald_kundfaktura');
  const [beskrivning, setBeskrivning] = useState('');
  const [beloppText, setBeloppText] = useState('');
  const [momssats, setMomssats] = useState(25);
  const [motkontoText, setMotkontoText] = useState(
    BOKSLUTSPOSTER.obetald_kundfaktura.motkonto ?? '',
  );
  const [balanskontoText, setBalanskontoText] = useState<string>(
    BOKSLUTSPOSTER.obetald_kundfaktura.balanskonto,
  );
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  const ar = aren.find((kandidat) => kandidat.id === arId) ?? forvaltAr;
  const post = BOKSLUTSPOSTER[typ];
  const belopp = tolkaBelopp(beloppText);
  const motkonto = tolkaKonto(motkontoText);
  const balanskonto = tolkaKonto(balanskontoText);
  const momskonto = post.medMoms
    ? forvaltMomskonto(post.motkontoArIntakt ? 'inkomst' : 'utgift', momssats)
    : undefined;

  function valjTyp(nytt: Bokslutsposttyp) {
    setTyp(nytt);
    setMotkontoText(BOKSLUTSPOSTER[nytt].motkonto ?? '');
    setBalanskontoText(BOKSLUTSPOSTER[nytt].balanskonto);
  }

  // The rows the press will book, or why it cannot yet.
  const forslag = ((): { rader: Kontering[] } | { hinder: string } => {
    if (ar === undefined) {
      return { hinder: 'Lägg upp ett räkenskapsår först.' };
    }
    if (beskrivning.trim() === '') {
      return { hinder: 'Skriv vad det gäller, till exempel fakturans nummer och kund.' };
    }
    if (belopp === undefined) {
      return { hinder: 'Skriv beloppet.' };
    }
    for (const [konto, text] of [
      [motkonto, motkontoText],
      [balanskonto, balanskontoText],
      ...(momskonto === undefined ? [] : [[momskonto, momskonto]]),
    ] as const) {
      if (konto === undefined || !konton.has(konto)) {
        return {
          hinder: `Konto ${String(text).trim() || '(inget)'} finns inte i kontoplanen. Lägg upp det under Kontoplan först.`,
        };
      }
    }
    try {
      return {
        rader: bokslutspostKonteringar(
          byggPost(typ, belopp, momssats, motkonto!, balanskonto!),
        ),
      };
    } catch (orsak) {
      return { hinder: orsak instanceof Error ? orsak.message : String(orsak) };
    }
  })();

  const aterfors = ar === undefined ? undefined : nastaRakenskapsarsperiod(ar).start;

  async function bokfor() {
    if (
      ar === undefined ||
      belopp === undefined ||
      motkonto === undefined ||
      balanskonto === undefined
    ) {
      return;
    }
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(
        await onBokfor({
          ar,
          post: byggPost(typ, belopp, momssats, motkonto, balanskonto),
          beskrivning,
        }),
      );
      setBeskrivning('');
      setBeloppText('');
    } catch (orsak) {
      // Hard rule 11: a locked declaration or a year not yet begun is said here.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  return (
    <section aria-label="Obetalda fakturor och periodisering">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Obetalda fakturor och periodisering</h2>

      <p className="hjalptext">
        Vid årets slut tar ett förenklat årsbokslut upp det som inte har betalats än:
        obetalda fakturor och några få andra poster. Varje post bokförs på årets sista dag
        och förs tillbaka automatiskt första dagen nästa år, så att betalningen då räknas
        en gång. Bokför obetalda fakturor innan årets sista momsdeklaration lämnas – deras
        moms ska med i den.
      </p>

      {aren.length > 1 && (
        <div className="faltgrupp">
          <label htmlFor="bokslutspost-ar">Räkenskapsår</label>
          <select
            id="bokslutspost-ar"
            className="falt"
            value={ar?.id}
            onChange={(handelse) => setArId(handelse.target.value as Rakenskapsar['id'])}
          >
            {aren.map((kandidat) => (
              <option key={kandidat.id} value={kandidat.id}>
                {kandidat.start.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="bokslutspost-typ">Vad gäller det?</label>
        <select
          id="bokslutspost-typ"
          className="falt"
          value={typ}
          onChange={(handelse) => valjTyp(handelse.target.value as Bokslutsposttyp)}
        >
          {TYPER.map((kandidat) => (
            <option key={kandidat} value={kandidat}>
              {BOKSLUTSPOSTER[kandidat].namn}
            </option>
          ))}
        </select>
        <span className="listrad__sekundar" data-testid="bokslutspost-forklaring">
          {post.forklaring}
        </span>
      </div>

      <div className="faltgrupp">
        <label htmlFor="bokslutspost-beskrivning">Beskrivning</label>
        <input
          id="bokslutspost-beskrivning"
          className="falt"
          value={beskrivning}
          onChange={(handelse) => setBeskrivning(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="bokslutspost-belopp">
          {post.medMoms ? 'Belopp med moms' : 'Belopp utan moms'}
        </label>
        <input
          id="bokslutspost-belopp"
          className="falt"
          inputMode="decimal"
          value={beloppText}
          onChange={(handelse) => setBeloppText(handelse.target.value)}
        />
      </div>

      {post.medMoms && (
        <div className="faltgrupp">
          <label htmlFor="bokslutspost-moms">Moms</label>
          <select
            id="bokslutspost-moms"
            className="falt"
            value={momssats}
            onChange={(handelse) => setMomssats(Number(handelse.target.value))}
          >
            {[25, 12, 6, 0].map((sats) => (
              <option key={sats} value={sats}>
                {sats === 0 ? 'Momsfritt' : `${sats} %`}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="faltgrupp">
        <label htmlFor="bokslutspost-motkonto">
          {post.motkontoArIntakt ? 'Intäktskonto' : 'Kostnadskonto'}
        </label>
        <input
          id="bokslutspost-motkonto"
          className="falt"
          inputMode="numeric"
          value={motkontoText}
          onChange={(handelse) => setMotkontoText(handelse.target.value)}
        />
        <span className="listrad__sekundar">
          {motkonto === undefined
            ? ' '
            : (konton.get(motkonto)?.namn ?? 'Finns inte i kontoplanen')}
        </span>
      </div>

      <div className="faltgrupp">
        <label htmlFor="bokslutspost-balanskonto">
          {Number(balanskontoText) < 2000 ? 'Fordringskonto' : 'Skuldkonto'}
        </label>
        <input
          id="bokslutspost-balanskonto"
          className="falt"
          inputMode="numeric"
          value={balanskontoText}
          onChange={(handelse) => setBalanskontoText(handelse.target.value)}
        />
        <span className="listrad__sekundar">
          {balanskonto === undefined
            ? ' '
            : (konton.get(balanskonto)?.namn ?? 'Finns inte i kontoplanen')}
        </span>
      </div>

      {'rader' in forslag ? (
        <div className="kort" data-testid="bokslutspost-forslag">
          <p>
            Bokförs {ar?.slut} och förs tillbaka {aterfors}:
          </p>
          <ul className="lista">
            {forslag.rader.map((rad, index) => (
              <li key={`${rad.konto}-${index}`}>
                <div
                  className={`listrad listrad--${rad.belopp < 0 ? 'kredit' : 'debet'}`}
                >
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
          <p className="hjalptext">{post.kalla}</p>
        </div>
      ) : (
        <p className="hjalptext" data-testid="bokslutspost-hinder">
          {forslag.hinder}
        </p>
      )}

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || 'hinder' in forslag}
        data-testid="bokfor-bokslutspost"
        onClick={() => void bokfor()}
      >
        Bokför och för tillbaka {aterfors ?? ''}
      </button>

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="bokslutspost-besked">
          {besked}
        </p>
      )}
      {fel !== undefined && (
        <p role="alert" data-testid="bokslutspost-fel">
          {fel}
        </p>
      )}
    </section>
  );
}

function byggPost(
  typ: Bokslutsposttyp,
  belopp: Ore,
  momssats: number,
  motkonto: Kontonummer,
  balanskonto: Kontonummer,
): Bokslutspost {
  return {
    typ,
    belopp,
    ...(BOKSLUTSPOSTER[typ].medMoms ? { momssats } : {}),
    motkonto,
    balanskonto,
  };
}

function tolkaKonto(text: string): Kontonummer | undefined {
  try {
    return text.trim() === '' ? undefined : kontonummer(text.trim());
  } catch {
    return undefined;
  }
}
