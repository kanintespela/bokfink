import { useEffect, useRef, useState } from 'react';

import {
  bedomUnderlag,
  vridenForhandsvisning,
  type Bildomdome,
  type Forberedelse,
  type Vridning,
} from '../../platform/bild';

interface Props {
  /** The picked file itself, so turning it can be rendered from the original. */
  readonly fil: File;
  /** The picked file, shown as an object URL made and revoked by the caller. */
  readonly url: string;
  readonly filnamn: string;
  readonly onKlar: (forberedelse: Forberedelse) => void;
  readonly onAvbryt: () => void;
  /** Skips the quality check, for a file that is not a photograph. */
  readonly granskaInte?: boolean;
}

/** The crop rectangle, as fractions of the picture rather than pixels. */
interface Ram {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Starts inset, so all four handles are visible and grabbable at once. */
const START: Ram = { x1: 0.08, y1: 0.08, x2: 0.92, y2: 0.92 };

const HORN = ['x1y1', 'x2y1', 'x1y2', 'x2y2'] as const;
type Horn = (typeof HORN)[number];

/**
 * Cutting the table away from around the receipt.
 *
 * Before it is stored, never after. A stored underlag is räkenskapsinformation
 * and bokföringslagen 7 kap. 2 § wants it kept in the form it had - so the
 * choice is offered once, on the way in, and what is saved is what was
 * chosen. Skipping is a button, not a hidden default.
 *
 * The frame is held as fractions of the picture rather than pixels, so it
 * survives the image being laid out at whatever size the phone has room for,
 * and the caller converts to source pixels once at the end.
 */
/**
 * What to say about a picture that is unlikely to be readable.
 *
 * Named for the remedy rather than the fault, because the remedy is what has
 * to happen in the next few seconds, while the receipt is still in reach.
 */
const OMDOMESTEXT: Record<Exclude<Bildomdome, 'duger'>, string> = {
  mork: 'Bilden är mörk. Texten blir svår att läsa — ta om den i bättre ljus?',
  suddig: 'Bilden är suddig. Håll stilla en stund till och ta om den?',
  liten: 'Kvittot är litet i bild. Gå närmare och ta om den?',
};

export function Beskar({ fil, url, filnamn, onKlar, onAvbryt, granskaInte }: Props) {
  const [ram, setRam] = useState<Ram>(START);
  const [drar, setDrar] = useState<Horn | undefined>();
  const [vridning, setVridning] = useState<Vridning>(0);
  const [vriden, setVriden] = useState<string | undefined>();
  /*
   * The verdict on the picture, once it has been asked for. Asked for when
   * saving rather than while the corners are being dragged: it is the crop
   * that gets stored, and judging a half-made one would say nothing.
   */
  const [omdome, setOmdome] = useState<Exclude<Bildomdome, 'duger'> | undefined>();
  const [granskar, setGranskar] = useState(false);
  const ytan = useRef<HTMLDivElement>(null);

  /*
   * The turned picture, rendered from the original each time rather than
   * turned again from the last one, so going round the circle costs nothing
   * in quality. Made here because it is an object URL with a lifetime: it has
   * to be handed back or the bytes stay alive for as long as the tab does.
   */
  useEffect(() => {
    if (vridning === 0) {
      return;
    }
    let avbruten = false;
    let skapad: string | undefined;

    vridenForhandsvisning(fil, vridning)
      .then((nyUrl) => {
        skapad = nyUrl;
        if (avbruten) {
          URL.revokeObjectURL(nyUrl);
          return;
        }
        setVriden(nyUrl);
      })
      .catch(() => {
        // Turning is a convenience; if it fails the untouched picture is
        // still there to crop and save.
        if (!avbruten) {
          setVridning(0);
        }
      });

    return () => {
      avbruten = true;
      if (skapad !== undefined) {
        URL.revokeObjectURL(skapad);
      }
    };
  }, [fil, vridning]);

  const visad = vridning === 0 ? url : (vriden ?? url);

  function flytta(horn: Horn, klientX: number, klientY: number) {
    const ruta = ytan.current?.getBoundingClientRect();
    if (ruta === undefined || ruta.width === 0 || ruta.height === 0) {
      return;
    }
    const x = Math.min(1, Math.max(0, (klientX - ruta.left) / ruta.width));
    const y = Math.min(1, Math.max(0, (klientY - ruta.top) / ruta.height));

    setRam((forra) => ({
      ...forra,
      ...(horn.startsWith('x1') ? { x1: x } : { x2: x }),
      ...(horn.endsWith('y1') ? { y1: y } : { y2: y }),
    }));
  }

  /**
   * Saves, unless the picture is worth a second attempt.
   *
   * The check happens here and not on the way in, because this is the last
   * moment when taking another photograph costs nothing: the receipt is still
   * in the hand. Afterwards no amount of processing puts back what the light
   * did not record.
   *
   * It warns and does not refuse. A poor photograph of a receipt is worth
   * more than no photograph, and only the person holding it knows whether
   * there is a second chance.
   */
  function spara(forberedelse: Forberedelse) {
    if (granskaInte === true || omdome !== undefined) {
      onKlar(forberedelse);
      return;
    }

    setGranskar(true);
    bedomUnderlag(fil, forberedelse)
      .then((utfall) => {
        if (utfall === 'duger') {
          onKlar(forberedelse);
          return;
        }
        setOmdome(utfall);
      })
      .catch(() => onKlar(forberedelse))
      .finally(() => setGranskar(false));
  }

  const vanster = Math.min(ram.x1, ram.x2);
  const topp = Math.min(ram.y1, ram.y2);
  const bredd = Math.abs(ram.x2 - ram.x1);
  const hojd = Math.abs(ram.y2 - ram.y1);

  return (
    <section aria-label="Beskär kvittot">
      <h2>Beskär</h2>
      <p className="tomt">
        Dra hörnen så att bara kvittot är kvar, och vrid det så att texten står rätt —
        appen kan bara läsa text som står vågrätt. Du kan också spara hela bilden.
      </p>

      <div
        className="beskar"
        ref={ytan}
        onPointerMove={(handelse) => {
          if (drar !== undefined) {
            handelse.preventDefault();
            flytta(drar, handelse.clientX, handelse.clientY);
          }
        }}
        onPointerUp={() => setDrar(undefined)}
        onPointerLeave={() => setDrar(undefined)}
      >
        <img src={visad} alt={`Underlag ${filnamn}`} />

        <div
          className="beskar__ram"
          style={{
            left: `${vanster * 100}%`,
            top: `${topp * 100}%`,
            width: `${bredd * 100}%`,
            height: `${hojd * 100}%`,
          }}
        />

        {HORN.map((horn) => (
          <button
            key={horn}
            type="button"
            className="beskar__horn"
            data-testid={`horn-${horn}`}
            aria-label={`Hörn ${horn}`}
            style={{
              left: `${(horn.startsWith('x1') ? ram.x1 : ram.x2) * 100}%`,
              top: `${(horn.endsWith('y1') ? ram.y1 : ram.y2) * 100}%`,
            }}
            onPointerDown={(handelse) => {
              // Captured so the drag survives the finger leaving the handle,
              // which it does immediately on a 44 px target.
              handelse.currentTarget.releasePointerCapture(handelse.pointerId);
              setDrar(horn);
            }}
          />
        ))}
      </div>

      {omdome !== undefined && (
        <div className="kort" data-testid="bildomdome">
          <p>{OMDOMESTEXT[omdome]}</p>
          <p className="hjalptext">Trycker du på Spara igen sparas bilden som den är.</p>
        </div>
      )}

      <p>
        <button
          type="button"
          className="knapp"
          data-testid="vrid"
          onClick={() => setVridning(((vridning + 90) % 360) as Vridning)}
        >
          Vrid
        </button>
      </p>

      <p>
        <button
          type="button"
          className="knapp knapp--primar"
          data-testid="spara-beskuret"
          disabled={granskar}
          onClick={() =>
            spara({ vridning, utsnitt: { x: vanster, y: topp, bredd, hojd } })
          }
        >
          Spara beskuret
        </button>
      </p>

      <p>
        <button
          type="button"
          className="knapp"
          data-testid="spara-hela"
          disabled={granskar}
          onClick={() => spara({ vridning })}
        >
          Spara hela bilden
        </button>
      </p>

      <p>
        <button type="button" className="knapp knapp--text" onClick={onAvbryt}>
          Avbryt
        </button>
      </p>
    </section>
  );
}
