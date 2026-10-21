import type { Fjarrpost, Markor, Synktransport } from '../data/synk';

/**
 * The sync server, spoken to over its REST API.
 *
 * PocketBase is a postbox here, not a database: it stores envelopes, hands
 * them back in the order they arrived, and knows nothing about bookkeeping.
 * No hooks, no rules, no domain logic on the server - which is what makes the
 * claim in the plan true, that it could be swapped for a dumber store without
 * losing a rule (UTVECKLINGSPLAN 3.2).
 *
 * Written against the API directly rather than with the PocketBase SDK. Four
 * calls do not justify a dependency, and the SDK brings an auth store that
 * wants to live in localStorage - which is not where this app keeps things.
 */

/** The collection the log lives in. One is enough for the whole protocol. */
const COLLECTION = 'handelser';

/**
 * The collection the underlag files live in.
 *
 * Separate from the log on purpose, for the same reason the bytes live beside
 * the log on the device: entries are small, replayable and fetched in order,
 * while a file is megabytes fetched once. One row per content address, and
 * the bytes in it are ciphertext.
 */
const FILCOLLECTION = 'filer';

/** PocketBase's own page limit; asking for more is silently capped. */
const SIDSTORLEK = 500;

export interface Inloggning {
  readonly url: string;
  readonly token: string;
  readonly epost: string;
}

export class SynkfelError extends Error {
  constructor(meddelande: string) {
    super(meddelande);
    this.name = 'SynkfelError';
  }
}

/**
 * Signs in and returns the token.
 *
 * The password is used here and not kept. The token is what the app stores,
 * because a token can be revoked from the server and a password cannot.
 */
export async function loggaIn(
  url: string,
  epost: string,
  losenord: string,
): Promise<Inloggning> {
  const svar = await fetch(`${bas(url)}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: epost, password: losenord }),
  }).catch(() => {
    throw new SynkfelError(
      `Servern på ${url} svarar inte. Kontrollera adressen och att du är ansluten.`,
    );
  });

  if (!svar.ok) {
    throw new SynkfelError(
      svar.status === 400
        ? 'Fel e-postadress eller lösenord.'
        : `Servern svarade ${svar.status} när inloggningen försöktes.`,
    );
  }

  const data = (await svar.json()) as { token?: string };
  if (typeof data.token !== 'string') {
    throw new SynkfelError('Servern svarade utan en inloggningsnyckel.');
  }
  return { url: bas(url), token: data.token, epost };
}

/**
 * Trades the stored token for a fresh one, before a round uses it.
 *
 * PocketBase's tokens run out (five days on this server), and an expired one
 * is not refused: the server drops it and serves the request as a guest. A
 * guest sees empty lists and has every write turned away with a bare 400, so
 * without this a lapsed login looks like "nothing new" on the way down and a
 * mysterious refusal on the way up. auth-refresh is the one call that says
 * 401 to a dead token, which makes it both the renewal and the check.
 */
export async function fornyaInloggning(inloggning: Inloggning): Promise<Inloggning> {
  const svar = await fetch(`${inloggning.url}/api/collections/users/auth-refresh`, {
    method: 'POST',
    headers: { Authorization: inloggning.token },
  }).catch(() => {
    throw new SynkfelError('Servern svarar inte. Försök igen när du har nät.');
  });

  if (!svar.ok) {
    throw new SynkfelError(
      svar.status === 401 || svar.status === 403 || svar.status === 404
        ? 'Inloggningen mot servern har gått ut. Logga in igen.'
        : `Servern svarade ${svar.status} när inloggningen skulle förnyas.`,
    );
  }

  const data = (await svar.json()) as { token?: string };
  if (typeof data.token !== 'string') {
    throw new SynkfelError('Servern svarade utan en inloggningsnyckel.');
  }
  return { ...inloggning, token: data.token };
}

/** The transport the sync protocol asks for, over one PocketBase collection. */
export function pocketbaseTransport(inloggning: Inloggning): Synktransport {
  const huvuden = {
    'Content-Type': 'application/json',
    Authorization: inloggning.token,
  };

  return {
    async hamta(markor: Markor | undefined): Promise<Fjarrpost[]> {
      const alla: Fjarrpost[] = [];
      let fran = markor;

      /*
       * Paged with a cursor rather than an offset. Entries keep arriving
       * while a long catch-up runs, and an offset would skip whatever slid
       * past the page boundary in the meantime.
       */
      for (;;) {
        const parametrar = new URLSearchParams({
          sort: 'created,id',
          perPage: String(SIDSTORLEK),
          fields: 'id,op_id,device,payload,created',
        });
        if (fran !== undefined) {
          // Two entries can share a timestamp, so the id breaks the tie.
          parametrar.set(
            'filter',
            `created > "${fran.created}" || (created = "${fran.created}" && id > "${fran.id}")`,
          );
        }

        const sida = await las(
          `${inloggning.url}/api/collections/${COLLECTION}/records?${parametrar.toString()}`,
          huvuden,
          { samling: COLLECTION, vad: 'händelser' },
        );
        const poster = (sida.items ?? []) as Fjarrpost[];
        alla.push(...poster);

        const sista = poster[poster.length - 1];
        if (poster.length < SIDSTORLEK || sista === undefined) {
          return alla;
        }
        fran = { created: sista.created, id: sista.id ?? '' };
      }
    },

    async skicka(poster: readonly Fjarrpost[]): Promise<void> {
      for (const post of poster) {
        const svar = await fetch(
          `${inloggning.url}/api/collections/${COLLECTION}/records`,
          {
            method: 'POST',
            headers: huvuden,
            body: JSON.stringify({
              op_id: post.op_id,
              device: post.device,
              payload: post.payload,
            }),
          },
        ).catch(() => {
          throw new SynkfelError('Servern svarar inte. Försök igen när du har nät.');
        });

        if (svar.ok) {
          continue;
        }

        /*
         * A rejected duplicate is a success. The unique index on op_id is
         * what makes sending idempotent, so a retry after a half-finished
         * send is exactly the case this is here to allow.
         */
        if (svar.status === 400 && (await svar.text()).includes('op_id')) {
          continue;
        }

        throw new SynkfelError(
          `Servern svarade ${svar.status} när en händelse skulle skickas.`,
        );
      }
    },

    async filadresser(): Promise<readonly string[]> {
      const alla: string[] = [];
      for (let sida = 1; ; sida += 1) {
        const parametrar = new URLSearchParams({
          perPage: String(SIDSTORLEK),
          page: String(sida),
          fields: 'sha256',
          sort: 'sha256',
        });
        const svar = await las(
          `${inloggning.url}/api/collections/${FILCOLLECTION}/records?${parametrar.toString()}`,
          huvuden,
          { samling: FILCOLLECTION, vad: 'listan över underlag' },
        );
        const poster = (svar.items ?? []) as { sha256?: string }[];
        for (const post of poster) {
          if (typeof post.sha256 === 'string') {
            alla.push(post.sha256);
          }
        }
        if (poster.length < SIDSTORLEK) {
          return alla;
        }
      }
    },

    async skickaFil(adress: string, chiffer: Uint8Array): Promise<void> {
      /*
       * Multipart rather than JSON: base64 would add a third to every
       * receipt on the way up, and PocketBase stores a file field as a file.
       * The name is the address, so what lies in the store is inspectable
       * without being readable.
       */
      const kropp = new FormData();
      kropp.set('sha256', adress);
      kropp.set('data', new Blob([chiffer as BlobPart]), `${adress}.bin`);

      /*
       * XMLHttpRequest, not fetch, and only here.
       *
       * Every other call in this file is fetch, but this is the one with a
       * FormData body running inside an installed PWA's service worker - the
       * exact combination WebKit has a real bug in on iOS Safari, where the
       * Authorization header set on the fetch does not reach the server. It
       * showed up as this: the server's own log recorded the request with no
       * auth at all, a moment after a plain JSON request with the same token
       * had gone through. XHR upload is not routed through the page's fetch
       * event handling the same way, and is the documented workaround.
       */
      const { status, body } = await new Promise<{ status: number; body: string }>(
        (klar, fel) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${inloggning.url}/api/collections/${FILCOLLECTION}/records`);
          xhr.setRequestHeader('Authorization', inloggning.token);
          xhr.onload = () => klar({ status: xhr.status, body: xhr.responseText });
          xhr.onerror = () => fel(new Error('natverksfel'));
          xhr.send(kropp);
        },
      ).catch(() => {
        throw new SynkfelError('Servern svarar inte. Försök igen när du har nät.');
      });

      if (status >= 200 && status < 300) {
        return;
      }
      // Same reasoning as for an entry: the unique index turns a retry into
      // a no-op, and a file that is already there is a success.
      if (status === 400 && body.includes('sha256')) {
        return;
      }
      throw new SynkfelError(
        `Servern svarade ${status} när ett underlag skulle skickas.`,
      );
    },

    async hamtaFil(adress: string): Promise<Uint8Array | undefined> {
      const parametrar = new URLSearchParams({
        perPage: '1',
        filter: `sha256="${adress}"`,
        fields: 'id,collectionId,data',
      });
      const svar = await las(
        `${inloggning.url}/api/collections/${FILCOLLECTION}/records?${parametrar.toString()}`,
        huvuden,
        { samling: FILCOLLECTION, vad: 'ett underlag' },
      );
      const post = ((svar.items ?? []) as Filpost[])[0];
      if (post === undefined || typeof post.data !== 'string') {
        return undefined;
      }

      const fil = await fetch(
        `${inloggning.url}/api/files/${post.collectionId}/${post.id}/${post.data}`,
        { headers: { Authorization: inloggning.token } },
      ).catch(() => {
        throw new SynkfelError('Servern svarar inte. Försök igen när du har nät.');
      });
      if (!fil.ok) {
        throw new SynkfelError(
          `Servern svarade ${fil.status} när ett underlag skulle hämtas.`,
        );
      }
      return new Uint8Array(await fil.arrayBuffer());
    },
  };
}

interface Filpost {
  readonly id: string;
  readonly collectionId: string;
  /** The stored file's name, which is what the file endpoint is keyed on. */
  readonly data?: string;
}

/**
 * A GET against one collection, with the failure put in words.
 *
 * A 404 from PocketBase's record list means the collection does not exist -
 * a server set up before the file collection was added answers exactly that
 * for "filer" - so the message names the collection and how it is created,
 * rather than a status code that sends the search somewhere else.
 */
async function las(
  url: string,
  huvuden: Record<string, string>,
  { samling, vad }: { samling: string; vad: string },
): Promise<{ items?: unknown[] }> {
  const svar = await fetch(url, { headers: huvuden }).catch(() => {
    throw new SynkfelError('Servern svarar inte. Försök igen när du har nät.');
  });
  if (!svar.ok) {
    if (svar.status === 401 || svar.status === 403) {
      throw new SynkfelError(
        'Inloggningen mot servern gäller inte längre. Logga in igen.',
      );
    }
    throw new SynkfelError(
      svar.status === 404
        ? `Servern saknar samlingen "${samling}". Den skapas med ` +
            'server/pocketbase/skapa-collections.sh.'
        : `Servern svarade ${svar.status} när ${vad} skulle hämtas.`,
    );
  }
  return (await svar.json()) as { items?: unknown[] };
}

/** Without a trailing slash, so the paths below read as paths. */
function bas(url: string): string {
  return url.trim().replace(/\/+$/, '');
}
