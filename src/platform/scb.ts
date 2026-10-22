import { oreFromKronor, type Ore } from '../domain/belopp/ore';

/**
 * SCB's statistikdatabas, table PR0101E "Prisbasbeloppet (Basbeloppet)".
 *
 * The only request Kontera makes to anyone but the owner's own sync server,
 * and only when the owner presses Hämta från SCB - decided 2026-09-13 as an
 * exception to hard rule 7 (docs/UTVECKLINGSPLAN.md, beslut Q). All it sends
 * is the year asked about. The data is published under CC0 and the API
 * answers browsers directly.
 */
const TABELL = 'https://api.scb.se/OV0104/v1/doris/sv/ssd/PR/PR0101/PR0101E/Basbeloppet';

export async function hamtaPrisbasbelopp(ar: number): Promise<Ore> {
  const svar = await fetch(TABELL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: [{ code: 'Tid', selection: { filter: 'item', values: [String(ar)] } }],
      response: { format: 'json' },
    }),
  }).catch(() => {
    throw new Error('SCB svarar inte. Kontrollera att du har nät och försök igen.');
  });

  if (svar.status === 400 || svar.status === 404) {
    throw new Error(`SCB har inget prisbasbelopp för ${ar} än.`);
  }
  if (!svar.ok) {
    throw new Error(`SCB svarade ${svar.status}. Försök igen senare.`);
  }

  const data = (await svar.json()) as {
    data?: { key?: string[]; values?: string[] }[];
  };
  const text = data.data?.find((rad) => rad.key?.[0] === String(ar))?.values?.[0];
  if (text === undefined || !/^\d+$/.test(text)) {
    throw new Error(`SCB har inget prisbasbelopp för ${ar} än.`);
  }
  return oreFromKronor(text);
}
