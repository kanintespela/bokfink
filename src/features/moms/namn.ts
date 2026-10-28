import type { Momsperiod } from '../../domain/moms/period';

/** How often moms is declared, in the words of Skatteverket's own form. */
export const PERIODNAMN: Record<Momsperiod, string> = {
  manad: 'Varje månad',
  kvartal: 'Varje kvartal',
  ar: 'En gång om året',
};
