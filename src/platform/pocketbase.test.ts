import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvvisadError } from '../data/synk';
import { avvisning, fornyaInloggning, pocketbaseTransport } from './pocketbase';

const inloggning = { url: 'https://synk.example', token: 't', epost: 'a@example.se' };

/** A server that answers every request with the same status. */
function svararMed(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status })),
  );
}

describe('pocketbaseTransport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /*
   * A server set up before the file collection existed answers 404 for it.
   * Saying "404 when entries were fetched" sent the search to the log, which
   * was fine; what is missing is a collection, and it has a name.
   */
  it('names the collection a server is missing', async () => {
    svararMed(404);
    const transport = pocketbaseTransport(inloggning);

    await expect(transport.filadresser()).rejects.toThrow('saknar samlingen "filer"');
    await expect(transport.hamta(undefined)).rejects.toThrow(
      'saknar samlingen "handelser"',
    );
  });

  it('says what was being fetched when the server fails otherwise', async () => {
    svararMed(500);
    const transport = pocketbaseTransport(inloggning);

    await expect(transport.filadresser()).rejects.toThrow(
      'Servern svarade 500 när listan över underlag skulle hämtas.',
    );
    await expect(transport.hamta(undefined)).rejects.toThrow(
      'Servern svarade 500 när händelser skulle hämtas.',
    );
  });

  /*
   * The server that turned a phone's entries away in October 2026 said
   * exactly this. A refusal is about the one entry, so it is an
   * AvvisadError the sync can step past - and its message points at the
   * server, which is where the fix is.
   */
  it('reports an entry the server refuses as a refusal, with the reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"data":{"payload":{"code":"validation_max_text_constraint",' +
              '"message":"Must be no more than 5000 character(s).","params":{"max":5000}}},' +
              '"message":"Failed to create record.","status":400}',
            { status: 400 },
          ),
      ),
    );
    const skickat = pocketbaseTransport(inloggning).skicka([
      { op_id: 'x' as never, device: 'd', payload: 'p', created: '' },
    ]);

    await expect(skickat).rejects.toBeInstanceOf(AvvisadError);
    await expect(skickat).rejects.toThrow('tar inte emot så stora händelser');
  });

  it('still treats an entry already on the server as sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"data":{"op_id":{"code":"validation_not_unique"}}}', {
            status: 400,
          }),
      ),
    );

    await expect(
      pocketbaseTransport(inloggning).skicka([
        { op_id: 'x' as never, device: 'd', payload: 'p', created: '' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('asks for a new login when the token is no longer accepted', async () => {
    svararMed(401);

    await expect(pocketbaseTransport(inloggning).hamta(undefined)).rejects.toThrow(
      'Logga in igen',
    );
  });
});

/*
 * PocketBase does not refuse an expired token. It drops it and carries on as
 * a guest, and a guest is shown an empty list and refused every write with a
 * bare 400 - which is how a token that ran out after five days showed up as
 * "Servern svarade 400 när ett underlag skulle skickas". Renewing first is
 * what turns that into a question the server actually answers.
 */
describe('fornyaInloggning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('swaps the token for the one the server hands back', async () => {
    const anrop = vi.fn<typeof fetch>(
      async () => new Response('{"token":"ny"}', { status: 200 }),
    );
    vi.stubGlobal('fetch', anrop);

    const fornyad = await fornyaInloggning(inloggning);

    expect(fornyad).toEqual({ ...inloggning, token: 'ny' });
    expect(anrop.mock.calls[0]?.[0]).toBe(
      `${inloggning.url}/api/collections/users/auth-refresh`,
    );
    expect(anrop.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 't' });
  });

  it('asks for a new login when the token has run out', async () => {
    svararMed(401);

    await expect(fornyaInloggning(inloggning)).rejects.toThrow('Logga in igen');
  });

  it('says the network is unreachable rather than throwing the raw error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(fornyaInloggning(inloggning)).rejects.toThrow('Servern svarar inte');
  });
});

/**
 * A stand-in for the one thing skickaFil actually uses from XMLHttpRequest:
 * open, a header, onload/onerror, and send. No real network, and no jsdom -
 * the fake is the same shape the real thing has, and what is under test is
 * pocketbase.ts's own handling of status and body, not the browser's XHR
 * implementation.
 */
class FalskXhr {
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  huvuden: Record<string, string> = {};
  metod = '';
  url = '';

  open(metod: string, url: string) {
    this.metod = metod;
    this.url = url;
  }

  setRequestHeader(namn: string, varde: string) {
    this.huvuden[namn] = varde;
  }

  send() {
    FalskXhr.senaste = this;
    FalskXhr.skickade.push(this);
  }

  static senaste: FalskXhr | undefined;
  static skickade: FalskXhr[] = [];
  static reset() {
    FalskXhr.senaste = undefined;
    FalskXhr.skickade = [];
  }
}

describe('skickaFil', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FalskXhr.reset();
  });

  /*
   * XMLHttpRequest, not fetch - the workaround for the WebKit bug this
   * exists for. If it silently used fetch again, the underlag that
   * triggered the investigation would fail to sync the same way.
   */
  it('sends the file over XMLHttpRequest, not fetch', async () => {
    vi.stubGlobal('XMLHttpRequest', FalskXhr);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('fetch ska inte anropas för skickaFil');
      }),
    );

    const klart = pocketbaseTransport(inloggning).skickaFil(
      'a'.repeat(64),
      new Uint8Array([1, 2, 3]),
    );
    // The promise settles once onload fires, exactly like a real XHR.
    FalskXhr.senaste!.status = 200;
    FalskXhr.senaste!.onload?.();
    await klart;

    expect(FalskXhr.senaste?.metod).toBe('POST');
    expect(FalskXhr.senaste?.url).toBe(`${inloggning.url}/api/collections/filer/records`);
    expect(FalskXhr.senaste?.huvuden['Authorization']).toBe(inloggning.token);
  });

  it('treats a file already on the server as success, not an error', async () => {
    vi.stubGlobal('XMLHttpRequest', FalskXhr);

    const klart = pocketbaseTransport(inloggning).skickaFil(
      'a'.repeat(64),
      new Uint8Array([1]),
    );
    FalskXhr.senaste!.status = 400;
    FalskXhr.senaste!.responseText =
      '{"data":{"sha256":{"code":"validation_not_unique"}}}';
    FalskXhr.senaste!.onload?.();

    await expect(klart).resolves.toBeUndefined();
  });

  it('reports a refusal that is not the duplicate case', async () => {
    vi.stubGlobal('XMLHttpRequest', FalskXhr);

    const klart = pocketbaseTransport(inloggning).skickaFil(
      'a'.repeat(64),
      new Uint8Array([1]),
    );
    FalskXhr.senaste!.status = 400;
    FalskXhr.senaste!.responseText = '{"data":{"data":{"code":"validation_file_size"}}}';
    FalskXhr.senaste!.onload?.();

    await expect(klart).rejects.toThrow(
      'Servern svarade 400 när ett underlag skulle skickas.',
    );
  });

  it('says the network is unreachable rather than throwing the raw error', async () => {
    vi.stubGlobal('XMLHttpRequest', FalskXhr);

    const klart = pocketbaseTransport(inloggning).skickaFil(
      'a'.repeat(64),
      new Uint8Array([1]),
    );
    FalskXhr.senaste!.onerror?.();

    await expect(klart).rejects.toThrow('Servern svarar inte');
  });
});

describe('avvisning', () => {
  it('passes on what the server objected to when it is not a known case', () => {
    expect(
      avvisning('{"data":{"device":{"code":"x","message":"Cannot be blank."}}}'),
    ).toBe('Servern avvisade en händelse (device: Cannot be blank.).');
  });

  it('says so when the server gave no reason', () => {
    expect(avvisning('inte json')).toBe(
      'Servern avvisade en händelse utan att säga varför.',
    );
    expect(avvisning('{"data":{}}')).toBe(
      'Servern avvisade en händelse utan att säga varför.',
    );
  });
});
