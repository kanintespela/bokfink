import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvvisadError } from '../data/synk';
import {
  avvisning,
  bockerPaServern,
  fornyaInloggning,
  pocketbaseTransport,
} from './pocketbase';

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
    const transport = pocketbaseTransport(inloggning, 'kontera');

    await expect(transport.filadresser()).rejects.toThrow('saknar samlingen "filer"');
    await expect(transport.hamta(undefined)).rejects.toThrow(
      'saknar samlingen "handelser"',
    );
  });

  it('says what was being fetched when the server fails otherwise', async () => {
    svararMed(500);
    const transport = pocketbaseTransport(inloggning, 'kontera');

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
    const skickat = pocketbaseTransport(inloggning, 'kontera').skicka([
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
      pocketbaseTransport(inloggning, 'kontera').skicka([
        { op_id: 'x' as never, device: 'd', payload: 'p', created: '' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('asks for a new login when the token is no longer accepted', async () => {
    svararMed(401);

    await expect(
      pocketbaseTransport(inloggning, 'kontera').hamta(undefined),
    ).rejects.toThrow('Logga in igen');
  });
});

/*
 * One server, several books. Every request names the book it is about, and
 * the server hands out only that book's rows - so what is checked here is
 * that no request goes out without the name, and that the one place another
 * book's entries could come in does not take them.
 */
describe('keeping books apart', () => {
  const BOK = '019b76da-a800-7000-8000-00000000b00c';

  afterEach(() => {
    vi.unstubAllGlobals();
    FalskXhr.reset();
  });

  /** A server that answers every request with the same body, and remembers them. */
  function svararAlltid(kropp: string, status = 200) {
    const anrop = vi.fn<typeof fetch>(async () => new Response(kropp, { status }));
    vi.stubGlobal('fetch', anrop);
    return anrop;
  }

  const adress = (anrop: ReturnType<typeof svararAlltid>, nummer = 0) =>
    new URL(String(anrop.mock.calls[nummer]?.[0]));

  it('names the book when it fetches entries', async () => {
    const anrop = svararAlltid('{"items":[]}');

    await pocketbaseTransport(inloggning, BOK).hamta(undefined);

    expect(adress(anrop).searchParams.get('bok')).toBe(BOK);
  });

  it('names the book on every entry it sends', async () => {
    const anrop = svararAlltid('{}');

    await pocketbaseTransport(inloggning, BOK).skicka([
      { op_id: 'x' as never, device: 'd', payload: 'p', created: '' },
    ]);

    expect(JSON.parse(String(anrop.mock.calls[0]?.[1]?.body))).toEqual({
      op_id: 'x',
      device: 'd',
      payload: 'p',
      bok: BOK,
    });
  });

  it('names the book when it lists, fetches and sends files', async () => {
    const anrop = svararAlltid('{"items":[]}');
    vi.stubGlobal('XMLHttpRequest', FalskXhr);
    const transport = pocketbaseTransport(inloggning, BOK);

    await transport.filadresser();
    await transport.hamtaFil('a'.repeat(64));
    const skickat = transport.skickaFil('a'.repeat(64), new Uint8Array([1]));
    FalskXhr.senaste!.status = 200;
    FalskXhr.senaste!.onload?.();
    await skickat;

    expect(adress(anrop, 0).searchParams.get('bok')).toBe(BOK);
    expect(adress(anrop, 1).searchParams.get('bok')).toBe(BOK);
    expect(FalskXhr.senaste?.kropp?.get('bok')).toBe(BOK);
  });

  it('hands the entries on without the server’s own book field', async () => {
    svararAlltid(
      `{"items":[{"id":"r1","op_id":"x","device":"d","payload":"p","created":"1","bok":"${BOK}"}]}`,
    );

    expect(await pocketbaseTransport(inloggning, BOK).hamta(undefined)).toEqual([
      { id: 'r1', op_id: 'x', device: 'd', payload: 'p', created: '1' },
    ]);
  });

  /*
   * What a server from before the change does: it ignores the name and
   * answers with everything it has. Folded into the book, those entries
   * could never be taken out again.
   */
  it.each([
    ['another book', '"bok":"kontera"'],
    ['no book at all', '"x":1'],
  ])('takes nothing when the server hands out entries of %s', async (_vad, falt) => {
    svararAlltid(
      `{"items":[{"id":"r1","op_id":"x","device":"d","payload":"p","created":"1",${falt}}]}`,
    );

    await expect(pocketbaseTransport(inloggning, BOK).hamta(undefined)).rejects.toThrow(
      'hör till en annan bok',
    );
  });

  it('refuses an identity that could not be a book’s', () => {
    expect(() => pocketbaseTransport(inloggning, 'a" || bok != "')).toThrow(
      'inte en bok som går att synka',
    );
    expect(() => pocketbaseTransport(inloggning, '')).toThrow(
      'inte en bok som går att synka',
    );
  });

  it('says a server has not heard of the book when it holds no row for it', async () => {
    const anrop = svararAlltid('{"items":[]}');

    expect(await pocketbaseTransport(inloggning, BOK).bokbeskrivning()).toBeUndefined();
    expect(adress(anrop).searchParams.get('filter')).toBe(`bok="${BOK}"`);
  });

  it('reads what the server has been told about the book', async () => {
    svararAlltid('{"items":[{"id":"r1","beskrivning":"{\\"namn\\":\\"Firman\\"}"}]}');

    expect(await pocketbaseTransport(inloggning, BOK).bokbeskrivning()).toBe(
      '{"namn":"Firman"}',
    );
  });

  /*
   * This is the call a round begins with, and the one a server without the
   * book collection cannot answer - which is what stops the round there.
   */
  it('names the missing collection on a server that does not keep books apart', async () => {
    svararAlltid('{}', 404);

    await expect(pocketbaseTransport(inloggning, BOK).bokbeskrivning()).rejects.toThrow(
      'saknar samlingen "bocker"',
    );
  });

  it('creates the book’s row the first time, and replaces it after that', async () => {
    const forsta = svararAlltid('{"items":[]}');
    await pocketbaseTransport(inloggning, BOK).beskrivBok('ny');

    expect(forsta.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(adress(forsta, 1).pathname).toBe('/api/collections/bocker/records');
    expect(JSON.parse(String(forsta.mock.calls[1]?.[1]?.body))).toEqual({
      bok: BOK,
      beskrivning: 'ny',
    });

    const andra = svararAlltid('{"items":[{"id":"r1","beskrivning":"gammal"}]}');
    await pocketbaseTransport(inloggning, BOK).beskrivBok('ny');

    expect(andra.mock.calls[1]?.[1]?.method).toBe('PATCH');
    expect(adress(andra, 1).pathname).toBe('/api/collections/bocker/records/r1');
  });

  it('lists the books a server holds, skipping what could not be one', async () => {
    svararAlltid(
      `{"items":[{"bok":"kontera","beskrivning":"a"},{"bok":"${BOK}","beskrivning":"b"},` +
        '{"bok":"../../etc","beskrivning":"c"},{"bok":"utan-beskrivning"}]}',
    );

    expect(await bockerPaServern(inloggning)).toEqual([
      { bok: 'kontera', beskrivning: 'a' },
      { bok: BOK, beskrivning: 'b' },
    ]);
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
  kropp: FormData | undefined;

  open(metod: string, url: string) {
    this.metod = metod;
    this.url = url;
  }

  setRequestHeader(namn: string, varde: string) {
    this.huvuden[namn] = varde;
  }

  send(kropp?: FormData) {
    this.kropp = kropp;
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

    const klart = pocketbaseTransport(inloggning, 'kontera').skickaFil(
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

    const klart = pocketbaseTransport(inloggning, 'kontera').skickaFil(
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

    const klart = pocketbaseTransport(inloggning, 'kontera').skickaFil(
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

    const klart = pocketbaseTransport(inloggning, 'kontera').skickaFil(
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
