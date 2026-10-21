import { oreFromKronor, type Ore } from '../belopp/ore';

/**
 * Skatteverkets årliga föreskrift om genomsnittlig produktionsutgift för
 * djur i jordbruk (senast sett: SKVFS), som IL 17 kap. 5 § pekar mot för att
 * värdera djurlager (se djurlager.ts).
 *
 * Bara fåren är byggda - det är det enda djurslaget i den här bokföringen.
 * Formen på tabellen har själv skiftat mellan år (SKVFS 2023:22 gav en
 * viktklasstabell för tackor/baggar; SKVFS 2025:27 gav i stället ett fast
 * pris per djur och ett kilopris för lamm) - så det här bär bara den
 * senare, enklare formen, och bara för de år den faktiskt är verifierad.
 * Ett saknat år vägras hellre än gissas, precis som skattetabell.ts.
 */
export interface FarProduktionsutgift {
  readonly ar: number;
  /** Kr per djur, tackor och baggar. */
  readonly tackaEllerBagge: Ore;
  /** Kr per kilo levande vikt. */
  readonly lammPerKg: Ore;
}

/**
 * SKVFS 2025:27, "beskattningsår som påbörjas under 2025": tackor och baggar
 * lägst 1 100 kr per styck, lamm lägst 20:20 kr per kilo levande vikt.
 */
const TABELL: readonly FarProduktionsutgift[] = [
  {
    ar: 2025,
    tackaEllerBagge: oreFromKronor('1100'),
    lammPerKg: oreFromKronor('20.20'),
  },
];

export class OkantProduktionsutgiftsarError extends Error {
  constructor(ar: number) {
    super(
      `Skatteverkets produktionsutgift för får ${ar} finns inte inlagd. Gissa ` +
        'aldrig på ett skattetal - lägg till året i djurproduktionsutgift.ts med ' +
        'källa till SKVFS-föreskriften innan lagret värderas mot den, eller ange ' +
        'produktionsutgiften för hand.',
    );
    this.name = 'OkantProduktionsutgiftsarError';
  }
}

export function farProduktionsutgift(ar: number): FarProduktionsutgift {
  const rad = TABELL.find((r) => r.ar === ar);
  if (rad === undefined) {
    throw new OkantProduktionsutgiftsarError(ar);
  }
  return rad;
}
