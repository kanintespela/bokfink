import { useMemo, useState } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import type { Konto, Kontonummer } from '../../domain/konto/konto';
import { perioder, type Momsperiod } from '../../domain/moms/period';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import { beraknaBalansrakning } from '../../domain/rapport/balansrakning';
import { beraknaResultatrakning } from '../../domain/rapport/resultatrakning';
import { beraknaPeriodsaldon } from '../../domain/rapport/saldon';
import {
  balansrakningTabell,
  resultatrakningTabell,
  type Tabell,
} from '../../domain/export/tabeller';
import { delar } from '../../domain/tid/datum';
import { Exportknappar } from './Exportknappar';
import type { BokfortVerifikat } from '../../domain/verifikat/verifikat';
import { useFilprefix } from '../../ui/bok';

interface Props {
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  /** Every booked verifikat, so a comparison can reach last year's. */
  readonly verifikat: readonly BokfortVerifikat[];
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly vilken: 'resultat' | 'balans';
}

const LANGDER: readonly { readonly varde: Momsperiod; readonly namn: string }[] = [
  { varde: 'ar', namn: 'Helår' },
  { varde: 'kvartal', namn: 'Kvartal' },
  { varde: 'manad', namn: 'Månad' },
];

/**
 * The resultat- and balansräkning, on a phone.
 *
 * The comparison figure sits under the main one rather than in a second
 * column. Two columns of kronor do not fit beside an account name at 375 px,
 * and the answer to "how does this compare" is read after the figure itself,
 * not beside it.
 */
export function Rakningar({ konton, verifikat, rakenskapsar, vilken }: Props) {
  const filprefix = useFilprefix();
  const ar = useMemo(
    () => [...rakenskapsar].sort((a, b) => b.start.localeCompare(a.start)),
    [rakenskapsar],
  );
  const [valtAr, setValtAr] = useState(() => ar[0]?.id);
  const [langd, setLangd] = useState<Momsperiod>('ar');
  const [periodIndex, setPeriodIndex] = useState(0);

  const aret = ar.find((kandidat) => kandidat.id === valtAr) ?? ar[0];

  const perioderna = useMemo(
    () => (aret === undefined ? [] : perioder(aret.start, aret.slut, langd)),
    [aret, langd],
  );
  const period = perioderna[Math.min(periodIndex, perioderna.length - 1)];

  /*
   * The same period a year earlier, which is what a comparison means in a
   * report. Shown only when that year is in the books - a first year has
   * nothing to be compared with, and an empty column would suggest zeroes
   * where there is simply no history.
   */
  const foregaende = useMemo(() => {
    if (aret === undefined || period === undefined) {
      return undefined;
    }
    const forra = ar.find(
      (kandidat) => delar(kandidat.start).ar === delar(aret.start).ar - 1,
    );
    if (forra === undefined) {
      return undefined;
    }
    const perioderFörra = perioder(forra.start, forra.slut, langd);
    const motsvarande = perioderFörra[perioderna.indexOf(period)];
    return motsvarande === undefined ? undefined : { ar: forra, period: motsvarande };
  }, [ar, aret, langd, period, perioderna]);

  const rapport = useMemo(() => {
    if (aret === undefined || period === undefined) {
      return undefined;
    }
    const saldon = beraknaPeriodsaldon(aret, verifikat, period.fran, period.till);
    return vilken === 'resultat'
      ? beraknaResultatrakning(saldon, konton)
      : beraknaBalansrakning(saldon, konton);
  }, [aret, konton, period, verifikat, vilken]);

  const jamforelse = useMemo(() => {
    if (foregaende === undefined) {
      return undefined;
    }
    const saldon = beraknaPeriodsaldon(
      foregaende.ar,
      verifikat,
      foregaende.period.fran,
      foregaende.period.till,
    );
    return vilken === 'resultat'
      ? beraknaResultatrakning(saldon, konton)
      : beraknaBalansrakning(saldon, konton);
  }, [foregaende, konton, verifikat, vilken]);

  if (aret === undefined || period === undefined || rapport === undefined) {
    return (
      <p className="tomt" data-testid="inget-rakenskapsar">
        Lägg upp ett räkenskapsår först.
      </p>
    );
  }

  const tabell: Tabell =
    'grupper' in rapport ? resultatrakningTabell(rapport) : balansrakningTabell(rapport);
  // Read out before the closure below: TypeScript will not carry the narrowing
  // above into a function declaration.
  const { fran, till } = period;

  const tidigare = (konto: Kontonummer): Ore | undefined => {
    if (jamforelse === undefined) {
      return undefined;
    }
    const alla =
      'grupper' in jamforelse
        ? jamforelse.grupper.flatMap((grupp) => grupp.poster)
        : [...jamforelse.tillgangar, ...jamforelse.egetKapitalOchSkulder].flatMap(
            (grupp) => grupp.poster,
          );
    return alla.find((post) => post.konto === konto)?.belopp;
  };

  return (
    <>
      <div className="faltgrupp">
        <label htmlFor="rapportar">Räkenskapsår</label>
        <select
          id="rapportar"
          className="falt"
          value={aret.id}
          onChange={(handelse) => setValtAr(handelse.target.value as typeof aret.id)}
        >
          {ar.map((kandidat) => (
            <option key={kandidat.id} value={kandidat.id}>
              {kandidat.start.slice(0, 4)}
            </option>
          ))}
        </select>

        <label htmlFor="rapportlangd">Period</label>
        <select
          id="rapportlangd"
          className="falt"
          value={langd}
          onChange={(handelse) => {
            setLangd(handelse.target.value as Momsperiod);
            setPeriodIndex(0);
          }}
        >
          {LANGDER.map((val) => (
            <option key={val.varde} value={val.varde}>
              {val.namn}
            </option>
          ))}
        </select>

        {perioderna.length > 1 && (
          <select
            className="falt"
            aria-label="Vilken period"
            value={String(perioderna.indexOf(period))}
            onChange={(handelse) => setPeriodIndex(Number(handelse.target.value))}
          >
            {perioderna.map((kandidat, index) => (
              <option key={kandidat.namn} value={index}>
                {kandidat.namn}
              </option>
            ))}
          </select>
        )}
      </div>

      <p className="hjalptext" data-testid="rapportperiod">
        {period.fran} till {period.till}
        {jamforelse !== undefined && foregaende !== undefined
          ? ` · jämförs med ${foregaende.period.namn}`
          : ' · ingen jämförelseperiod'}
      </p>

      <Exportknappar tabell={tabell} namn={`${filprefix}-${vilken}-${fran}-${till}`} />

      {'grupper' in rapport ? (
        <div data-testid="resultatrakning">
          {rapport.grupper.map((grupp) => (
            <Grupp key={grupp.rubrik} rubrik={grupp.rubrik} summa={grupp.summa}>
              {grupp.poster.map((post) => (
                <Rad
                  key={post.konto}
                  konto={post.konto}
                  namn={post.namn}
                  belopp={post.belopp}
                  tidigare={tidigare(post.konto)}
                />
              ))}
            </Grupp>
          ))}

          <Summa namn="Rörelseresultat" belopp={rapport.rorelseresultat} />
          <Summa
            namn="Periodens resultat"
            belopp={rapport.aretsResultat}
            tidigare={
              jamforelse !== undefined && 'aretsResultat' in jamforelse
                ? jamforelse.aretsResultat
                : undefined
            }
            stark
          />
        </div>
      ) : (
        <div data-testid="balansrakning">
          {rapport.tillgangar.map((grupp) => (
            <Grupp key={grupp.rubrik} rubrik={grupp.rubrik} summa={grupp.summa}>
              {grupp.poster.map((post) => (
                <Rad
                  key={post.konto}
                  konto={post.konto}
                  namn={post.namn}
                  belopp={post.belopp}
                  tidigare={tidigare(post.konto)}
                />
              ))}
            </Grupp>
          ))}
          <Summa namn="Summa tillgångar" belopp={rapport.summaTillgangar} stark />

          {rapport.egetKapitalOchSkulder.map((grupp) => (
            <Grupp key={grupp.rubrik} rubrik={grupp.rubrik} summa={grupp.summa}>
              {grupp.poster.map((post) => (
                <Rad
                  key={post.konto}
                  konto={post.konto}
                  namn={post.namn}
                  belopp={post.belopp}
                  tidigare={tidigare(post.konto)}
                />
              ))}
            </Grupp>
          ))}
          <Summa namn="Periodens resultat" belopp={rapport.aretsResultat} />
          <Summa
            namn="Summa eget kapital och skulder"
            belopp={rapport.summaEgetKapitalOchSkulder}
            stark
          />

          {rapport.differens !== 0 && (
            <p role="alert" data-testid="balansdifferens">
              Balansräkningen går inte ihop: {formatKronor(rapport.differens)} skiljer
              mellan sidorna. Det betyder att något är fel i bokföringen, inte i
              rapporten.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Grupp({
  rubrik,
  summa,
  children,
}: {
  readonly rubrik: string;
  readonly summa: Ore;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3>{rubrik}</h3>
      <ul className="lista">{children}</ul>
      <div className="listrad">
        <span className="listrad__text">Summa {rubrik.toLowerCase()}</span>
        <span className={`belopp${summa < 0 ? ' belopp--negativ' : ''}`}>
          {formatKronor(summa)}
        </span>
      </div>
    </section>
  );
}

function Rad({
  konto,
  namn,
  belopp,
  tidigare,
}: {
  readonly konto: Kontonummer;
  readonly namn: string;
  readonly belopp: Ore;
  readonly tidigare: Ore | undefined;
}) {
  return (
    <li>
      <div className="listrad">
        <span className="listrad__text">
          <span>
            {konto} {namn}
          </span>
          {tidigare !== undefined && (
            <span className="listrad__sekundar">
              föregående år {formatKronor(tidigare)}
            </span>
          )}
        </span>
        <span className={`belopp${belopp < 0 ? ' belopp--negativ' : ''}`}>
          {formatKronor(belopp)}
        </span>
      </div>
    </li>
  );
}

function Summa({
  namn,
  belopp,
  tidigare,
  stark,
}: {
  readonly namn: string;
  readonly belopp: Ore;
  readonly tidigare?: Ore | undefined;
  readonly stark?: boolean;
}) {
  return (
    <div className="listrad" data-testid={`summa-${namn}`}>
      <span className="listrad__text">
        {stark === true ? <strong>{namn}</strong> : namn}
        {tidigare !== undefined && (
          <span className="listrad__sekundar">
            föregående år {formatKronor(tidigare)}
          </span>
        )}
      </span>
      <span className={`belopp belopp--stort${belopp < 0 ? ' belopp--negativ' : ''}`}>
        {formatKronor(belopp)}
      </span>
    </div>
  );
}
