/**
 * When a business event is booked, and so when its VAT is reported.
 *
 * **Kontantmetoden** books when money moves. An invoice is nothing until it
 * is paid, so the VAT falls in the period of the payment. Allowed for smaller
 * businesses and the method these books use.
 *
 * **Faktureringsmetoden** books when the invoice is issued, with a receivable
 * or a payable standing until it is settled, so the VAT falls in the period
 * of the invoice.
 *
 * Bokföringslagen 5 kap. 2 § permits the cash method for a business whose
 * turnover is normally at most three million kronor, provided every unpaid
 * invoice is booked at the year end - which is what makes the two methods
 * agree over a full year and differ only inside it.
 */
export type Redovisningsmetod = 'kontantmetoden' | 'faktureringsmetoden';

export const METODNAMN: Record<Redovisningsmetod, string> = {
  kontantmetoden: 'Kontantmetoden',
  faktureringsmetoden: 'Faktureringsmetoden',
};

export const METODBESKRIVNING: Record<Redovisningsmetod, string> = {
  kontantmetoden:
    'Bokför när pengarna rör sig. Momsen redovisas i den period betalningen ' +
    'skedde. Obetalda fakturor bokförs vid bokslutet.',
  faktureringsmetoden:
    'Bokför när fakturan skrivs. Momsen redovisas i den period fakturan är ' +
    'daterad, även om betalningen kommer senare.',
};
