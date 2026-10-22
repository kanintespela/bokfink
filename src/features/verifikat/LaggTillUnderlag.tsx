import { useRef, useState } from 'react';

import type { Underlag } from '../../domain/underlag/underlag';
import type { Forberedelse } from '../../platform/bild';
import type { Kvittobild } from '../underlag/Kvitton';
import { Beskar } from '../underlag/Beskar';

interface Props {
  /** The verifikat's beteckning, for the button that does the linking. */
  readonly beteckning: string;
  /** Receipts stored but not yet linked to anything. */
  readonly kvitton: readonly Kvittobild[];
  /** The underlag already linked to this verifikat. */
  readonly kopplade: readonly Underlag[];
  /**
   * Stores a picked file without linking it.
   *
   * Storing is one step and linking another, as in Kvitton: a picture that is
   * saved and then not linked waits in Kvitton rather than being lost, while
   * a link to the wrong verifikat cannot be taken back.
   */
  readonly onSpara: (fil: File, forberedelse?: Forberedelse) => Promise<Underlag>;
  readonly onKoppla: (underlag: Underlag) => Promise<void>;
  readonly onStang: () => void;
}

/**
 * Attaches evidence to a verifikat that is already booked.
 *
 * The receipt forgotten at booking is the normal case, and the data model
 * was built for it: the link lives on the underlag, so the booked posting is
 * untouched (hard rule 5) and the link is its own event in the log, with
 * when and by which device. Bokföringslagen 5 kap. 6 § wants a verifikation
 * for every affärshändelse; this is how a missing one is completed.
 *
 * Linking asks for one more tap than picking, because nothing offers to undo
 * it: once attached, the file is räkenskapsinformation and bokföringslagen 7
 * kap. 2 § keeps it for seven years.
 */
export function LaggTillUnderlag({
  beteckning,
  kvitton,
  kopplade,
  onSpara,
  onKoppla,
  onStang,
}: Props) {
  const kamera = useRef<HTMLInputElement>(null);
  const filer = useRef<HTMLInputElement>(null);
  const [valt, setValt] = useState<Underlag | undefined>();
  const [beskar, setBeskar] = useState<{ fil: File; url: string } | undefined>();
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | undefined>();

  /** Runs one step, showing why it failed rather than swallowing it. */
  async function kor(uppgift: () => Promise<void>) {
    setArbetar(true);
    setFel(undefined);
    try {
      await uppgift();
    } catch (orsak) {
      // Hard rule 11.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  function ta(valda: FileList | null, valjare: HTMLInputElement | null) {
    const fil = valda?.[0];
    if (valjare !== null) {
      // Cleared so the same file can be picked again.
      valjare.value = '';
    }
    if (fil === undefined) {
      return;
    }
    if (fil.type.startsWith('image/')) {
      setBeskar({ fil, url: URL.createObjectURL(fil) });
      return;
    }
    spara(fil);
  }

  function spara(fil: File, forberedelse?: Forberedelse) {
    void kor(async () => {
      const underlag = await onSpara(fil, forberedelse);
      if (kopplade.some((post) => post.id === underlag.id)) {
        throw new Error(`Den filen är redan underlag till ${beteckning}.`);
      }
      setValt(underlag);
    });
  }

  if (beskar !== undefined) {
    return (
      <Beskar
        fil={beskar.fil}
        url={beskar.url}
        filnamn={beskar.fil.name}
        onKlar={(forberedelse) => {
          URL.revokeObjectURL(beskar.url);
          setBeskar(undefined);
          spara(beskar.fil, forberedelse);
        }}
        onAvbryt={() => {
          URL.revokeObjectURL(beskar.url);
          setBeskar(undefined);
        }}
      />
    );
  }

  return (
    <div className="kort" data-testid="lagg-till-underlag">
      <input
        ref={kamera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="fota-underlag"
        onChange={(handelse) => ta(handelse.target.files, kamera.current)}
      />
      <input
        ref={filer}
        type="file"
        accept="image/*,application/pdf"
        hidden
        data-testid="valj-underlagsfil"
        onChange={(handelse) => ta(handelse.target.files, filer.current)}
      />

      {valt === undefined ? (
        <>
          <p>
            <button
              type="button"
              className="knapp knapp--primar"
              disabled={arbetar}
              onClick={() => kamera.current?.click()}
            >
              Fotografera kvitto
            </button>
          </p>
          <p>
            <button
              type="button"
              className="knapp"
              disabled={arbetar}
              onClick={() => filer.current?.click()}
            >
              Välj bild eller PDF
            </button>
          </p>

          {kvitton.length > 0 && (
            <>
              <p className="hjalptext">Eller välj ett kvitto som redan är fotat:</p>
              <ul className="kvittorutnat" data-testid="vantande-kvitton">
                {kvitton.map(({ underlag, url }) => (
                  <li key={underlag.id}>
                    <button
                      type="button"
                      className="kvitto"
                      aria-label={`Välj ${underlag.filnamn}`}
                      onClick={() => setValt(underlag)}
                    >
                      {underlag.mime === 'application/pdf' ? (
                        <span className="kvitto__pdf">PDF</span>
                      ) : (
                        <img src={url} alt={`Underlag ${underlag.filnamn}`} />
                      )}
                      <span className="listrad__sekundar">
                        {underlag.tillagd.slice(0, 10)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <>
          <p data-testid="valt-for-koppling">{valt.filnamn}</p>
          <p className="hjalptext">
            Kopplingen sparas med datum och går inte att ta bort efteråt. Konteringen
            ändras inte.
          </p>
          <button
            type="button"
            className="knapp knapp--primar"
            disabled={arbetar}
            data-testid="koppla-underlag"
            onClick={() =>
              void kor(async () => {
                await onKoppla(valt);
                onStang();
              })
            }
          >
            Koppla till {beteckning}
          </button>
          <button
            type="button"
            className="knapp knapp--text"
            disabled={arbetar}
            onClick={() => setValt(undefined)}
          >
            Välj ett annat
          </button>
        </>
      )}

      {fel !== undefined && (
        <p role="alert" data-testid="lagg-till-underlag-fel">
          {fel}
        </p>
      )}

      <button type="button" className="knapp knapp--text" onClick={onStang}>
        Avbryt
      </button>
    </div>
  );
}
