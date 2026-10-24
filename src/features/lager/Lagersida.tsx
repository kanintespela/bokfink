import { useState } from 'react';

import {
  lagervarde,
  lagervardeForPost,
  vardePerDjur,
  type Djurlagerinventering,
  type Djurpost,
} from '../../domain/lager/djurlager';
import {
  farProduktionsutgift,
  OkantProduktionsutgiftsarError,
} from '../../domain/lager/djurproduktionsutgift';
import { formatKronor, oreFromKronor, type Ore } from '../../domain/belopp/ore';
import type { Datum } from '../../domain/tid/datum';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly inventeringar: readonly Djurlagerinventering[];
  readonly idag: Datum;
  readonly onRegistrera: (uppgifter: {
    readonly datum: Datum;
    readonly poster: readonly Djurpost[];
  }) => Promise<string>;
  /** Books the count's value onto the stock account, on the balansdag. */
  readonly onBokforLagerforandring: (
    inventering: Djurlagerinventering,
  ) => Promise<string>;
}

/**
 * Djurlager - djur i jordbruk är alltid lagertillgångar (IL 17 kap. 5 §),
 * värderade lägst till 85 % av Skatteverkets årliga produktionsutgift, aldrig
 * mer än nettoförsäljningsvärdet (se djurlager.ts). Modellerad som en årlig
 * inventering: en räkning av djuren vid ett tillfälle, inte spårning av
 * varje enskild transaktion.
 */
export function Lagersida({
  onTillbaka,
  inventeringar,
  idag,
  onRegistrera,
  onBokforLagerforandring,
}: Props) {
  const [datum, setDatum] = useState(idag);
  const [poster, setPoster] = useState<Djurpost[]>([]);

  const [djurslag, setDjurslag] = useState('');
  const [antal, setAntal] = useState('');
  const [utgiftText, setUtgiftText] = useState('');
  const [nettoText, setNettoText] = useState('');
  const [skvAr, setSkvAr] = useState(String(Number(idag.slice(0, 4)) - 1));
  const [skvFel, setSkvFel] = useState<string | undefined>();

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

  function hamtaSkvPris(): void {
    setSkvFel(undefined);
    try {
      const rad = farProduktionsutgift(Number(skvAr));
      setUtgiftText(
        djurslag.trim().toLowerCase().includes('lamm')
          ? ''
          : (Number(rad.tackaEllerBagge) / 100).toString(),
      );
    } catch (orsak) {
      setSkvFel(
        orsak instanceof OkantProduktionsutgiftsarError
          ? orsak.message
          : orsak instanceof Error
            ? orsak.message
            : String(orsak),
      );
    }
  }

  const antalTal = Number(antal);
  const utgiftOre = (() => {
    try {
      return utgiftText.trim() === '' ? undefined : oreFromKronor(utgiftText);
    } catch {
      return undefined;
    }
  })();
  const nettoOre = (() => {
    try {
      return nettoText.trim() === '' ? undefined : oreFromKronor(nettoText);
    } catch {
      return undefined;
    }
  })();

  function laggTillPost(): void {
    if (
      djurslag.trim() === '' ||
      !Number.isInteger(antalTal) ||
      antalTal <= 0 ||
      utgiftOre === undefined ||
      nettoOre === undefined
    ) {
      return;
    }
    setPoster((forra) => [
      ...forra,
      {
        djurslag: djurslag.trim(),
        antal: antalTal,
        genomsnittligProduktionsutgiftPerDjur: utgiftOre,
        nettoforsaljningsvardePerDjur: nettoOre,
      },
    ]);
    setDjurslag('');
    setAntal('');
    setUtgiftText('');
    setNettoText('');
  }

  const totaltNyPoster = poster.reduce(
    (summa, post) => summa + lagervardeForPost(post),
    0,
  ) as Ore;

  return (
    <section aria-label="Djurlager">
      <Tillbaka onTillbaka={onTillbaka} />
      <h2>Djurlager</h2>

      <p className="hjalptext">
        Djur i jordbruk räknas alltid som lagertillgångar, aldrig som
        anläggningstillgångar. Värdet är lägst 85 % av Skatteverkets årliga
        produktionsutgift för djurslaget, men aldrig mer än vad djuren sammanlagt skulle
        gå att sälja för. Räkna djuren på räkenskapsårets sista dag, registrera
        inventeringen och bokför sedan lagerförändringen – det flyttar skillnaden mot
        förra årets värde mellan konto 1400 Lager och 4900 Förändring av lager.
      </p>

      {inventeringar.length === 0 ? (
        <p className="tomt" data-testid="inga-inventeringar">
          Ingen inventering är registrerad ännu.
        </p>
      ) : (
        <ul className="lista" data-testid="inventeringslista">
          {inventeringar.map((inventering) => (
            <li key={inventering.id}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>{inventering.datum}</span>
                  <span className="listrad__sekundar">
                    {inventering.poster.map((post) => post.djurslag).join(', ') ||
                      'Inga djur'}
                  </span>
                </span>
                <span className="belopp">{formatKronor(lagervarde(inventering))}</span>
              </div>
              <button
                type="button"
                className="knapp knapp--text"
                disabled={arbetar}
                data-testid={`bokfor-lager-${inventering.datum}`}
                onClick={() => void kor(() => onBokforLagerforandring(inventering))}
              >
                Bokför lagerförändringen
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>Ny inventering</h2>

      <div className="faltgrupp">
        <label htmlFor="lager-datum">Datum</label>
        <input
          id="lager-datum"
          className="falt"
          type="date"
          value={datum}
          onChange={(handelse) => setDatum(handelse.target.value as Datum)}
        />
      </div>

      {poster.length > 0 && (
        <ul className="lista" data-testid="lager-poster">
          {poster.map((post, index) => (
            <li key={`${post.djurslag}-${index}`}>
              <div className="listrad">
                <span className="listrad__text">
                  <span>
                    {post.antal} × {post.djurslag}
                  </span>
                  <span className="listrad__sekundar">
                    {formatKronor(vardePerDjur(post))} kr/djur
                  </span>
                </span>
                <span className="belopp">{formatKronor(lagervardeForPost(post))}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3>Lägg till djurslag</h3>

      <div className="faltgrupp">
        <label htmlFor="lager-djurslag">Djurslag</label>
        <input
          id="lager-djurslag"
          className="falt"
          value={djurslag}
          onChange={(handelse) => setDjurslag(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="lager-antal">Antal</label>
        <input
          id="lager-antal"
          className="falt"
          inputMode="numeric"
          value={antal}
          onChange={(handelse) => setAntal(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="lager-skvar">Skatteverkets föreskriftsår</label>
        <input
          id="lager-skvar"
          className="falt"
          inputMode="numeric"
          value={skvAr}
          onChange={(handelse) => setSkvAr(handelse.target.value)}
        />
      </div>

      <p>
        <button type="button" className="knapp" onClick={hamtaSkvPris}>
          Hämta Skatteverkets pris för tacka/bagge
        </button>
      </p>

      {skvFel !== undefined && <p role="alert">{skvFel}</p>}

      <div className="faltgrupp">
        <label htmlFor="lager-utgift">Genomsnittlig produktionsutgift per djur</label>
        <input
          id="lager-utgift"
          className="falt"
          inputMode="decimal"
          value={utgiftText}
          onChange={(handelse) => setUtgiftText(handelse.target.value)}
        />
      </div>

      <div className="faltgrupp">
        <label htmlFor="lager-netto">Nettoförsäljningsvärde per djur</label>
        <input
          id="lager-netto"
          className="falt"
          inputMode="decimal"
          value={nettoText}
          onChange={(handelse) => setNettoText(handelse.target.value)}
        />
      </div>

      <button
        type="button"
        className="knapp"
        disabled={
          djurslag.trim() === '' ||
          !Number.isInteger(antalTal) ||
          antalTal <= 0 ||
          utgiftOre === undefined ||
          nettoOre === undefined
        }
        data-testid="lagg-till-djurpost"
        onClick={laggTillPost}
      >
        Lägg till
      </button>

      {poster.length > 0 && (
        <button
          type="button"
          className="knapp knapp--primar"
          disabled={arbetar}
          data-testid="registrera-inventering"
          onClick={() =>
            void kor(async () => {
              const resultat = await onRegistrera({ datum, poster });
              setPoster([]);
              return resultat;
            })
          }
        >
          Registrera inventering, {formatKronor(totaltNyPoster)} kr
        </button>
      )}

      {arbetar && <p data-testid="lager-arbetar">Arbetar …</p>}

      {besked !== undefined && (
        <p className="kort" role="status" data-testid="lager-besked">
          {besked}
        </p>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="lager-fel">
          {fel}
        </p>
      )}
    </section>
  );
}
