import { useEffect, useState } from 'react';

import type { Foreningsarsbokslut, Styrelseledamot } from '../../data/foreningsbokslut';
import { formatKronor, isZero, ZERO, type Ore } from '../../domain/belopp/ore';
import {
  arResultatrad,
  BALANSRADER,
  harInnehall,
  RADNAMN,
  RESULTATRADER,
  type Foreningsbokslut,
  type Foreningsrad,
} from '../../domain/bokslut/foreningsbokslut';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import { forvalsradFor } from '../../domain/bokslut/foreningsbokslut';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { Tillbaka } from '../../ui/Tillbaka';

interface Props {
  readonly onTillbaka: () => void;
  readonly rakenskapsar: readonly Rakenskapsar[];
  /** The book's name, which is the association's, as the form is headed. */
  readonly foreningsnamn: string;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly radval: ReadonlyMap<Kontonummer, Foreningsrad>;
  readonly styrelse: readonly Styrelseledamot[];
  readonly onHamta: (ar: Rakenskapsar) => Promise<Foreningsarsbokslut>;
  /** Places an account on a post, or with `rad` undefined back where it was by default. */
  readonly onRadval: (konto: Kontonummer, rad: Foreningsrad | undefined) => Promise<void>;
  readonly onStyrelse: (styrelse: readonly Styrelseledamot[]) => Promise<void>;
  /** Books the year's result onto eget kapital (8999 mot 2019). */
  readonly onBokforResultat: (ar: Rakenskapsar) => Promise<string>;
}

const INTAKTER = RESULTATRADER.slice(0, 5);
const KOSTNADER = RESULTATRADER.slice(5, 11);
const TILLGANGAR = BALANSRADER.slice(0, 8);
const SKULDER = BALANSRADER.slice(9);

/**
 * The year as BFNAR 2010:1's bilaga 2 sets it out, with the year before beside
 * it, the notes that apply and the lines the board signs.
 *
 * What is on the form is closed: no post is added or merged, and a post with
 * nothing to show in either year is left out. What is open is which account
 * goes on which post, and that is set further down, apart from the part that
 * is printed. The page books one thing, the transfer of the year's result onto
 * eget kapital, and only when asked.
 */
export function Foreningsbokslutsida({
  onTillbaka,
  rakenskapsar,
  foreningsnamn,
  konton,
  radval,
  styrelse,
  onHamta,
  onRadval,
  onStyrelse,
  onBokforResultat,
}: Props) {
  const aren = [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start));
  const [arId, setArId] = useState(aren[0]?.id);
  const [data, setData] = useState<Foreningsarsbokslut | undefined>();
  const [uppdatering, setUppdatering] = useState(0);
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();
  const [nyttNamn, setNyttNamn] = useState('');
  const [nyRoll, setNyRoll] = useState('');

  const ar = aren.find((kandidat) => kandidat.id === arId) ?? aren[0];

  useEffect(() => {
    if (ar === undefined) {
      return undefined;
    }
    let avbruten = false;
    onHamta(ar).then(
      (hamtat) => {
        if (!avbruten) {
          setData(hamtat);
        }
      },
      (orsak: unknown) => {
        // Hard rule 11: shown, not swallowed.
        if (!avbruten) {
          setFel(orsak instanceof Error ? orsak.message : String(orsak));
        }
      },
    );
    return () => {
      avbruten = true;
    };
  }, [ar, onHamta, uppdatering, radval, styrelse]);

  async function kor(uppgift: () => Promise<string | undefined>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
      setUppdatering((antal) => antal + 1);
    } catch (orsak) {
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  if (ar === undefined) {
    return (
      <p className="tomt" data-testid="inget-rakenskapsar">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  const aret = data?.aret;
  const fore = data?.foregaende;

  return (
    <section aria-label="Förenklat årsbokslut">
      <div className="ej-utskrift">
        <Tillbaka onTillbaka={onTillbaka} />
        <h2>Förenklat årsbokslut</h2>

        <div className="faltgrupp">
          <label htmlFor="foreningsbokslut-ar">Räkenskapsår</label>
          <select
            id="foreningsbokslut-ar"
            className="falt"
            value={ar.id}
            onChange={(handelse) => {
              setData(undefined);
              setArId(handelse.target.value as typeof ar.id);
            }}
          >
            {aren.map((kandidat) => (
              <option key={kandidat.id} value={kandidat.id}>
                {kandidat.start.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>

        {aret !== undefined && aret.kontonUtanRad.length > 0 && (
          <div className="kort" role="alert" data-testid="konton-utan-rad">
            <p>
              <strong>Bokslutet är inte klart.</strong> Dessa konton har ett belopp men
              hör inte till någon post. Placera dem under Konton och poster nedan.
            </p>
            <ul className="lista">
              {aret.kontonUtanRad.map((post) => (
                <li key={post.konto}>
                  {post.konto} {konton.get(post.konto)?.namn ?? ''}:{' '}
                  {formatKronor(post.belopp)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {aret !== undefined &&
          aret.kontonUtanRad.length === 0 &&
          data !== undefined &&
          !isZero(data.ejOverfortResultat) &&
          !ar.avslutat && (
            <div className="kort" data-testid="resultatoverforing">
              <p>
                <strong>Årets resultat är inte fört till eget kapital.</strong>{' '}
                {formatKronor(data.ejOverfortResultat)} sitter kvar på resultatkontona.
                Bokslutet ser likadant ut före och efter, men en bokförd överföring (8999
                mot 2019) gör att huvudboken visar samma sak. Ingen krona lämnar
                föreningen.
              </p>
              <button
                type="button"
                className="knapp"
                disabled={arbetar}
                data-testid="bokfor-resultatoverforing"
                onClick={() => void kor(() => onBokforResultat(ar))}
              >
                Bokför resultatet på {ar.slut}
              </button>
            </div>
          )}

        {data !== undefined && data.foregaende === undefined && (
          <p className="hjalptext" data-testid="inga-jamforelsetal">
            Det finns inget räkenskapsår före det här i boken, så jämförelsetalen saknas.
            De ska finnas med för varje post (BFNAR 2010:1, kapitel 5). Läs in det
            föregående året, till exempel ur en SIE-fil, före bokslutet skrivs under.
          </p>
        )}
      </div>

      {aret !== undefined && data !== undefined && (
        <div className="bokslut-utskrift" data-testid="foreningsbokslut">
          <h3>{foreningsnamn}</h3>
          <h3>
            Förenklat årsbokslut för räkenskapsåret {ar.start}–{ar.slut}
          </h3>

          <h4>Resultaträkning</h4>
          <table className="tabell" aria-label="Resultaträkning">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">
                  {ar.start}–{ar.slut}
                </th>
                <th scope="col">
                  {data.foregaendeAr === undefined
                    ? ''
                    : `${data.foregaendeAr.start}–${data.foregaendeAr.slut}`}
                </th>
              </tr>
            </thead>
            <tbody>
              <Rubrik text="Intäkter" />
              {visa(INTAKTER, aret, fore).map((rad) => (
                <Postrad
                  key={rad}
                  namn={RADNAMN[rad]}
                  aret={aret}
                  fore={fore}
                  rad={rad}
                />
              ))}
              <Summering
                text="Summa intäkter"
                aret={aret.summaIntakter}
                fore={fore?.summaIntakter}
              />

              <Rubrik text="Kostnader" />
              {visa(KOSTNADER, aret, fore).map((rad) => (
                <Postrad
                  key={rad}
                  namn={RADNAMN[rad]}
                  aret={aret}
                  fore={fore}
                  rad={rad}
                />
              ))}
              <Summering
                text="Summa kostnader"
                aret={aret.summaKostnader}
                fore={fore?.summaKostnader}
              />

              <Summering
                text="Verksamhetens över-/underskott"
                aret={aret.verksamhetensResultat}
                fore={fore?.verksamhetensResultat}
              />

              {visa(['finansiella_intakter', 'finansiella_kostnader'], aret, fore).map(
                (rad) => (
                  <Postrad
                    key={rad}
                    namn={RADNAMN[rad]}
                    aret={aret}
                    fore={fore}
                    rad={rad}
                  />
                ),
              )}
              {visa(['finansiella_intakter', 'finansiella_kostnader'], aret, fore)
                .length > 0 && (
                <Summering
                  text="Över-/underskott efter finansiella poster"
                  aret={aret.resultatEfterFinansiellaPoster}
                  fore={fore?.resultatEfterFinansiellaPoster}
                />
              )}
              {visa(['bokslutsdispositioner', 'skatt'], aret, fore).map((rad) => (
                <Postrad
                  key={rad}
                  namn={RADNAMN[rad]}
                  aret={aret}
                  fore={fore}
                  rad={rad}
                />
              ))}
              <Summering
                text="Årets över-/underskott"
                aret={aret.aretsResultat}
                fore={fore?.aretsResultat}
                data-testid="arets-resultat"
              />
            </tbody>
          </table>

          <h4>Balansräkning</h4>
          <table className="tabell" aria-label="Balansräkning">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">{ar.slut}</th>
                <th scope="col">{data.foregaendeAr?.slut ?? ''}</th>
              </tr>
            </thead>
            <tbody>
              <Rubrik text="Tillgångar" />
              {visa(TILLGANGAR, aret, fore).map((rad) => (
                <Postrad
                  key={rad}
                  namn={RADNAMN[rad]}
                  aret={aret}
                  fore={fore}
                  rad={rad}
                />
              ))}
              <Summering
                text="Summa tillgångar"
                aret={aret.summaTillgangar}
                fore={fore?.summaTillgangar}
              />

              <Rubrik text="Eget kapital" />
              <Summering
                text="Balanserade över-/underskott"
                aret={aret.balanseratResultat}
                fore={fore?.balanseratResultat}
                svag
              />
              <Summering
                text="Årets över-/underskott"
                aret={aret.aretsResultat}
                fore={fore?.aretsResultat}
                svag
              />
              <Summering
                text="Summa eget kapital"
                aret={aret.summaEgetKapital}
                fore={fore?.summaEgetKapital}
              />

              {harInnehall('obeskattade_reserver', aret, fore) && (
                <Postrad
                  namn={RADNAMN.obeskattade_reserver}
                  aret={aret}
                  fore={fore}
                  rad="obeskattade_reserver"
                />
              )}

              <Rubrik text="Skulder" />
              {visa(SKULDER, aret, fore).map((rad) => (
                <Postrad
                  key={rad}
                  namn={RADNAMN[rad]}
                  aret={aret}
                  fore={fore}
                  rad={rad}
                />
              ))}
              <Summering
                text="Summa skulder"
                aret={aret.summaSkulder}
                fore={fore?.summaSkulder}
              />
              <Summering
                text="Summa eget kapital och skulder"
                aret={aret.summaEgetKapitalOchSkulder}
                fore={fore?.summaEgetKapitalOchSkulder}
                data-testid="summa-ek-skulder"
              />
            </tbody>
          </table>

          {data.kapital.summaReserverat > 0 ||
          (data.foregaendeKapital?.summaReserverat ?? 0) > 0 ? (
            <div data-testid="not-andamalsbestamda">
              <h4>Ändamålsbestämda medel inom eget kapital</h4>
              <p>
                I eget kapital ingår ändamålsbestämda medel med{' '}
                {formatKronor(data.kapital.summaReserverat)}
                {data.foregaendeKapital === undefined
                  ? ''
                  : ` (${formatKronor(data.foregaendeKapital.summaReserverat)})`}
                .
              </p>
              <table className="tabell" aria-label="Ändamålsbestämda medel">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">Ingående</th>
                    <th scope="col">Årets förändring</th>
                    <th scope="col">Utgående</th>
                  </tr>
                </thead>
                <tbody>
                  {data.kapital.reserverade.map((post) => (
                    <tr key={post.konto}>
                      <th scope="row">{konton.get(post.konto)?.namn ?? post.konto}</th>
                      <td>{formatKronor(post.ingaende)}</td>
                      <td>{formatKronor((post.utgaende - post.ingaende) as Ore)}</td>
                      <td>{formatKronor(post.utgaende)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="underskrifter" data-testid="underskrifter">
            <p>Beslutat ____-__-__</p>
            {styrelse.length === 0 ? (
              <p className="ej-utskrift hjalptext">
                Lägg till styrelsens ledamöter nedan, så skrivs deras underskriftsrader
                ut.
              </p>
            ) : (
              <ul className="lista">
                {styrelse.map((ledamot) => (
                  <li key={`${ledamot.namn}-${ledamot.roll}`}>
                    <br />
                    <span>______________________________</span>
                    <br />
                    <span>
                      {ledamot.namn}
                      {ledamot.roll === '' ? '' : `, ${ledamot.roll}`}
                    </span>
                    <br />
                    <span>____-__-__</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="ej-utskrift">
        <p>
          <button
            type="button"
            className="knapp knapp--primar"
            data-testid="skriv-ut-bokslut"
            onClick={() => globalThis.print()}
          >
            Skriv ut eller spara som PDF
          </button>
        </p>

        {aret !== undefined && (
          <Kontoplacering
            aret={aret}
            fore={fore}
            konton={konton}
            radval={radval}
            arbetar={arbetar}
            onRadval={(konto, rad) =>
              void kor(async () => void (await onRadval(konto, rad)))
            }
          />
        )}

        <h3>Styrelsen</h3>
        <p className="hjalptext">
          Bokslutet ska dateras och skrivas under av samtliga styrelseledamöter. Namnen
          stannar i den här boken och skrivs bara ut på underskriftsraderna.
        </p>
        <ul className="lista" data-testid="styrelse">
          {styrelse.map((ledamot) => (
            <li key={`${ledamot.namn}-${ledamot.roll}`}>
              <span className="listrad">
                <span className="listrad__text">
                  <span>{ledamot.namn}</span>
                  <span className="listrad__sekundar">{ledamot.roll}</span>
                </span>
                <button
                  type="button"
                  className="knapp knapp--text"
                  disabled={arbetar}
                  onClick={() =>
                    void kor(
                      async () =>
                        void (await onStyrelse(
                          styrelse.filter((post) => post !== ledamot),
                        )),
                    )
                  }
                >
                  Ta bort
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="faltgrupp">
          <label htmlFor="styrelse-namn">Namn</label>
          <input
            id="styrelse-namn"
            className="falt"
            autoComplete="off"
            value={nyttNamn}
            onChange={(handelse) => setNyttNamn(handelse.target.value)}
          />
          <label htmlFor="styrelse-roll">Roll i styrelsen</label>
          <input
            id="styrelse-roll"
            className="falt"
            autoComplete="off"
            placeholder="ordförande, kassör, ledamot"
            value={nyRoll}
            onChange={(handelse) => setNyRoll(handelse.target.value)}
          />
        </div>
        <button
          type="button"
          className="knapp"
          disabled={arbetar || nyttNamn.trim() === ''}
          data-testid="lagg-till-ledamot"
          onClick={() =>
            void kor(async () => {
              await onStyrelse([...styrelse, { namn: nyttNamn, roll: nyRoll }]);
              setNyttNamn('');
              setNyRoll('');
              return undefined;
            })
          }
        >
          Lägg till ledamot
        </button>

        {besked !== undefined && (
          <p className="kort" role="status" data-testid="foreningsbokslut-besked">
            {besked}
          </p>
        )}
        {fel !== undefined && (
          <p role="alert" data-testid="foreningsbokslut-fel">
            {fel}
          </p>
        )}
      </div>
    </section>
  );
}

/** The posts of a group that have something to show in either year. */
function visa(
  rader: readonly Foreningsrad[],
  aret: Foreningsbokslut,
  fore: Foreningsbokslut | undefined,
): Foreningsrad[] {
  return rader.filter((rad) => harInnehall(rad, aret, fore));
}

function belopp(
  bokslut: Foreningsbokslut | undefined,
  rad: Foreningsrad,
): Ore | undefined {
  return bokslut === undefined ? undefined : (bokslut.rader.get(rad)?.belopp ?? ZERO);
}

function Kolumn({ varde }: { readonly varde: Ore | undefined }) {
  return <td>{varde === undefined ? '–' : formatKronor(varde)}</td>;
}

function Rubrik({ text }: { readonly text: string }) {
  return (
    <tr>
      <th scope="rowgroup" colSpan={3}>
        {text}
      </th>
    </tr>
  );
}

function Postrad({
  namn,
  rad,
  aret,
  fore,
}: {
  readonly namn: string;
  readonly rad: Foreningsrad;
  readonly aret: Foreningsbokslut;
  readonly fore: Foreningsbokslut | undefined;
}) {
  return (
    <tr data-testid={`rad-${rad}`}>
      <th scope="row">{namn}</th>
      <Kolumn varde={belopp(aret, rad)} />
      <Kolumn varde={belopp(fore, rad)} />
    </tr>
  );
}

function Summering({
  text,
  aret,
  fore,
  svag,
  ...rest
}: {
  readonly text: string;
  readonly aret: Ore;
  readonly fore: Ore | undefined;
  readonly svag?: boolean;
  readonly 'data-testid'?: string;
}) {
  const Text = svag === true ? 'span' : 'strong';
  return (
    <tr {...rest}>
      <th scope="row">
        <Text>{text}</Text>
      </th>
      <td>
        <Text>{formatKronor(aret)}</Text>
      </td>
      <td>
        <Text>{fore === undefined ? '–' : formatKronor(fore)}</Text>
      </td>
    </tr>
  );
}

/**
 * Which post each account is on, with the way to move one.
 *
 * Bilaga 2 gives no kontoplan, so this is the association's own call; the
 * default follows the account's number and is marked as such. Only a post of
 * the same kind is offered - a cost account stays among the costs.
 */
function Kontoplacering({
  aret,
  fore,
  konton,
  radval,
  arbetar,
  onRadval,
}: {
  readonly aret: Foreningsbokslut;
  readonly fore: Foreningsbokslut | undefined;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly radval: ReadonlyMap<Kontonummer, Foreningsrad>;
  readonly arbetar: boolean;
  readonly onRadval: (konto: Kontonummer, rad: Foreningsrad | undefined) => void;
}) {
  const kontonPaRader = new Map<Kontonummer, Foreningsrad>();
  for (const bokslut of [aret, fore]) {
    for (const rad of bokslut?.rader.values() ?? []) {
      for (const post of rad.poster) {
        kontonPaRader.set(post.konto, rad.rad);
      }
    }
  }
  const lista = [...kontonPaRader].sort((a, b) => Number(a[0]) - Number(b[0]));
  const alla = (rad: Foreningsrad) =>
    (arResultatrad(rad) ? RESULTATRADER : BALANSRADER).filter(
      (kandidat) => kandidat !== 'obeskattade_reserver' || !arResultatrad(rad),
    );

  return (
    <>
      <h3>Konton och poster</h3>
      <p className="hjalptext">
        Vilken post ett konto hör till avgör föreningen. Förvalet följer kontots nummer
        och är ett förslag: en medlemstidning hör till Verksamhetskostnader men en hyra
        till Övriga externa kostnader, och var till exempel fastighetens kostnader hör
        hemma är värt att stämma av med revisorn.
      </p>
      <ul className="lista" data-testid="kontoplacering">
        {lista.map(([konto, rad]) => {
          const forval = forvalsradFor(konto);
          return (
            <li key={konto}>
              <div className="faltgrupp">
                <label htmlFor={`placering-${konto}`}>
                  {konto} {konton.get(konto)?.namn ?? ''}
                </label>
                <select
                  id={`placering-${konto}`}
                  className="falt"
                  disabled={arbetar}
                  value={rad}
                  onChange={(handelse) => {
                    const val = handelse.target.value as Foreningsrad;
                    onRadval(konto, val === forval ? undefined : val);
                  }}
                >
                  {alla(rad).map((kandidat) => (
                    <option key={kandidat} value={kandidat}>
                      {RADNAMN[kandidat]}
                      {kandidat === forval && !radval.has(konto) ? ' (förval)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
