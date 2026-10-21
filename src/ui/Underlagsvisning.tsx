import { useEffect, useRef, useState } from 'react';

import { oppnaPdf, type Pdfvisning } from '../platform/pdf';

/** An underlag to look at: its object URL, what kind of file it is, its name. */
export interface Visat {
  readonly url: string;
  readonly mime: string;
  readonly filnamn: string;
}

/**
 * How much a tap enlarges the underlag.
 *
 * Two and a half times a phone's width puts a receipt's small print at about
 * the size of the text around it - enough to check an amount or a date
 * against what was booked.
 */
const FORSTORING = 2.5;

/**
 * Device pixels per CSS pixel to draw a PDF at, at most.
 *
 * Every page is drawn once, at its enlarged size, so enlarging it is free and
 * cannot leave a blank page half-drawn. A 3x screen at that size is 45
 * megabytes a page, and iOS stops drawing canvases altogether past a few
 * hundred; at 2x it is 20, and the enlarged text is still sharp.
 */
const MAX_TATHET = 2;

/**
 * An underlag in full size, inside the app.
 *
 * Not a new window: from an app on the iPhone's home screen, a link to the
 * file's blob URL opened nothing to look at, so the evidence behind a
 * booking could not be checked. A picture is shown as itself; a PDF is drawn
 * page by page, because Safari shows only the first page of a PDF it is
 * asked to embed.
 */
export function Underlagsvisning({
  underlag,
  onStang,
}: {
  readonly underlag: Visat;
  readonly onStang: () => void;
}) {
  const [forstorad, setForstorad] = useState(false);
  const stang = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    stang.current?.focus();
    const tangent = (handelse: KeyboardEvent) => {
      if (handelse.key === 'Escape') {
        onStang();
      }
    };
    window.addEventListener('keydown', tangent);
    return () => window.removeEventListener('keydown', tangent);
  }, [onStang]);

  const pdf = underlag.mime === 'application/pdf';

  return (
    <div
      className="underlagsvisning"
      role="dialog"
      aria-modal="true"
      aria-label={`Underlag ${underlag.filnamn}`}
      data-testid="underlagsvisning"
    >
      <div className="underlagsvisning__rad">
        <span className="listrad__sekundar">{underlag.filnamn}</span>
        <button ref={stang} type="button" className="knapp" onClick={onStang}>
          Stäng
        </button>
      </div>

      <button
        type="button"
        className={
          forstorad
            ? 'underlagsvisning__innehall underlagsvisning__innehall--forstorad'
            : 'underlagsvisning__innehall'
        }
        aria-pressed={forstorad}
        aria-label={forstorad ? 'Förminska underlaget' : 'Förstora underlaget'}
        onClick={() => setForstorad(!forstorad)}
      >
        {pdf ? (
          <Pdfsidor url={underlag.url} />
        ) : (
          <img src={underlag.url} alt={`Underlag ${underlag.filnamn}`} />
        )}
      </button>

      <p className="hjalptext underlagsvisning__hjalp">
        {forstorad
          ? 'Tryck på underlaget för att se hela igen.'
          : 'Tryck på underlaget för att förstora det.'}
      </p>
    </div>
  );
}

/** Every page of a PDF, drawn one after the other. */
function Pdfsidor({ url }: { readonly url: string }) {
  const [visning, setVisning] = useState<Pdfvisning | undefined>();
  const [fel, setFel] = useState<string | undefined>();
  const sidor = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => {
    let avbruten = false;
    let oppnad: Pdfvisning | undefined;

    async function oppna() {
      // A blob URL is read like any other; nothing leaves the device.
      const svar = await fetch(url);
      oppnad = await oppnaPdf(new Uint8Array(await svar.arrayBuffer()));
      if (!avbruten) {
        setVisning(oppnad);
      }
    }

    // Hard rule 11: a PDF that cannot be drawn says so.
    oppna().catch((orsak: unknown) => {
      if (!avbruten) {
        setFel(orsak instanceof Error ? orsak.message : String(orsak));
      }
    });

    return () => {
      avbruten = true;
      void oppnad?.stang();
    };
  }, [url]);

  useEffect(() => {
    if (visning === undefined) {
      return;
    }
    let avbruten = false;
    const bredd = document.documentElement.clientWidth * FORSTORING;
    const tathet = Math.min(window.devicePixelRatio || 1, MAX_TATHET);

    const ritade: HTMLCanvasElement[] = [];

    async function rita(oppnad: Pdfvisning) {
      // One page at a time, so a long PDF never holds two half-drawn pages.
      for (let nummer = 1; nummer <= oppnad.antalSidor && !avbruten; nummer += 1) {
        const canvas = sidor.current[nummer - 1];
        if (canvas !== null && canvas !== undefined) {
          ritade.push(canvas);
          await oppnad.rita(nummer, canvas, bredd, tathet);
        }
      }
    }

    rita(visning).catch((orsak: unknown) => {
      if (!avbruten) {
        setFel(orsak instanceof Error ? orsak.message : String(orsak));
      }
    });

    return () => {
      avbruten = true;
      // Handed back at once: iOS counts canvas memory until it is collected,
      // and large pages left behind stop the next ones from being drawn.
      for (const canvas of ritade) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [visning]);

  if (fel !== undefined) {
    return (
      <span role="alert" className="underlagsvisning__fel">
        PDF:en gick inte att visa. (Tekniskt fel: {fel})
      </span>
    );
  }
  if (visning === undefined) {
    return <span className="underlagsvisning__fel">Öppnar PDF:en …</span>;
  }
  return (
    <>
      {Array.from({ length: visning.antalSidor }, (_, index) => (
        <canvas
          key={index}
          ref={(canvas) => {
            sidor.current[index] = canvas;
          }}
          className="underlagsvisning__sida"
          aria-label={`Sida ${index + 1} av ${visning.antalSidor}`}
          data-testid="pdfsida"
        />
      ))}
    </>
  );
}
