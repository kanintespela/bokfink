import { createContext, useContext } from 'react';

/**
 * How the open book's exported files are named (see filprefix in
 * src/data/bokregister.ts).
 *
 * A context rather than a prop: the screens that save files sit several
 * levels down, and none of them has any other reason to know which book is
 * open.
 */
export const FilprefixContext = createContext('kontera');

export function useFilprefix(): string {
  return useContext(FilprefixContext);
}
