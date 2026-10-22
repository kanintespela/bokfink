import { Fragment, useState, type ReactNode } from 'react';

import { formatKronor, type Ore } from '../../domain/belopp/ore';
import type { Manadsvarde } from '../../domain/rapport/nyckeltal';
import type { Datum } from '../../domain/tid/datum';

/**
 * The charts, drawn as SVG by hand rather than by a charting library.
 *
 * Chart.js is in the plan's technology table and is not used: it is two
 * hundred kilobytes and a canvas renderer for four pictures that are bars and
 * a line. Written as SVG they inherit the app's colours through CSS
 * variables, work in dark mode without being told, scale to any width, and
 * carry their own figures as text - which is what makes them readable to
 * someone using a screen reader, and what a canvas cannot do at all.
 *
 * The dependency policy asks for exactly this trade to be made deliberately:
 * a few hundred lines of our own against a library that does more than is needed.
 */

const BREDD = 320;
/** Room above the plot for the label of its top line. */
const TOPP = 14;
const PLOTHOJD = 100;
/** The month letters under the plot. */
const AXEL = 16;
const HOJD = TOPP + PLOTHOJD + AXEL;

/**
 * A label is left off a line this close to another, rather than written on
 * top of it.
 */
const MINSTA_ETIKETTAVSTAND = 12;

const MANADER = [
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december',
];

interface Manadsserie {
  readonly varden: readonly Manadsvarde[];
  /** Months after this one have not happened, and are not drawn. */
  readonly idag: Datum;
  readonly etikett: string;
}

/**
 * Whether a month has begun.
 *
 * A month still to come has no result and no balance of its own - only the
 * one carried into it - and drawn as a zero bar or a flat stretch of line it
 * reads as a month that happened and was quiet.
 */
function harBorjat(varde: Manadsvarde, idag: Datum): boolean {
  return varde.manad <= idag.slice(0, 7);
}

function manadsnamn(manad: string): string {
  return MANADER[Number(manad.slice(5, 7)) - 1] ?? manad;
}

/**
 * A bar per month, above and below zero.
 *
 * Zero sits where the figures put it rather than in the middle, so a year of
 * only losses uses the whole height to tell its months apart.
 */
export function Manadsstaplar(props: Manadsserie) {
  return (
    <Manadsdiagram
      {...props}
      testid="manadsstaplar"
      rubrik={(varde, pagaende) =>
        `${versal(manadsnamn(varde.manad))} ${varde.manad.slice(0, 4)}` +
        (pagaende ? ' hittills' : '')
      }
      rita={({ varde, x, bredd, y, vald }) => {
        const topp = Math.min(y(varde.belopp), y(0 as Ore));
        const hojd = Math.abs(y(varde.belopp) - y(0 as Ore));
        return (
          <rect
            x={x - bredd / 2 + 1}
            y={topp}
            width={Math.max(1, bredd - 2)}
            height={Math.max(varde.belopp === 0 ? 0 : 1, hojd)}
            rx={1.5}
            className={
              (varde.belopp < 0
                ? 'diagram__stapel diagram__stapel--minus'
                : 'diagram__stapel') + (vald ? ' diagram__stapel--vald' : '')
            }
          />
        );
      }}
    />
  );
}

/**
 * A line for a position that carries forward, which a bar chart would
 * misrepresent: money in the bank in March is not a quantity that happened in
 * March.
 */
export function Manadslinje(props: Manadsserie) {
  return (
    <Manadsdiagram
      {...props}
      testid="manadslinje"
      rubrik={(varde, pagaende) =>
        pagaende
          ? 'I dag'
          : `I slutet av ${manadsnamn(varde.manad)} ${varde.manad.slice(0, 4)}`
      }
      linje
      rita={({ varde, x, y, vald }) => (
        <circle
          cx={x}
          cy={y(varde.belopp)}
          r={vald ? 5 : 3.5}
          className={vald ? 'diagram__punkt diagram__punkt--vald' : 'diagram__punkt'}
        />
      )}
    />
  );
}

interface Markering {
  readonly varde: Manadsvarde;
  /** The middle of the month's slot. */
  readonly x: number;
  readonly bredd: number;
  readonly y: (belopp: Ore) => number;
  readonly vald: boolean;
}

/**
 * What the two month charts have in common, which is everything but the mark.
 *
 * A picture without figures only says up or down. So the month letters run
 * along the bottom, the top and bottom lines say what they stand for, and the
 * figure for one month is always written out above the chart: the latest
 * month to begin with, and whichever month is tapped after that - a phone
 * has no hover, so a tooltip would never be seen. All of it is also offered
 * as a plain list, for the exact figures and for a screen reader.
 */
function Manadsdiagram({
  varden,
  idag,
  etikett,
  testid,
  rubrik,
  rita,
  linje = false,
}: Manadsserie & {
  readonly testid: string;
  readonly rubrik: (varde: Manadsvarde, pagaende: boolean) => string;
  readonly rita: (markering: Markering) => ReactNode;
  readonly linje?: boolean;
}) {
  const borjade = varden.filter((varde) => harBorjat(varde, idag));
  const [vald, setVald] = useState<string | undefined>();
  const visad =
    borjade.find((varde) => varde.manad === vald) ?? borjade[borjade.length - 1];

  const belopp = borjade.map((varde) => varde.belopp);
  const hogst = Math.max(0, ...belopp);
  const lagst = Math.min(0, ...belopp);
  const spann = Math.max(1, hogst - lagst);
  const y = (varde: Ore) => TOPP + ((hogst - varde) / spann) * PLOTHOJD;

  const bredd = BREDD / Math.max(1, varden.length);
  const mitt = (index: number) => index * bredd + bredd / 2;

  const stodlinjer = [
    { belopp: 0 as Ore, noll: true },
    ...(hogst > 0 ? [{ belopp: hogst as Ore, noll: false }] : []),
    ...(lagst < 0 ? [{ belopp: lagst as Ore, noll: false }] : []),
  ].filter(
    (linje) =>
      linje.noll || Math.abs(y(linje.belopp) - y(0 as Ore)) >= MINSTA_ETIKETTAVSTAND,
  );

  const pagaende = (varde: Manadsvarde) => varde.manad === idag.slice(0, 7);

  return (
    <div className="diagram" data-testid={testid}>
      {visad !== undefined && (
        <p
          className="diagram__avlasning"
          aria-live="polite"
          data-testid={`${testid}-avlasning`}
        >
          <span>{rubrik(visad, pagaende(visad))}</span>
          <strong className={visad.belopp < 0 ? 'belopp belopp--negativ' : 'belopp'}>
            {formatKronor(visad.belopp)}
          </strong>
        </p>
      )}

      <svg viewBox={`0 0 ${BREDD} ${HOJD}`} role="img" aria-label={etikett}>
        {stodlinjer.map((linje) => (
          <g key={linje.belopp}>
            <line
              x1={0}
              y1={y(linje.belopp)}
              x2={BREDD}
              y2={y(linje.belopp)}
              className={linje.noll ? 'diagram__nollinje' : 'diagram__stodlinje'}
            />
            <text x={2} y={y(linje.belopp) - 3} className="diagram__skala">
              {linje.noll ? '0' : formatKronor(linje.belopp)}
            </text>
          </g>
        ))}

        {visad !== undefined && (
          <line
            x1={mitt(varden.indexOf(visad))}
            y1={TOPP}
            x2={mitt(varden.indexOf(visad))}
            y2={TOPP + PLOTHOJD}
            className="diagram__markor"
          />
        )}

        {linje && borjade.length > 1 && (
          <polyline
            points={borjade
              .map((varde) => `${mitt(varden.indexOf(varde))},${y(varde.belopp)}`)
              .join(' ')}
            className="diagram__linje"
          />
        )}

        {varden.map((varde, index) => (
          <g key={varde.manad}>
            {harBorjat(varde, idag) &&
              rita({ varde, x: mitt(index), bredd, y, vald: varde === visad })}
            <text
              x={mitt(index)}
              y={HOJD - 3}
              className={
                varde === visad
                  ? 'diagram__manad diagram__manad--vald'
                  : harBorjat(varde, idag)
                    ? 'diagram__manad'
                    : 'diagram__manad diagram__manad--kommande'
              }
            >
              {manadsnamn(varde.manad).charAt(0).toUpperCase()}
            </text>
            {harBorjat(varde, idag) && (
              /*
               * The whole height of the month is the place to tap, not the
               * mark: a bar for a quiet month is a pixel high.
               */
              <rect
                x={index * bredd}
                y={0}
                width={bredd}
                height={HOJD}
                className="diagram__traffyta"
                onClick={() => setVald(varde.manad)}
              />
            )}
          </g>
        ))}
      </svg>

      {borjade.length > 0 && (
        <details className="diagram__siffror">
          <summary>Visa siffrorna</summary>
          <dl>
            {borjade.map((varde) => (
              <Fragment key={varde.manad}>
                <dt>{rubrik(varde, pagaende(varde))}</dt>
                <dd className={varde.belopp < 0 ? 'belopp belopp--negativ' : 'belopp'}>
                  {formatKronor(varde.belopp)}
                </dd>
              </Fragment>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

function versal(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface Andelar {
  readonly poster: readonly { readonly namn: string; readonly belopp: Ore }[];
  readonly etikett: string;
}

/**
 * Shares as bars rather than as a pie.
 *
 * A pie of six costs on a phone is six labels nobody can place. Bars carry
 * their own name and figure on the same line, sorted, which is the same
 * information in the shape a narrow screen can hold.
 */
export function Andelsstaplar({ poster, etikett }: Andelar) {
  const storsta = Math.max(1, ...poster.map((post) => post.belopp));

  return (
    <ul className="andelar" aria-label={etikett} data-testid="andelsstaplar">
      {poster.map((post) => (
        <li key={post.namn}>
          <div className="andelar__rad">
            <span className="andelar__namn">{post.namn}</span>
            <span className="belopp">{formatKronor(post.belopp)}</span>
          </div>
          <div className="andelar__spar">
            <div
              className="andelar__fyllnad"
              style={{ width: `${(post.belopp / storsta) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
