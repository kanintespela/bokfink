import { useRef, useState, type ReactNode } from 'react';

import type { Datum } from '../../domain/tid/datum';
import type { Underlag } from '../../domain/underlag/underlag';
import type { Forberedelse } from '../../platform/bild';
import { Underlagsvisning, type Visat } from '../../ui/Underlagsvisning';
import { Beskar } from './Beskar';
import { Forfallodag } from './Forfallodag';

export interface Kvittobild {
  readonly underlag: Underlag;
  /** An object URL for the stored bytes, made and revoked by the caller. */
  readonly url: string;
}

interface Props {
  readonly kvitton: readonly Kvittobild[];
  readonly onLaggTill: (
    filer: readonly File[],
    forberedelse?: Forberedelse,
  ) => Promise<string>;
  /** Takes the receipt to the booking form, where it will be attached. */
  readonly onBokfor: (kvitto: Kvittobild) => void;
  /**
   * Throws the picture away for good.
   *
   * Only offered here, where every receipt is one no verifikat has claimed. A
   * picture that is nobody's evidence is a picture, and a list that cannot be
   * tidied stops being read.
   */
  readonly onTaBort: (kvitto: Kvittobild) => Promise<void>;
  /** Sets, or with undefined removes, the due date of a waiting invoice. */
  readonly onForfallodag: (
    kvitto: Kvittobild,
    forfallodag: Datum | undefined,
  ) => Promise<void>;
  /** The text read out of the file, reading it first when nobody has. */
  readonly onLasText: (kvitto: Kvittobild) => Promise<string>;
  /** The drafts waiting for review, shown between the camera and the receipts. */
  readonly children?: ReactNode;
}

/**
 * The receipts that have been photographed but not booked yet.
 *
 * Photographing is deliberately separate from booking. A receipt is handed
 * over in a shop, in a hurry, often with one hand - and the bookkeeping for
 * it can wait until the evening. Splitting the two means the picture is safe
 * at the moment it would otherwise be lost, which is the failure this feature
 * exists to prevent; hard rule 10 keeps the booking itself a deliberate act.
 */
export function Kvitton({
  kvitton,
  onLaggTill,
  onBokfor,
  onTaBort,
  onForfallodag,
  onLasText,
  children,
}: Props) {
  const kamera = useRef<HTMLInputElement>(null);
  const filer = useRef<HTMLInputElement>(null);
  const [arbetar, setArbetar] = useState(false);
  const [besked, setBesked] = useState<string | undefined>();
  const [fel, setFel] = useState<string | undefined>();
  const [visar, setVisar] = useState<Visat | undefined>();
  /** The picked image waiting to be cropped, with the URL showing it. */
  const [beskar, setBeskar] = useState<{ fil: File; url: string } | undefined>();
  /** The receipt whose removal is waiting to be confirmed. */
  const [bekraftar, setBekraftar] = useState<string | undefined>();

  /**
   * Takes what was picked and, for a single image, offers to crop it first.
   *
   * One image is the photograph-in-a-shop case, where cutting the table away
   * makes the text bigger and the reading better. Several at once is the
   * evening-with-a-pile case, where being asked to crop each one would be
   * worse than not being asked at all.
   */
  function ta(valda: FileList | null, valjare: HTMLInputElement | null) {
    if (valda === null || valda.length === 0) {
      return;
    }
    const filer = [...valda];
    if (valjare !== null) {
      // Cleared so the same file can be picked again.
      valjare.value = '';
    }

    const ensam = filer[0];
    if (filer.length === 1 && ensam !== undefined && ensam.type.startsWith('image/')) {
      setBeskar({ fil: ensam, url: URL.createObjectURL(ensam) });
      return;
    }

    void spara(filer);
  }

  async function spara(filer: readonly File[], forberedelse?: Forberedelse) {
    await kor(() => onLaggTill(filer, forberedelse));
  }

  /** Runs one step and shows what it said, or why it could not. */
  async function kor(uppgift: () => Promise<string>) {
    setArbetar(true);
    setBesked(undefined);
    setFel(undefined);
    try {
      setBesked(await uppgift());
    } catch (orsak) {
      // Hard rule 11: a receipt that failed to store has to say so.
      setFel(orsak instanceof Error ? orsak.message : String(orsak));
    } finally {
      setArbetar(false);
    }
  }

  function slutBeskar(forberedelse: Forberedelse) {
    const pagaende = beskar;
    setBeskar(undefined);
    if (pagaende === undefined) {
      return;
    }
    URL.revokeObjectURL(pagaende.url);
    void spara([pagaende.fil], forberedelse);
  }

  if (beskar !== undefined) {
    return (
      <Beskar
        fil={beskar.fil}
        url={beskar.url}
        filnamn={beskar.fil.name}
        onKlar={slutBeskar}
        onAvbryt={() => {
          URL.revokeObjectURL(beskar.url);
          setBeskar(undefined);
        }}
      />
    );
  }

  return (
    <section aria-label="Kvitton">
      {visar !== undefined && (
        <Underlagsvisning underlag={visar} onStang={() => setVisar(undefined)} />
      )}
      <h2>Att bokföra</h2>

      <p className="tomt">Fotografera kvittot direkt, bokför det när du hinner.</p>

      {/*
       * capture asks iOS for the camera rather than the photo library, which
       * is the difference between two taps and five when standing in a shop.
       * The library is still reachable through the other button.
       */}
      <input
        ref={kamera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="fotografera"
        onChange={(handelse) => ta(handelse.target.files, kamera.current)}
      />
      <input
        ref={filer}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        data-testid="valj-underlag"
        onChange={(handelse) => ta(handelse.target.files, filer.current)}
      />

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

      {besked !== undefined && <p data-testid="kvitto-besked">{besked}</p>}
      {fel !== undefined && (
        <p role="alert" data-testid="kvitto-fel">
          {fel}
        </p>
      )}

      {children}

      <h2>Kvitton som väntar</h2>

      {kvitton.length === 0 ? (
        <p className="tomt" data-testid="inga-kvitton">
          Inga kvitton väntar.
        </p>
      ) : (
        <ul className="kvittorutnat" data-testid="kvittolista">
          {kvitton.map((kvitto) => {
            const { underlag, url } = kvitto;
            return (
              <li key={underlag.id}>
                <button
                  type="button"
                  className="kvitto"
                  aria-label={`Visa ${underlag.filnamn}`}
                  onClick={() =>
                    setVisar({ url, mime: underlag.mime, filnamn: underlag.filnamn })
                  }
                >
                  {underlag.mime === 'application/pdf' ? (
                    <span className="kvitto__pdf">PDF</span>
                  ) : (
                    <img src={url} alt={`Underlag ${underlag.filnamn}`} />
                  )}
                  <span className="listrad__sekundar">
                    {underlag.tillagd.slice(0, 10)} · {kilobyte(underlag.storlek)}
                  </span>
                </button>
                <button
                  type="button"
                  className="knapp knapp--text"
                  data-testid={`bokfor-${underlag.id}`}
                  onClick={() => onBokfor(kvitto)}
                >
                  Bokför kvittot
                </button>

                <Forfallodag
                  underlag={underlag}
                  onSpara={(forfallodag) => onForfallodag(kvitto, forfallodag)}
                  onLas={() => onLasText(kvitto)}
                />

                {bekraftar === underlag.id ? (
                  <>
                    <p className="hjalptext">
                      Ta bort bilden? Den går inte att få tillbaka.
                    </p>
                    <button
                      type="button"
                      className="knapp knapp--text"
                      data-testid={`bekrafta-bort-${underlag.id}`}
                      disabled={arbetar}
                      onClick={() => {
                        setBekraftar(undefined);
                        void kor(async () => {
                          await onTaBort(kvitto);
                          return 'Kvittot togs bort.';
                        });
                      }}
                    >
                      Ja, ta bort
                    </button>
                    <button
                      type="button"
                      className="knapp knapp--text"
                      onClick={() => setBekraftar(undefined)}
                    >
                      Avbryt
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="knapp knapp--text"
                    data-testid={`ta-bort-${underlag.id}`}
                    onClick={() => setBekraftar(underlag.id)}
                  >
                    Ta bort
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function kilobyte(byte: number): string {
  return byte < 1024 * 1024
    ? `${Math.round(byte / 1024)} kB`
    : `${(byte / 1024 / 1024).toFixed(1)} MB`;
}
