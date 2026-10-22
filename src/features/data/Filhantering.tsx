import { useRef, useState } from 'react';

import type { Importfil } from '../../data/underlagsimport';
import type { Importrad } from '../../domain/underlag/underlagsimport';
import type { Rakenskapsar } from '../../domain/rakenskapsar/rakenskapsar';
import type { Uuid } from '../../domain/id/uuidv7';
import { delaEllerSpara, lasValdaFiler, type Valdfil } from '../../platform/fil';
import { Uppgiftsstatus, useUppgift } from './uppgift';

interface Props {
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly onImportera: (filer: readonly Uint8Array[]) => Promise<string>;
  /** What an underlag import would do, worked out before anything is written. */
  readonly onPlaneraUnderlag: (namn: readonly string[]) => readonly Importrad[];
  readonly onImporteraUnderlag: (
    filer: readonly Importfil[],
    plan: readonly Importrad[],
  ) => Promise<string>;
  readonly onExporteraSie: (rakenskapsarId: Uuid) => Promise<Uint8Array>;
  /** SIE, en PDF, alla underlag och en läsanvisning, zippat för sju års arkivering. */
  readonly onArkivpaket: (rakenskapsarId: Uuid) => Promise<Uint8Array>;
}

/**
 * The bookkeeping as files: in as SIE and underlag, out as SIE and archive.
 *
 * On a fresh install importing your history is the first thing that needs
 * doing, and leaving a service brings both halves - the verifikat and the
 * receipts - so they belong on the same screen.
 */
export function Filhantering({
  rakenskapsar,
  onImportera,
  onPlaneraUnderlag,
  onImporteraUnderlag,
  onExporteraSie,
  onArkivpaket,
}: Props) {
  const filvaljare = useRef<HTMLInputElement>(null);
  const underlagsvaljare = useRef<HTMLInputElement>(null);
  /* Files picked for import, held until the plan below them is accepted. */
  const [valdaUnderlag, setValdaUnderlag] = useState<readonly Valdfil[]>([]);
  const [underlagsplan, setUnderlagsplan] = useState<readonly Importrad[] | undefined>();
  const { arbetar, besked, fel, kor } = useUppgift();

  const nyastForst = [...rakenskapsar].sort((a, b) => (a.start < b.start ? 1 : -1));
  /*
   * Which year the exports are for. The newest by default, but any year can
   * be picked: a year is archived after it has closed, by which time the
   * next one already exists and is the newest.
   */
  const [valtArId, setValtArId] = useState<Rakenskapsar['id'] | undefined>();
  const senaste = nyastForst.find((ar) => ar.id === valtArId) ?? nyastForst[0];
  const arsnamn = senaste?.start.slice(0, 4) ?? '';

  return (
    <section aria-label="Filer, import och export">
      <h2>Bokföringen som filer</h2>

      <input
        ref={filvaljare}
        type="file"
        accept=".se,.si,.sie"
        multiple
        hidden
        data-testid="siefiler"
        onChange={(handelse) => {
          const valda = handelse.target.files;
          void kor(async () => {
            const filer = await lasValdaFiler(valda);
            if (filer.length === 0) {
              return 'Ingen fil valdes.';
            }
            const resultat = await onImportera(filer.map((fil) => fil.innehall));
            if (filvaljare.current !== null) {
              // Cleared so picking the same files again still fires a change.
              filvaljare.current.value = '';
            }
            return resultat;
          });
        }}
      />

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          onClick={() => filvaljare.current?.click()}
        >
          Importera SIE-filer
        </button>
      </p>

      {/*
       * The other half of leaving a service: the bookkeeping came in as SIE
       * above, and the receipts come in here. Nothing is written until the
       * summary below has been read and the import pressed (hard rule 10).
       */}
      <input
        ref={underlagsvaljare}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf"
        multiple
        hidden
        data-testid="underlagsfiler"
        onChange={(handelse) => {
          const valda = handelse.target.files;
          void kor(async () => {
            const filer = await lasValdaFiler(valda);
            if (underlagsvaljare.current !== null) {
              underlagsvaljare.current.value = '';
            }
            if (filer.length === 0) {
              return 'Ingen fil valdes.';
            }
            setValdaUnderlag(filer);
            setUnderlagsplan(onPlaneraUnderlag(filer.map((fil) => fil.namn)));
            return `${filer.length} filer lästa. Se vad importen tänker göra nedan.`;
          });
        }}
      />

      <p>
        <button
          type="button"
          className="knapp"
          disabled={arbetar}
          onClick={() => underlagsvaljare.current?.click()}
        >
          Välj underlag att importera
        </button>
      </p>

      <p className="hjalptext">
        Underlag från ett annat program kopplas till rätt verifikat via filnamnet:{' '}
        <strong>2025-A50-hosilage.pdf</strong> betyder verifikat A50 i räkenskapsåret som
        börjar 2025. Filer som inte kan placeras sparas ändå, utan koppling.
      </p>

      {underlagsplan !== undefined && (
        <div className="faltgrupp">
          <p>
            <strong>{underlagsplan.length} filer valda.</strong>{' '}
            {underlagsplan.filter((rad) => rad.verifikat !== undefined).length} kopplas
            till ett verifikat
            {underlagsplan.some((rad) => rad.verifikat === undefined) &&
              `, ${underlagsplan.filter((rad) => rad.verifikat === undefined).length} sparas utan koppling`}
            .
          </p>

          {underlagsplan.some((rad) => rad.verifikat === undefined) && (
            <ul>
              {underlagsplan
                .filter((rad) => rad.verifikat === undefined)
                .map((rad) => (
                  <li key={rad.namn} className="listrad__sekundar">
                    {rad.namn}: {rad.orsak}
                  </li>
                ))}
            </ul>
          )}

          <p>
            <button
              type="button"
              className="knapp knapp--primar"
              disabled={arbetar}
              data-testid="importera-underlag"
              onClick={() =>
                void kor(async () => {
                  const utfall = await onImporteraUnderlag(
                    valdaUnderlag.map((fil) => ({
                      namn: fil.namn,
                      mime: fil.typ,
                      data: fil.innehall,
                    })),
                    underlagsplan,
                  );
                  setValdaUnderlag([]);
                  setUnderlagsplan(undefined);
                  return utfall;
                })
              }
            >
              Importera {underlagsplan.length} underlag
            </button>
          </p>
        </div>
      )}

      {nyastForst.length > 1 && senaste !== undefined && (
        <div className="faltgrupp">
          <label htmlFor="exportar">Räkenskapsår att exportera</label>
          <select
            id="exportar"
            className="falt"
            value={senaste.id}
            onChange={(handelse) =>
              setValtArId(handelse.target.value as Rakenskapsar['id'])
            }
          >
            {nyastForst.map((ar) => (
              <option key={ar.id} value={ar.id}>
                {ar.start.slice(0, 4)}
              </option>
            ))}
          </select>
        </div>
      )}

      {senaste !== undefined && (
        <p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            onClick={() =>
              void kor(async () => {
                const bytes = await onExporteraSie(senaste.id);
                const namn = `kontera-${arsnamn}.se`;
                const utfall = await delaEllerSpara(
                  namn,
                  bytes,
                  'application/octet-stream',
                );
                return utfall === 'delad'
                  ? `SIE-filen för ${arsnamn} delades.`
                  : `SIE-filen sparades som ${namn}.`;
              })
            }
          >
            Exportera {arsnamn} som SIE
          </button>
        </p>
      )}

      {senaste !== undefined && (
        <p>
          <button
            type="button"
            className="knapp"
            disabled={arbetar}
            data-testid="exportera-arkivpaket"
            onClick={() =>
              void kor(async () => {
                const bytes = await onArkivpaket(senaste.id);
                const namn = `kontera-arkiv-${arsnamn}.zip`;
                const utfall = await delaEllerSpara(namn, bytes, 'application/zip');
                return utfall === 'delad'
                  ? `Arkivpaketet för ${arsnamn} delades.`
                  : `Arkivpaketet sparades som ${namn}.`;
              })
            }
          >
            Exportera arkivpaket för {arsnamn}
          </button>
        </p>
      )}

      <p className="hjalptext">
        Arkivpaketet är en zip-fil med bokföringen som SIE, en läsbar verifikationslista
        som PDF, alla kvitton och fakturor det året, och en läsanvisning — allt som behövs
        för att spara bokföringen i sju år utan att behöva Bokfink.
      </p>

      <Uppgiftsstatus arbetar={arbetar} besked={besked} fel={fel} />
    </section>
  );
}
