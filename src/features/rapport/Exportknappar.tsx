import { skrivCsv } from '../../domain/export/csv';
import { tillJson, type Tabell } from '../../domain/export/tabeller';
import { delaEllerSpara } from '../../platform/fil';

interface Props {
  readonly tabell: Tabell;
  /** Becomes the file name, so it has to say what the file is. */
  readonly namn: string;
  /**
   * Starts the test ids of the two buttons, `exportera-csv` and `exportera-json`
   * by default, so that a screen with two exports can tell them apart.
   */
  readonly idprefix?: string;
}

/**
 * Two ways out of the app for the report on screen.
 *
 * CSV for a person with a spreadsheet and JSON for a program, from the same
 * rows, so the two can never disagree about what the report said. Both are
 * open formats that outlive this app, which is the point of having them at
 * all - the promise is that leaving Bokfink costs nothing.
 */
export function Exportknappar({ tabell, namn, idprefix = 'exportera' }: Props) {
  async function exportera(format: 'csv' | 'json') {
    await delaEllerSpara(
      `${namn}.${format}`,
      format === 'csv'
        ? skrivCsv(tabell)
        : `${JSON.stringify(tillJson(tabell), undefined, 2)}\n`,
      format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',
    );
  }

  return (
    <p className="exportknappar">
      <button
        type="button"
        className="knapp knapp--text"
        data-testid={`${idprefix}-csv`}
        onClick={() => void exportera('csv')}
      >
        Exportera som CSV
      </button>
      <button
        type="button"
        className="knapp knapp--text"
        data-testid={`${idprefix}-json`}
        onClick={() => void exportera('json')}
      >
        Som JSON
      </button>
    </p>
  );
}
