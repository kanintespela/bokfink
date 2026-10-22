import { useEffect, useMemo, useState } from 'react';

import {
  formatKronor,
  isZero,
  kronorString,
  negate,
  oreFromKronor,
  type Ore,
} from '../../domain/belopp/ore';
import {
  beraknaForenkladArsbokslut,
  RUBRIKER,
  type Bokslutsrad,
  type Resultatrad,
} from '../../domain/bokslut/forenkladArsbokslut';
import type { Uuid } from '../../domain/id/uuidv7';
import type { Kontonummer } from '../../domain/konto/konto';
import { omfattar, type Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { beraknaSaldon } from '../../domain/rapport/saldon';
import {
  beraknaNebilaga,
  JUSTERINGAR,
  type Justeringsrad,
} from '../../domain/skatt/nebilaga';
import type { Datum } from '../../domain/tid/datum';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import type { Deklarantuppgifter } from '../../data/nebilaga';
import { kodaLatin1 } from '../../domain/export/latin1';
import { skrivNeSru } from '../../domain/sru/sru';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly verifikat: readonly BokfortVerifikat[];
  readonly rutval: ReadonlyMap<Kontonummer, Resultatrad>;
  /** Must keep its identity between renders, or unsaved input is reloaded. */
  readonly onLas: (arId: Uuid) => Promise<{
    readonly justeringar: Partial<Record<Justeringsrad, Ore>>;
    readonly deklarant: Deklarantuppgifter;
  }>;
  /** Reads one year's adjustments; also used for the year before. Stable. */
  readonly onLasJusteringar: (arId: Uuid) => Promise<Partial<Record<Justeringsrad, Ore>>>;
  readonly onSpara: (
    arId: Uuid,
    justeringar: Partial<Record<Justeringsrad, Ore>>,
    deklarant: Deklarantuppgifter,
  ) => Promise<void>;
  readonly onSparaFil: (
    namn: 'INFO.SRU' | 'BLANKETTER.SRU',
    innehall: Uint8Array,
  ) => Promise<void>;
  readonly onArsbokslut: () => void;
  readonly nu: () => { readonly datum: Datum; readonly tid: string };
}

/**
 * The rows most years need; the rest are behind "Visa alla rader". R18 and
 * R19 are here because the verksamhet is a jointly run one, and the filed
 * NE for 2025 used R19.
 */
const VANLIGA = new Set<Justeringsrad>([
  'R13',
  'R14',
  'R18',
  'R19',
  'R24',
  'R40',
  'R41',
  'R43',
]);

const DEKLARANTFALT: readonly {
  readonly nyckel: keyof Deklarantuppgifter;
  readonly etikett: string;
  readonly inputMode?: 'numeric';
}[] = [
  { nyckel: 'personnummer', etikett: 'Personnummer, tolv siffror', inputMode: 'numeric' },
  { nyckel: 'namn', etikett: 'Namn' },
  { nyckel: 'adress', etikett: 'Adress' },
  { nyckel: 'postnummer', etikett: 'Postnummer', inputMode: 'numeric' },
  { nyckel: 'postort', etikett: 'Postort' },
  { nyckel: 'verksamhetensArt', etikett: 'Verksamhetens art' },
];

/**
 * The NE-bilaga for a year, and the two SRU files Skatteverket's
 * filöverföring takes.
 *
 * Page 1 comes from the förenklade årsbokslutet and is not edited here -
 * a wrong figure on it is fixed in the books. Page 2 takes what the books
 * do not know. The files are saved one at a time, each on its own tap: a
 * share sheet on iOS needs a fresh tap to open, and the upload wants the two
 * files as they are, not in a zip.
 */
export function Nebilagasida({
  onTillbaka,
  rakenskapsar,
  verifikat,
  rutval,
  onLas,
  onLasJusteringar,
  onSpara,
  onSparaFil,
  onArsbokslut,
  nu,
}: Props) {
  const ar = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const [arId, setArId] = useState(() => ar[0]?.id);
  const aret = ar.find((kandidat) => kandidat.id === arId) ?? ar[0];

  // What was read for a year, and edited since. Keyed by year so that a
  // switch shows nothing stale while the next year is being read.
  const [uppgifter, setUppgifter] = useState<
    | {
        readonly arId: Uuid;
        readonly text: Partial<Record<Justeringsrad, string>>;
        readonly deklarant: Deklarantuppgifter;
      }
    | undefined
  >();
  const [visaAlla, setVisaAlla] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  const valtId = aret?.id;
  const laddade = uppgifter?.arId === valtId ? uppgifter : undefined;
  const justeringstext = laddade?.text ?? {};
  const deklarant = laddade?.deklarant;
  const setJusteringstext = (text: Partial<Record<Justeringsrad, string>>) =>
    laddade && setUppgifter({ ...laddade, text });
  const setDeklarant = (ny: Deklarantuppgifter) =>
    laddade && setUppgifter({ ...laddade, deklarant: ny });
  useEffect(() => {
    if (valtId === undefined) {
      return;
    }
    let aktuell = true;
    onLas(valtId)
      .then(({ justeringar, deklarant: sparad }) => {
        if (!aktuell) {
          return;
        }
        setUppgifter({
          arId: valtId,
          text: Object.fromEntries(
            Object.entries(justeringar).map(([rad, belopp]) => [
              rad,
              // Whole kronor as typed, without passing through a float.
              kronorString(belopp).replace(/\.00$/, '').replace('.', ','),
            ]),
          ),
          deklarant: sparad,
        });
        setVisaAlla(
          Object.keys(justeringar).some((rad) => !VANLIGA.has(rad as Justeringsrad)),
        );
      })
      .catch((orsak: unknown) => setFel(meddelande(orsak)));
    return () => {
      aktuell = false;
    };
  }, [valtId, onLas]);

  /*
   * Last year's bilaga, for the one figure this year's cannot know: an
   * underskott is carried forward to R24. Suggested, never filled in - the
   * user may have used it somewhere else (hard rule 10).
   */
  const foregaende = useMemo(
    () =>
      aret === undefined ? undefined : ar.find((kandidat) => kandidat.slut < aret.start),
    [ar, aret],
  );

  const [foregaendeJusteringar, setForegaendeJusteringar] = useState<
    | { readonly arId: Uuid; readonly justeringar: Partial<Record<Justeringsrad, Ore>> }
    | undefined
  >();
  const foregaendeId = foregaende?.id;
  useEffect(() => {
    if (foregaendeId === undefined) {
      return;
    }
    let aktuell = true;
    onLasJusteringar(foregaendeId)
      .then((justeringar) => {
        if (aktuell) {
          setForegaendeJusteringar({ arId: foregaendeId, justeringar });
        }
      })
      .catch((orsak: unknown) => setFel(meddelande(orsak)));
    return () => {
      aktuell = false;
    };
  }, [foregaendeId, onLasJusteringar]);

  // Whatever cannot be read as an amount is kept out and named, not zeroed.
  const lastText = laddade?.text;
  const { justeringar, olasliga } = useMemo(() => {
    const ut: Partial<Record<Justeringsrad, Ore>> = {};
    const fel: string[] = [];
    for (const [rad, text] of Object.entries(lastText ?? {})) {
      if (text === undefined || text.trim() === '') {
        continue;
      }
      try {
        ut[rad as Justeringsrad] = oreFromKronor(text.trim());
      } catch {
        fel.push(rad);
      }
    }
    return { justeringar: ut, olasliga: fel };
  }, [lastText]);

  const ne = useMemo(() => {
    if (aret === undefined) {
      return undefined;
    }
    const saldon = beraknaSaldon(
      aret.ingaendeBalanser,
      verifikat.filter((post) => omfattar(aret, post.datum)),
    );
    return beraknaNebilaga(beraknaForenkladArsbokslut(saldon, rutval), justeringar);
  }, [aret, verifikat, rutval, justeringar]);

  const forslagR24 = useMemo(() => {
    if (foregaende === undefined || foregaendeJusteringar?.arId !== foregaende.id) {
      return undefined;
    }
    const saldon = beraknaSaldon(
      foregaende.ingaendeBalanser,
      verifikat.filter((post) => omfattar(foregaende, post.datum)),
    );
    const forra = beraknaNebilaga(
      beraknaForenkladArsbokslut(saldon, rutval),
      foregaendeJusteringar.justeringar,
    );
    return forra.hinder.length === 0 && forra.resultat < 0
      ? negate(forra.resultat)
      : undefined;
  }, [foregaende, foregaendeJusteringar, rutval, verifikat]);

  if (aret === undefined || ne === undefined) {
    return (
      <p className="tomt" data-testid="inget-rakenskapsar">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  async function kor(uppgift: () => Promise<string>) {
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(meddelande(orsak));
    }
  }

  const spara = () => onSpara(aret.id, justeringar, deklarant!);

  const exportera = (vilken: 'INFO.SRU' | 'BLANKETTER.SRU') =>
    kor(async () => {
      await spara();
      const filer = skrivNeSru({
        deklarant: deklarant!,
        rakenskapsar: aret,
        verksamhetensArt: deklarant!.verksamhetensArt,
        ne,
        skapad: nu(),
        program: 'Bokfink',
      });
      await onSparaFil(
        vilken,
        kodaLatin1(vilken === 'INFO.SRU' ? filer.info : filer.blanketter),
      );
      return `${vilken} är sparad.`;
    });

  const hinder = [...ne.hinder, ...olasliga.map((rad) => `${rad} är inget belopp.`)];

  return (
    <section aria-label="NE-bilaga">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>NE-bilaga</h2>
      <p>
        Inkomst av näringsverksamhet för enskild firma. Sidan 1 kommer från årsbokslutet,
        avrundat till hela kronor. På sidan 2 fyller du i det som inte står i bokföringen.
      </p>

      <div className="faltgrupp">
        <label htmlFor="ne-ar">Räkenskapsår</label>
        <select
          id="ne-ar"
          className="falt"
          value={aret.id}
          onChange={(handelse) => setArId(handelse.target.value as typeof aret.id)}
        >
          {ar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      {hinder.length > 0 && (
        <div className="kort" role="alert" data-testid="ne-hinder">
          <p>Bilagan kan inte lämnas ännu:</p>
          <ul>
            {hinder.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <button type="button" className="knapp knapp--text" onClick={onArsbokslut}>
            Till årsbokslutet
          </button>
        </div>
      )}

      <h3>Sidan 1, balans- och resultaträkning</h3>
      {ne.sida1.length === 0 ? (
        <p className="tomt">Inga belopp att redovisa på sidan 1 i år.</p>
      ) : (
        <ul className="lista" data-testid="ne-sida1">
          {ne.sida1.map((rad) => (
            <Rad
              key={rad.rad}
              rad={rad.rad}
              text={
                rad.rad === 'R11' ? 'Bokfört resultat' : RUBRIKER[rad.rad as Bokslutsrad]
              }
              belopp={rad.belopp}
            />
          ))}
        </ul>
      )}
      {(!isZero(ne.avrundningB10) || !isZero(ne.avrundningR11)) && (
        <p data-testid="ne-avrundning">
          B10 och R11 räknas ur de avrundade rutorna, så att blanketten går ihop.
          Avrundningen ändrade B10 med {formatKronor(ne.avrundningB10)} och R11 med{' '}
          {formatKronor(ne.avrundningR11)} jämfört med årsbokslutet.
        </p>
      )}

      <h3>Sidan 2, skattemässiga justeringar</h3>
      <p>Hela kronor. Lämna tomt det som inte gäller dig.</p>
      {JUSTERINGAR.filter(({ rad }) => visaAlla || VANLIGA.has(rad)).map(
        ({ rad, text }) => (
          <div className="faltgrupp" key={rad}>
            <label htmlFor={`ne-${rad}`}>
              {rad} {text}
            </label>
            <input
              id={`ne-${rad}`}
              className="falt"
              inputMode="decimal"
              value={justeringstext[rad] ?? ''}
              onChange={(handelse) =>
                setJusteringstext({ ...justeringstext, [rad]: handelse.target.value })
              }
            />
            {rad === 'R24' &&
              forslagR24 !== undefined &&
              (justeringstext.R24 ?? '') === '' && (
                <p data-testid="forslag-r24">
                  {foregaende?.start.slice(0, 4)} slutade med ett underskott på{' '}
                  {formatKronor(forslagR24)}.{' '}
                  <button
                    type="button"
                    className="knapp knapp--text"
                    onClick={() =>
                      setJusteringstext({
                        ...justeringstext,
                        R24: kronorString(forslagR24).replace(/\.00$/, ''),
                      })
                    }
                  >
                    Använd det
                  </button>
                </p>
              )}
          </div>
        ),
      )}
      {!visaAlla && (
        <button
          type="button"
          className="knapp knapp--text"
          onClick={() => setVisaAlla(true)}
        >
          Visa alla rader
        </button>
      )}

      <ul className="lista" data-testid="ne-resultat">
        <Rad
          rad={ne.resultat >= 0 ? 'R47' : 'R48'}
          text={ne.resultat >= 0 ? 'Överskott' : 'Underskott, förs till R24 nästa år'}
          belopp={ne.resultat >= 0 ? ne.resultat : negate(ne.resultat)}
        />
      </ul>

      <h3>Uppgifter för filen</h3>
      {deklarant === undefined ? (
        <p>Läser …</p>
      ) : (
        DEKLARANTFALT.map(({ nyckel, etikett, inputMode }) => (
          <div className="faltgrupp" key={nyckel}>
            <label htmlFor={`ne-${nyckel}`}>{etikett}</label>
            <input
              id={`ne-${nyckel}`}
              className="falt"
              inputMode={inputMode}
              value={deklarant[nyckel]}
              onChange={(handelse) =>
                setDeklarant({ ...deklarant, [nyckel]: handelse.target.value })
              }
            />
          </div>
        ))
      )}

      <button
        type="button"
        className="knapp"
        disabled={deklarant === undefined}
        data-testid="ne-spara"
        onClick={() =>
          void kor(async () => {
            await spara();
            return 'Uppgifterna är sparade.';
          })
        }
      >
        Spara uppgifterna
      </button>

      <h3>Filer till Skatteverket</h3>
      <p>
        Ladda upp båda filerna i Skatteverkets filöverföring. De sparas var för sig, en
        per tryck.
      </p>
      <div className="segment">
        {(['INFO.SRU', 'BLANKETTER.SRU'] as const).map((vilken) => (
          <button
            key={vilken}
            type="button"
            disabled={deklarant === undefined || hinder.length > 0}
            data-testid={`ne-${vilken}`}
            onClick={() => void exportera(vilken)}
          >
            Spara {vilken}
          </button>
        ))}
      </div>

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="ne-besked">
          {besked}
        </p>
      )}
      {fel !== undefined && (
        <p role="alert" data-testid="ne-fel">
          {fel}
        </p>
      )}
    </section>
  );
}

function Rad({
  rad,
  text,
  belopp,
}: {
  readonly rad: string;
  readonly text: string;
  readonly belopp: Ore;
}) {
  return (
    <li data-testid={`ne-${rad}`}>
      <div className="listrad">
        <span className="listrad__text">
          <span>
            {rad} {text}
          </span>
        </span>
        <span className={`belopp${belopp < 0 ? ' belopp--negativ' : ''}`}>
          {formatKronor(belopp)}
        </span>
      </div>
    </li>
  );
}

function meddelande(orsak: unknown): string {
  return orsak instanceof Error ? orsak.message : String(orsak);
}
