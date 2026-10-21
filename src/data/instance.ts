import { skyddaBokfordaVerifikat } from './bokforing';
import { KonteraDatabase } from './db';

/**
 * The application's database.
 *
 * Tests build their own instances with throwaway names; nothing outside the
 * app entry point should reach for this one directly once repositories exist.
 */
export const db = new KonteraDatabase();

// Hard rule 5, applied to the live database rather than left to callers.
skyddaBokfordaVerifikat(db);
