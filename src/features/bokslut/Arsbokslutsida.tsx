import { useMemo, useState } from 'react';

import { formatKronor, isZero, ZERO, type Ore } from '../../domain/belopp/ore';
import {
  beraknaForenkladArsbokslut,
  INTAKTSRADER,
  KOSTNADSRADER,
  RUBRIKER,
  SKULDRADER,
  TILLGANGSRADER,
  UPPGIFTSRADER,
  type Bokslutsrad,
  type Bokslutsruta,
  type ForenkladArsbokslut,
  type Resultatrad,
} from '../../domain/bokslut/forenkladArsbokslut';
import {
  foreslaMomsomforing,
  type Momsomforing,
} from '../../domain/bokslut/momsomforing';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../../domain/rapport/saldon';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly verifikat: readonly BokfortVerifikat[];
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** The box chosen for each account BAS allows in two, kept across years. */
  readonly rutval: ReadonlyMap<Kontonummer, Resultatrad>;
  /** Saves a choice, or with `rad` undefined forgets it. */
  readonly onRutval: (konto: Kontonummer, rad: Resultatrad | undefined) => Promise<void>;
  readonly onNebilaga: () => void;
  /**
   * Books the year's result over from the result accounts onto eget
   * kapital (8999 mot 2019), dated the year's last day.
   */
  readonly onBokforResultat: (ar: Rakenskapsar) => Promise<string>;
  /** Books the bokslutspost that moves a momsfordran to its own account. */
  readonly onMomsomforing: (ar: Rakenskapsar, omforing: Momsomforing) => Promise<string>;
}

/**
 * The year on the form Förenklat årsbokslut (BFNAR 2006:1), box by box -
 * the same boxes the NE-bilaga asks for.
 *
 * Read-only: nothing here books anything. The one input is where an account
 * goes when BAS allows two boxes, which changes a figure on the form and
 * never the books.
 */
export function Arsbokslutsida({
  onTillbaka,
  rakenskapsar,
  verifikat,
  konton,
  rutval,
  onRutval,
  onNebilaga,
  onBokforResultat,
  onMomsomforing,
}: Props) {
  const ar = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const [arId, setArId] = useState(() => ar[0]?.id);
  const [fel, setFel] = useState<string | undefined>();
  const [besked, setBesked] = useState<string | undefined>();
  const [arbetar, setArbetar] = useState(false);
  const [oppen, setOppen] = useState<Bokslutsrad | undefined>();
  const [doljTomma, setDoljTomma] = useState(false);

  const aret = ar.find((kandidat) => kandidat.id === arId) ?? ar[0];

  const { bokslut, momsomforing } = useMemo(() => {
    if (aret === undefined) {
      return {};
    }
    const saldon = beraknaSaldon(
      aret.ingaendeBalanser,
      verifikat.filter((post) => omfattar(aret, post.datum)),
    );
    return {
      bokslut: beraknaForenkladArsbokslut(saldon, rutval),
      momsomforing: foreslaMomsomforing(saldon),
    };
  }, [aret, verifikat, rutval]);

  if (aret === undefined || bokslut === undefined) {
    return (
      <p className="tomt" data-testid="inget-rakenskapsar">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  const namn = (konto: Kontonummer) => konton.get(konto)?.namn ?? '';

  const bokforResultat = async (): Promise<void> => {
    setArbetar(true);
    setFel(undefined);
    setBesked(undefined);
    try {
      setBesked(await onBokforResultat(aret));
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  };

  const harBelopp = (rad: Bokslutsrad) => !isZero(bokslut.rutor.get(rad)?.belopp ?? ZERO);

  const rader = (lista: readonly Bokslutsrad[]) =>
    lista
      .filter((rad) => !doljTomma || harBelopp(rad))
      .map((rad) => (
        <Rutrad
          key={rad}
          rad={rad}
          ruta={bokslut.rutor.get(rad)}
          oppen={oppen === rad}
          onVaxla={() => setOppen(oppen === rad ? undefined : rad)}
          namn={namn}
          ejOverfortResultat={
            rad === 'B10' ? bokslut.resultatEjOverfortTillEgetKapital : ZERO
          }
        />
      ));

  const harUpplysningar = doljTomma
    ? UPPGIFTSRADER.some((rad) => bokslut.rutor.has(rad) && harBelopp(rad))
    : UPPGIFTSRADER.some((rad) => bokslut.rutor.has(rad));

  return (
    <section aria-label="Förenklat årsbokslut">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Förenklat årsbokslut</h2>
      <p>
        Årets bokföring sorterad i blankettens rutor. Samma rutor används i NE-bilagan.
      </p>

      <div className="faltgrupp">
        <label htmlFor="arsbokslut-ar">Räkenskapsår</label>
        <select
          id="arsbokslut-ar"
          className="falt"
          value={aret.id}
          onChange={(handelse) => {
            setArId(handelse.target.value as typeof aret.id);
            setOppen(undefined);
          }}
        >
          {ar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      {!isZero(bokslut.resultatEjOverfortTillEgetKapital) && !aret.avslutat && (
        <div className="kort" data-testid="resultatoverforing">
          <p>
            <strong>Årets resultat är inte fört till eget kapital.</strong>{' '}
            {formatKronor(bokslut.resultatEjOverfortTillEgetKapital)} kr sitter kvar på
            resultatkontona. Blankettens B10 tar redan med den, men en bokförd överföring
            (8999 mot 2019) gör att 2019 och huvudboken visar samma sak.
          </p>
          <p>Ingen krona lämnar firman - bara en flytt mellan konton.</p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            data-testid="bokfor-resultatoverforing"
            onClick={() => void bokforResultat()}
          >
            Bokför resultatet på {aret.slut}
          </button>
        </div>
      )}

      {momsomforing !== undefined && !aret.avslutat && (
        <div className="kort" data-testid="momsomforing">
          <p>
            <strong>Momsfordran ligger på ett skuldkonto.</strong> {momsomforing.fran}{' '}
            står på debet med {formatKronor(momsomforing.belopp)}, alltså pengar
            Skatteverket är skyldig dig. En fordran hör hemma bland tillgångarna, på{' '}
            {momsomforing.till}, och hamnar annars som ett minusbelopp i rutan för
            skatteskulder.
          </p>
          <p>Omföringen flyttar beloppet och rör varken resultat eller eget kapital.</p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            data-testid="bokfor-momsomforing"
            onClick={() => {
              setArbetar(true);
              setFel(undefined);
              setBesked(undefined);
              onMomsomforing(aret, momsomforing)
                .then(setBesked)
                // Hard rule 11: shown, not swallowed.
                .catch((orsak: unknown) =>
                  setFel(orsak instanceof Error ? orsak.message : String(orsak)),
                )
                .finally(() => setArbetar(false));
            }}
          >
            Bokför omföringen på {aret.slut}
          </button>
        </div>
      )}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="arsbokslut-besked">
          {besked}
        </p>
      )}

      <Kontroller
        bokslut={bokslut}
        namn={namn}
        rutval={rutval}
        onRutval={(konto, rad) => {
          setFel(undefined);
          onRutval(konto, rad).catch((orsak: unknown) =>
            // Hard rule 11: shown, not swallowed.
            setFel(orsak instanceof Error ? orsak.message : String(orsak)),
          );
        }}
      />

      {fel !== undefined && (
        <p role="alert" data-testid="rutval-fel">
          {fel}
        </p>
      )}

      <p>
        <button
          type="button"
          className="knapp knapp--text"
          onClick={() => setDoljTomma(!doljTomma)}
        >
          {doljTomma ? 'Visa alla rader' : 'Dölj tomma rader'}
        </button>
      </p>

      <h3>Balansräkning</h3>
      <ul className="lista" data-testid="arsbokslut-tillgangar">
        {rader(TILLGANGSRADER)}
      </ul>
      <Summa namn="Summa tillgångar" belopp={bokslut.summaTillgangar} />

      <ul className="lista" data-testid="arsbokslut-skulder">
        {rader(SKULDRADER)}
      </ul>
      <Summa
        namn="Summa eget kapital och skulder"
        belopp={bokslut.summaEgetKapitalOchSkulder}
      />

      <h3>Resultaträkning</h3>
      <ul className="lista" data-testid="arsbokslut-resultat">
        {rader(INTAKTSRADER)}
        {rader(KOSTNADSRADER)}
      </ul>
      <Summa namn="R11 Bokfört resultat" belopp={bokslut.bokfortResultat} />

      {harUpplysningar && (
        <>
          <h3>Upplysningar</h3>
          <p>Visas bredvid blanketten men räknas inte in i eget kapital.</p>
          <ul className="lista">{rader(UPPGIFTSRADER)}</ul>
        </>
      )}

      <p>
        <button type="button" className="knapp" onClick={onNebilaga}>
          Vidare till NE-bilagan
        </button>
      </p>
    </section>
  );
}

/**
 * What needs the user before the form can be trusted. Hard rule 11: a figure
 * that cannot be placed is shown here rather than left out of the sums.
 */
function Kontroller({
  bokslut,
  namn,
  rutval,
  onRutval,
}: {
  readonly bokslut: ForenkladArsbokslut;
  readonly namn: (konto: Kontonummer) => string;
  readonly rutval: ReadonlyMap<Kontonummer, Resultatrad>;
  readonly onRutval: (konto: Kontonummer, rad: Resultatrad | undefined) => void;
}) {
  // Only the choices this year's figures actually use; a choice for an
  // account with no balance this year has nothing to say here.
  const valda = [...rutval].filter(([konto, rad]) =>
    bokslut.rutor.get(rad)?.poster.some((post) => post.konto === konto),
  );

  return (
    <>
      {bokslut.kraverVal.map((post) => (
        <div key={post.konto} className="kort" data-testid={`valj-ruta-${post.konto}`}>
          <p>
            <strong>
              {post.konto} {namn(post.konto)}
            </strong>{' '}
            ({formatKronor(post.belopp)}) kan höra till två rutor. Vilken det är beror på
            vad posten gäller, så välj själv. Valet sparas och gäller alla år.
          </p>
          {post.alternativ[0] === 'R1' && (
            <p>Har företaget bara momspliktig försäljning hör posten normalt till R1.</p>
          )}
          <div className="segment">
            {post.alternativ.map((rad) => (
              <button
                key={rad}
                type="button"
                aria-pressed={false}
                onClick={() => onRutval(post.konto, rad)}
              >
                {rad} {kortRubrik(rad)}
              </button>
            ))}
          </div>
        </div>
      ))}

      {valda.map(([konto, rad]) => (
        <p key={konto} data-testid={`valt-${konto}`}>
          {konto} {namn(konto)} förs till {rad} {kortRubrik(rad)}, som du valt.{' '}
          <button
            type="button"
            className="knapp knapp--text"
            onClick={() => onRutval(konto, undefined)}
          >
            Ändra
          </button>
        </p>
      ))}

      {bokslut.kontonUtanRuta.length > 0 && (
        <div className="kort" role="alert" data-testid="konton-utan-ruta">
          <p>
            De här kontona har saldo men ingen ruta på blanketten enligt BAS K1-tabellen.
            Kontrollera om de är rätt konterade:
          </p>
          <ul>
            {bokslut.kontonUtanRuta.map((saldo) => (
              <li key={saldo.konto}>
                {saldo.konto} {namn(saldo.konto)}: {formatKronor(saldo.utgaende)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isZero(bokslut.differens) && (
        <p role="alert" data-testid="arsbokslut-differens">
          Balansräkningen går inte ihop: {formatKronor(bokslut.differens)} skiljer mellan
          tillgångar och eget kapital och skulder.
        </p>
      )}

      {!isZero(bokslut.resultatdifferens) && (
        <p role="alert" data-testid="arsbokslut-resultatdifferens">
          Blankettens resultat ({formatKronor(bokslut.bokfortResultat)}) skiljer sig från
          bokföringens ({formatKronor(bokslut.resultatEnligtBokforingen)}).
        </p>
      )}
    </>
  );
}

function Rutrad({
  rad,
  ruta,
  oppen,
  onVaxla,
  namn,
  ejOverfortResultat,
}: {
  readonly rad: Bokslutsrad;
  readonly ruta: Bokslutsruta | undefined;
  readonly oppen: boolean;
  readonly onVaxla: () => void;
  readonly namn: (konto: Kontonummer) => string;
  readonly ejOverfortResultat: Ore;
}) {
  const belopp = ruta?.belopp ?? ZERO;
  const poster = ruta?.poster ?? [];
  const kanOppnas = poster.length > 0 || !isZero(ejOverfortResultat);

  const innehall = (
    <>
      <span className="listrad__text">
        <span>
          {rad} {RUBRIKER[rad]}
        </span>
      </span>
      <span className={`belopp${belopp < 0 ? ' belopp--negativ' : ''}`}>
        {formatKronor(belopp)}
      </span>
    </>
  );

  return (
    <li data-testid={`ruta-${rad}`}>
      {kanOppnas ? (
        <button type="button" className="listrad" aria-expanded={oppen} onClick={onVaxla}>
          {innehall}
        </button>
      ) : (
        <div className="listrad">{innehall}</div>
      )}
      {oppen && (
        <ul className="lista">
          {poster.map((post) => (
            <li key={post.konto}>
              <div className="listrad">
                <span className="listrad__text">
                  <span className="listrad__sekundar">
                    {post.konto} {namn(post.konto)}
                  </span>
                </span>
                <span className="belopp">{formatKronor(post.belopp)}</span>
              </div>
            </li>
          ))}
          {!isZero(ejOverfortResultat) && (
            <li>
              <div className="listrad">
                <span className="listrad__text">
                  <span className="listrad__sekundar">
                    Årets resultat, ännu inte fört till eget kapital
                  </span>
                </span>
                <span className="belopp">{formatKronor(ejOverfortResultat)}</span>
              </div>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function Summa({ namn, belopp }: { readonly namn: string; readonly belopp: Ore }) {
  return (
    <div className="listrad" data-testid={`summa-${namn}`}>
      <span className="listrad__text">
        <strong>{namn}</strong>
      </span>
      <span className={`belopp belopp--stort${belopp < 0 ? ' belopp--negativ' : ''}`}>
        {formatKronor(belopp)}
      </span>
    </div>
  );
}

/** The part of a long box label that fits on a button at 375 px. */
function kortRubrik(rad: Resultatrad): string {
  const korta: Partial<Record<Resultatrad, string>> = {
    R1: 'Momspliktiga intäkter',
    R2: 'Momsfria intäkter',
    R9: 'Byggnader och mark',
    R10: 'Maskiner och inventarier',
  };
  return korta[rad] ?? RUBRIKER[rad];
}
