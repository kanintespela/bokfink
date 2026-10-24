import { useCallback, useEffect, useState } from 'react';

import { bytNamnPaBok, filprefix, skapaBok, valjBok, type Bok } from './data/bokregister';
import {
  databasFor,
  lasBockerPaEnheten,
  register,
  registerkontext,
} from './data/instance';
import { Kontera } from './features/Kontera';
import { FilprefixContext } from './ui/bok';
import { UpdateBanner } from './ui/UpdateBanner';
import { Varumarke } from './ui/Varumarke';

interface Bocker {
  readonly bocker: readonly Bok[];
  readonly aktiv: Bok;
}

/**
 * Opens the chosen book.
 *
 * The app is keyed on the book, so switching unmounts everything that held
 * the previous one - loaded state, object URLs, the sync timer - rather than
 * trusting each of them to notice the database changed under it.
 */
export function App() {
  const [bocker, setBocker] = useState<Bocker | undefined>();
  const [fel, setFel] = useState<string | undefined>();

  useEffect(() => {
    // Hard rule 11: a register that cannot be read is said, not swallowed.
    lasBockerPaEnheten().then(setBocker, (orsak: unknown) =>
      setFel(orsak instanceof Error ? orsak.message : String(orsak)),
    );
  }, []);

  const lasOm = useCallback(async () => setBocker(await lasBockerPaEnheten()), []);

  const valj = useCallback(
    async (id: string) => {
      await valjBok(register, id);
      // The new book opens on its first screen, not on the list it was chosen from.
      globalThis.history.replaceState(null, '', '#attgora');
      await lasOm();
    },
    [lasOm],
  );

  if (bocker === undefined) {
    return (
      <>
        <UpdateBanner />
        <main>
          <Varumarke />
          {fel === undefined ? (
            <p>Läser bokföringen …</p>
          ) : (
            <p role="alert" data-testid="uppstart-fel">
              Bokfink kunde inte starta: {fel}
            </p>
          )}
        </main>
      </>
    );
  }

  const { aktiv } = bocker;
  return (
    <>
      <UpdateBanner />
      <FilprefixContext.Provider value={filprefix(aktiv)}>
        <Kontera
          key={aktiv.id}
          db={databasFor(aktiv)}
          bokval={{
            bocker: bocker.bocker,
            aktiv,
            onValj: valj,
            onSkapa: async (namn) => {
              const ny = await skapaBok(register, registerkontext, namn);
              await valj(ny.id);
            },
            onBytNamn: async (namn) => {
              await bytNamnPaBok(register, registerkontext, aktiv.id, namn);
              await lasOm();
            },
          }}
        />
      </FilprefixContext.Provider>
    </>
  );
}
