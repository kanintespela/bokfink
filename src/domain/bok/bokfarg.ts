/**
 * The colours a book can be given, so that the open book can be told from the
 * others at a glance: a thin frame round the screen and a tint on the bar
 * along the bottom.
 *
 * The values live in base.css, one rule per id, because they differ between
 * the light and the dark theme. What is kept with a book is only the id.
 */
export const BOKFARGER = [
  'gron',
  'bla',
  'lila',
  'rosa',
  'rod',
  'orange',
  'gul',
  'turkos',
] as const;

export type Bokfarg = (typeof BOKFARGER)[number];

export const BOKFARGNAMN: Readonly<Record<Bokfarg, string>> = {
  gron: 'Grön',
  bla: 'Blå',
  lila: 'Lila',
  rosa: 'Rosa',
  rod: 'Röd',
  orange: 'Orange',
  gul: 'Gul',
  turkos: 'Turkos',
};

export function arBokfarg(varde: unknown): varde is Bokfarg {
  return typeof varde === 'string' && (BOKFARGER as readonly string[]).includes(varde);
}

/** The first colour no book uses yet, so two books rarely look alike. */
export function nastaLedigaFarg(anvanda: readonly (Bokfarg | undefined)[]): Bokfarg {
  return BOKFARGER.find((farg) => !anvanda.includes(farg)) ?? BOKFARGER[0];
}
