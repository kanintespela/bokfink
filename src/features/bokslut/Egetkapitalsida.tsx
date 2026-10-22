import { useState } from 'react';

import type { Egetkapitalsammanstallning } from '../../data/egetkapital';
import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';
import { kontonummer } from '../../domain/konto/konto';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Datum } from '../../domain/tid/datum';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly idag: Datum;
  readonly onHamtaSammanstallning: (
    ar: Rakenskapsar,
    uttagInsattningKonton: readonly ReturnType<typeof kontonummer>[],
  ) => Promise<Egetkapitalsammanstallning>;
  readonly onBokfor: (uppgifter: {
    readonly typ: 'uttag' | 'insattning';
    readonly datum: Datum;
    readonly betalkonto: ReturnType<typeof kontonummer>;
    readonly uttagInsattningKonto: ReturnType<typeof kontonummer>;
    readonly belopp: Ore;
  }) => Promise<string>;
}

/**
 * Egna uttag och insättningar - en enskild firma har ingen lön till sig
 * själv, bara pengar som går mellan företaget och innehavaren (BFN K1
 * punkt 6.66 räknar eget kapital som tillgångar minus skulder; det här är
 * samma tal brutet ner på vad som ändrade det, se
 * domain/bokslut/egetkapital.ts).
 */
export function Egetkapitalsida({
  onTillbaka,
  rakenskapsar,
  idag,
  onHamtaSammanstallning,
  onBokfor,
}: Props) {
  const [arId, setArId] = useState<string>(rakenskapsar[0]?.id ?? '');
  const [uttagInsattningText, setUttagInsattningText] = useState('2013, 2017');
  const [sammanstallning, setSammanstallning] = useState<
    Egetkapitalsammanstallning | undefined
  >();

  const [typ, setTyp] = useState<'uttag' | 'insattning'>('uttag');
  const [beloppText, setBeloppText] = useState('');
  const [datum, setDatum] = useState(idag);
  const [betalkontoText, setBetalkontoText] = useState('1930');

  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  async function kor(uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: shown, not swallowed.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  const beloppOre = (() => {
    try {
      return beloppText.trim() === '' ? undefined : oreFromKronor(beloppText);
    } catch {
      return undefined;
    }
  })();

  const valtAr = rakenskapsar.find((kandidat) => kandidat.id === arId);

  return (
    <section aria-label="Eget kapital">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Eget kapital</h2>

      <div className="faltgrupp">
        <label htmlFor="egetkapital-ar">Räkenskapsår</label>
        <select
          id="egetkapital-ar"
          className="falt"
          value={arId}
          onChange={(handelse) => {
            setArId(handelse.target.value);
            setSammanstallning(undefined);
          }}
        >
          {rakenskapsar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>
      </div>

      <div className="faltgrupp">
        <label htmlFor="egetkapital-konto">Konton för uttag och insättningar</label>
        <input
          id="egetkapital-konto"
          className="falt"
          value={uttagInsattningText}
          onChange={(handelse) => setUttagInsattningText(handelse.target.value)}
        />
        <span className="listrad__sekundar">
          Uttag bokförs på det första kontot och insättningar på det sista. BAS K1 har
          2013 för uttag och 2017 för insättningar; en äldre bokföring kan ha båda på
          2013.
        </span>
      </div>

      <button
        type="button"
        className="knapp"
        disabled={arbetar || valtAr === undefined}
        data-testid="hamta-egetkapital"
        onClick={() =>
          void kor(async () => {
            const resultat = await onHamtaSammanstallning(
              valtAr!,
              tolkaKonton(uttagInsattningText),
            );
            setSammanstallning(resultat);
            return 'Sammanställningen är uppdaterad.';
          })
        }
      >
        Beräkna
      </button>

      {sammanstallning !== undefined && (
        <dl data-testid="egetkapital-sammanstallning">
          <dt>Ingående eget kapital</dt>
          <dd>{formatKronor(sammanstallning.ibEgetKapital)}</dd>
          <dt>Uttag i år</dt>
          <dd>{formatKronor(sammanstallning.uttagIAr)}</dd>
          <dt>Insättningar i år</dt>
          <dd>{formatKronor(sammanstallning.insattningarIAr)}</dd>
          <dt>Årets resultat hittills</dt>
          <dd>{formatKronor(sammanstallning.aretsResultat)}</dd>
          <dt>Utgående eget kapital</dt>
          <dd>{formatKronor(sammanstallning.ubEgetKapital)}</dd>
        </dl>
      )}

      <h3>Nytt uttag eller ny insättning</h3>

      <div className="segment">
        <button
          type="button"
          aria-pressed={typ === 'uttag'}
          onClick={() => setTyp('uttag')}
        >
          Eget uttag
        </button>
        <button
          type="button"
          aria-pressed={typ === 'insattning'}
          onClick={() => setTyp('insattning')}
        >
          Egen insättning
        </button>
      </div>

      <div className="faltgrupp">
        <label htmlFor="egetkapital-belopp">Belopp</label>
        <input
          id="egetkapital-belopp"
          className="falt"
          inputMode="decimal"
          value={beloppText}
          onChange={(handelse) => setBeloppText(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="egetkapital-datum">Datum</label>
        <input
          id="egetkapital-datum"
          className="falt"
          type="date"
          value={datum}
          onChange={(handelse) => setDatum(handelse.target.value as Datum)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="egetkapital-betalkonto">
          {typ === 'uttag' ? 'Konto pengarna tas från' : 'Konto pengarna sätts in på'}
        </label>
        <input
          id="egetkapital-betalkonto"
          className="falt"
          value={betalkontoText}
          onChange={(handelse) => setBetalkontoText(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp knapp--primar"
        disabled={arbetar || beloppOre === undefined || beloppOre <= 0}
        data-testid="bokfor-egetkapital"
        onClick={() =>
          void kor(async () => {
            const resultat = await onBokfor({
              typ,
              datum,
              betalkonto: kontonummer(betalkontoText),
              uttagInsattningKonto:
                typ === 'uttag'
                  ? tolkaKonton(uttagInsattningText)[0]!
                  : tolkaKonton(uttagInsattningText).at(-1)!,
              belopp: beloppOre!,
            });
            setBeloppText('');
            setSammanstallning(undefined);
            return resultat;
          })
        }
      >
        Bokför {typ === 'uttag' ? 'uttaget' : 'insättningen'}
      </button>

      {arbetar && <p data-testid="egetkapital-arbetar">Arbetar …</p>}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="egetkapital-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="egetkapital-fel">
          {fel}
        </p>
      )}
    </section>
  );
}

/** "2013, 2017" as accounts; an account that is not one throws, and is shown. */
function tolkaKonton(text: string): ReturnType<typeof kontonummer>[] {
  const konton = text
    .split(',')
    .map((del) => del.trim())
    .filter((del) => del.length > 0)
    .map((del) => kontonummer(del));
  if (konton.length === 0) {
    throw new TypeError('Skriv minst ett konto för uttag och insättningar.');
  }
  return konton;
}
