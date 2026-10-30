import { useCallback, useEffect, useState } from 'react';

import type { Konto, Kontonummer } from '../domain/konto/konto';
import { kontonummer } from '../domain/konto/konto';
import { negate, type Ore } from '../domain/belopp/ore';
import {
  allaLov,
  lovForMallId,
  lovTillMall,
  momsForLov,
} from '../domain/beslutstrad/beslutstrad';
import { halvtPrisbasbelopp } from '../domain/skatt/skattetabell';
import {
  datumForAnnullering,
  type Ingaendebalans,
  type Rakenskapsar,
} from '../domain/rakenskapsar/rakenskapsar';
import {
  beteckning,
  skapaUtkast,
  type BokfortVerifikat,
  type Verifikatutkast,
} from '../domain/verifikat/verifikat';
import { verifikatserie } from '../domain/verifikat/serie';
import type { Uuid } from '../domain/id/uuidv7';
import {
  lasLogg,
  lasVerifikat,
  lasTillstand,
  senastBokforda,
  type Verifikatpost,
} from '../data/bokforing';
import type { KonteraDatabase } from '../data/db';
import { newIdentifier } from '../data/id';
import {
  annulleraVerifikat,
  rattaVerifikat,
  avslutaRakenskapsar,
  bokforUtkast,
  sparaUtkast,
  borttagbaraRakenskapsar,
  taBortRakenskapsar,
  momslas,
  mallanvandning,
  serieForEnhet,
  sattSerieForEnhet,
  skrivKonto,
  type Skrivkontext,
} from '../data/kommandon';
import {
  arsavslutschecklista,
  forUtgaendeBalanserTillNastaAr,
  skapaNastaRakenskapsar,
} from '../data/arsavslut';
import { lasBokprofil } from '../data/bokidentitet';
import { forberedBokforing } from '../data/uppstart';
import {
  kasseraUtkast,
  kopplaUnderlag,
  lasFil,
  okoppladeUnderlag,
  sparaUnderlag,
  sparaForfallodag,
  sparaUnderlagstext,
  taBortUnderlag,
} from '../data/underlag';
import { importeraUnderlag } from '../data/underlagsimport';
import {
  mimeAvFilnamn,
  planeraUnderlagsimport,
} from '../domain/underlag/underlagsimport';
import type { Underlag } from '../domain/underlag/underlag';
import { tolkaKvitto, type Kvittoforslag } from '../domain/underlag/kvittotolkning';
import { foreslaMallForText } from '../domain/mall/kvittomall';
import { assistentenSenast } from '../domain/underlag/assistent';
import {
  foreslaFranTidigare,
  tidigareKop,
  type TidigareKop,
} from '../domain/mall/leverantorsminne';
import { exporteraSomText, importera, las } from '../data/backup';
import { arKrypterad, laspaket, paketera } from '../data/kryptokopia';
import { glomServern, osankta, synka } from '../data/synk';
import {
  fornyaInloggning,
  loggaIn,
  pocketbaseTransport,
  type Inloggning,
} from '../platform/pocketbase';
import { Synk } from './synk/Synk';
import { useAutosynk } from './synk/autosynk';
import {
  dekryptera,
  harledNyckel,
  ITERATIONER,
  kryptera,
  nyttSalt,
} from '../platform/krypto';
import { synkkrypto } from '../platform/synkkrypto';
import {
  avyttraAnlaggningstillgang,
  berakningAvArsAvskrivning,
  bokforAvskrivning,
  registreraAnlaggningstillgang,
} from '../data/anlaggning';
import {
  avyttraFastighetstillgang,
  bokforFastighetsavskrivning,
  registreraFastighetstillgang,
} from '../data/fastighet';
import { bokforLagerforandring, registreraDjurlagerinventering } from '../data/lager';
import { bokforBokslutspost } from '../data/bokslutspost';
import {
  bokforEgetUttagInsattning,
  bokforResultatoverforing,
  egetkapitalsammanstallning,
} from '../data/egetkapital';
import { byggArkivpaket } from '../data/arkiv';
import type { Anlaggningstillgang } from '../domain/anlaggning/anlaggningstillgang';
import type { Fastighetstillgang } from '../domain/anlaggning/fastighetstillgang';
import type { Djurlagerinventering } from '../domain/lager/djurlager';
import { Anlaggningssida } from './anlaggning/Anlaggningssida';
import { Lagersida } from './lager/Lagersida';
import { Bokslutspostsida } from './bokslut/Bokslutspostsida';
import { Egetkapitalsida } from './bokslut/Egetkapitalsida';
import { Arsbokslutsida } from './bokslut/Arsbokslutsida';
import { lasRutval, sparaRutval } from '../data/rutval';
import { lasEgnaPrisbasbelopp, sparaPrisbasbelopp } from '../data/skattetal';
import { hamtaPrisbasbelopp } from '../platform/scb';
import { bokforMomsomforing } from '../data/momsomforing';
import { Nebilagasida } from './bokslut/Nebilagasida';
import {
  lasDeklarant,
  lasNejusteringar,
  sparaDeklarant,
  sparaNejusteringar,
} from '../data/nebilaga';
import type { Resultatrad } from '../domain/bokslut/forenkladArsbokslut';
import { exporteraSie } from '../data/sieexport';
import { importeraSieFiler } from '../data/sieimport';
import { dagarMellan, datum, datumAv, delar, type Datum } from '../domain/tid/datum';
import { klockslag, systemklocka } from '../platform/klocka';
import { AttGoraSida } from './attgora/AttGoraSida';
import { Utkastlista } from './utkast/Utkastlista';
import { FriKontering, type Friforslag } from './bokfor/FriKontering';
import { Kontosida } from './konton/Kontosida';
import { Momssida } from './moms/Momssida';
import { beraknaMomsrapport } from '../domain/moms/momsrapport';
import { momsredovisning } from '../domain/moms/momsredovisning';
import { skrivEskd } from '../domain/moms/eskd';
import { kodaLatin1 } from '../domain/export/latin1';
import { vantandeMomsdeklarationer } from '../domain/moms/deklarationsdag';
import { vantandeFakturor } from '../domain/underlag/forfallodag';
import { skrivIcs } from '../domain/kalender/ics';
import { arMomsregistrerad, type Bokprofil } from '../domain/bok/bokprofil';
import { paminnelser } from '../domain/kalender/paminnelser';
import type { Momsperiod } from '../domain/moms/period';
import type { Redovisningsmetod } from '../domain/moms/redovisningsmetod';
import { delaEllerSpara } from '../platform/fil';
import { hashaFil } from '../platform/hash';
import { forberedUnderlag } from '../platform/bild';
import {
  lasKvittotext,
  LASBAR_SAKERHET,
  OSAKER_SAKERHET,
  type Ocrresultat,
} from '../platform/ocr';
import { Rakenskapsarsida } from './rakenskapsar/Rakenskapsarsida';
import { StartPage } from './start/StartPage';
import { Bocker, type Bokval } from './bocker/Bocker';
import { useFilprefix } from '../ui/bok';
import { Enhetsinstallningar } from './data/Enhetsinstallningar';
import { Filhantering } from './data/Filhantering';
import { Foretagsinstallningar } from './data/Foretagsinstallningar';
import { Sakerhetskopia } from './data/Sakerhetskopia';
import { Rapporter } from './handelser/Rapporter';
import { Verifikatlista } from './verifikat/Verifikatlista';
import { doldaVyer, useVy, type Vy } from '../ui/vy';
import { Mer } from './mer/Mer';
import { Tillbaka } from '../ui/Tillbaka';
import { Varumarke } from '../ui/Varumarke';
import { Vyval } from '../ui/Vyval';
import { BokforUtgift } from './bokfor/BokforUtgift';
import { Kvitton, type Assistentstatus, type Kvittobild } from './underlag/Kvitton';
import { Bankimport } from './bank/Bankimport';
import { lasKontoutdrag, type Banktransaktion } from '../domain/bank/kontoutdrag';
import { matchaKontoutdrag } from '../domain/bank/matchning';
import { avkodaText } from '../platform/fil';

/** The account a bank statement is for, and what a bank line is booked to. */
const FORETAGSKONTO = kontonummer('1930');

/** The accounts money is paid from and into, for the reports. */
const BETALKONTON: readonly Kontonummer[] = [
  kontonummer('2017'),
  kontonummer('1930'),
  kontonummer('1910'),
];

interface Laddat {
  readonly anvandning: ReadonlyMap<Uuid, number>;
  readonly konton: ReadonlyMap<Kontonummer, Konto>;
  readonly serie: string;
  readonly poster: readonly Verifikatpost[];
  /** The verifikat in this year booked last, which is not poster[0]. */
  readonly senaste: readonly Verifikatpost[];
  /** Every year's verifikat, newest year first, for the verifikationslista. */
  readonly allaPoster: readonly Verifikatpost[];
  /** Oldest first, which is the order they should be dealt with in. */
  readonly utkast: readonly Verifikatutkast[];
  readonly ingaendeBalanser: readonly Ingaendebalans[];
  readonly rakenskapsar: readonly Rakenskapsar[];
  readonly aktuelltAr: Rakenskapsar | undefined;
  readonly momsperiod: Momsperiod;
  /** What kind of book this is, which decides the screens it has. */
  readonly profil: Bokprofil;
  /** Whether there is moms to declare; always so for a firm. */
  readonly momsregistrerad: boolean;
  readonly organisationsnummer: string;
  readonly metod: Redovisningsmetod;
  readonly kvitton: readonly Underlag[];
  readonly underlagPerVerifikat: ReadonlyMap<Uuid, readonly Underlag[]>;
  /** Booked purchases with a read receipt, for remembering suppliers. */
  readonly tidigareKop: readonly TidigareKop[];
  /** When the receipt assistant last wrote to the books, if it ever has. */
  readonly assistentenSenast: string | undefined;
  /** Every booked verifikat, across every year, for the reports. */
  readonly allaVerifikat: readonly BokfortVerifikat[];
  /** The fiscal years a removal would accept. Empty in the normal case. */
  readonly borttagbaraAr: ReadonlySet<Uuid>;
  /** Undefined when no backup has ever been taken on this device. */
  readonly dagarSedanBackup: number | undefined;
  readonly anlaggningar: readonly Anlaggningstillgang[];
  readonly fastigheter: readonly Fastighetstillgang[];
  readonly djurlagerinventeringar: readonly Djurlagerinventering[];
  readonly rutval: ReadonlyMap<Kontonummer, Resultatrad>;
  readonly egnaPrisbasbelopp: ReadonlyMap<number, Ore>;
  readonly synk: {
    readonly inloggning: Inloggning | undefined;
    readonly harLosenfras: boolean;
    readonly osankta: number;
    readonly senast: string | undefined;
    readonly enhet: string;
  };
}

/**
 * The last day of the year before this one.
 *
 * Imported history whose momsdeklarationer are filed is closed on the way in,
 * and the year being worked in is left open. Anything ending before this
 * January belongs to the first group.
 */
function forraArsslutet(idag: Datum): Datum {
  return datumAv(delar(idag).ar - 1, 12, 31);
}

/**
 * Encrypts a fresh export with a passphrase, ready to save or share.
 *
 * A fresh salt every time, so one cracking effort never covers two backups -
 * and the parameters travel with the file so the count can be raised later
 * without making old copies unreadable. Shared between the settings screen
 * and the one-tap backup on Att göra, so the two paths cannot drift apart.
 */
async function skapaKrypteradKopia(
  db: KonteraDatabase,
  losenfras: string,
): Promise<string> {
  const klartext = await exporteraSomText(db);
  const salt = nyttSalt();
  const nyckel = await harledNyckel(losenfras, salt, ITERATIONER);
  const { iv, chiffer } = await kryptera(nyckel, new TextEncoder().encode(klartext));
  return paketera({
    salt,
    iterationer: ITERATIONER,
    iv,
    chiffer,
    skapad: new Date().toISOString(),
  });
}

async function skrivkontext(db: KonteraDatabase): Promise<Skrivkontext> {
  const enhet = await db.getMeta<string>('deviceId');
  return {
    enhet: enhet ?? 'okand',
    nu: () => new Date().toISOString(),
    idag: () => systemklocka().idag(),
  };
}

/** How recently the assistant must have written for its reading to be promised. */
const ASSISTENT_AKTIV_MS = 14 * 24 * 60 * 60 * 1000;

/** How long after a receipt is added the assistant is taken to be reading it. */
const ASSISTENT_LASTID_MS = 5 * 60 * 1000;

/** How long a receipt the assistant left without a draft says so. */
const ASSISTENT_BESKED_MS = 60 * 60 * 1000;

export function Kontera({ db, bokval }: { db: KonteraDatabase; bokval: Bokval }) {
  const [begardVy, setVy] = useVy();
  const filprefix = useFilprefix();
  // Stable, so the NE screen reads a year once rather than on every render.
  const lasNeJusteringar = useCallback((arId: Uuid) => lasNejusteringar(db, arId), [db]);
  const lasNe = useCallback(
    async (arId: Uuid) => ({
      justeringar: await lasNejusteringar(db, arId),
      deklarant: await lasDeklarant(db),
    }),
    [db],
  );
  const [laddat, setLaddat] = useState<Laddat | undefined>();
  /*
   * The view shown is the one asked for unless this kind of book has no use
   * for it, in which case it is the overview - the same as an address that
   * never existed. Until the book is read nothing is hidden, and nothing is
   * shown either.
   */
  const dolda =
    laddat === undefined
      ? new Set<Vy>()
      : doldaVyer(laddat.profil, laddat.momsregistrerad);
  const vy: Vy = dolda.has(begardVy) ? 'attgora' : begardVy;
  const [fel, setFel] = useState<string | undefined>();
  const [senast, setSenast] = useState<string | undefined>();
  const [bilder, setBilder] = useState<readonly Kvittobild[]>([]);
  /** Object URLs for the files attached to verifikat, by content address. */
  const [underlagsbilder, setUnderlagsbilder] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  /*
   * The receipt a booking started from, if it started from one. Held here
   * rather than in the form, because the form is unmounted every time the
   * view changes and the attachment has to survive that.
   */
  const [valtKvitto, setValtKvitto] = useState<Uuid | undefined>();
  const [forslag, setForslag] = useState<Kvittoforslag | undefined>();
  /*
   * The leaf a receipt or a bank line points at, and why - said beside the
   * suggestion, because a suggestion without its reason is one nobody can
   * tell is wrong until it is booked.
   */
  const [forslagsmall, setForslagsmall] = useState<
    { readonly mall: Uuid; readonly skal: string } | undefined
  >();
  /** A booking from the questions carried over to be changed by hand. */
  const [friStart, setFriStart] = useState<Friforslag | undefined>();
  /** The draft open for changing, when the form is used for that. */
  const [andrarUtkast, setAndrarUtkast] = useState<Verifikatutkast | undefined>();
  const [ocr, setOcr] = useState<{ laser: boolean; fel?: string }>({ laser: false });
  /** A bank line being booked, which fills the form the way a receipt does. */
  const [bankrad, setBankrad] = useState<Banktransaktion | undefined>();
  /*
   * Bumped when something starts a fresh entry - a receipt from Kvitton, a
   * line from the bank. It is the form's key, so the fields are empty when a
   * new entry begins and are left alone when a photograph is attached to the
   * one in progress.
   */
  const [formularnyckel, setFormularnyckel] = useState(0);

  const hamta = useCallback(async (): Promise<Laddat> => {
    const [tillstand, anvandning, sparadSerie, kvitton] = await Promise.all([
      lasTillstand(db),
      mallanvandning(db),
      serieForEnhet(db),
      okoppladeUnderlag(db),
    ]);

    const idag = systemklocka().idag();
    const backupSenast = await db.getMeta<string>('backup.senast');
    const ar = [...tillstand.rakenskapsar.values()].find(
      (kandidat) => idag >= kandidat.start && idag <= kandidat.slut,
    );

    // The link is stored on the underlag, so the other direction is built
    // here rather than asked of the database once per row.
    const underlagPerVerifikat = new Map<Uuid, Underlag[]>();
    for (const post of tillstand.underlag.values()) {
      for (const verifikatId of post.verifikat) {
        const redan = underlagPerVerifikat.get(verifikatId);
        if (redan === undefined) {
          underlagPerVerifikat.set(verifikatId, [post]);
        } else {
          redan.push(post);
        }
      }
    }

    const profil = await lasBokprofil(db);
    const poster = ar === undefined ? [] : await lasVerifikat(db, ar.id);
    return {
      anvandning,
      konton: tillstand.konton,
      serie: sparadSerie ?? 'A',
      poster,
      senaste: await senastBokforda(db, poster, 3),
      allaPoster: (
        await Promise.all(
          [...tillstand.rakenskapsar.values()]
            .sort((a, b) => b.start.localeCompare(a.start))
            .map((kandidat) => lasVerifikat(db, kandidat.id)),
        )
      ).flat(),
      utkast: [...tillstand.utkast.values()].sort((a, b) =>
        a.datum.localeCompare(b.datum),
      ),
      ingaendeBalanser: ar?.ingaendeBalanser ?? [],
      rakenskapsar: [...tillstand.rakenskapsar.values()],
      aktuelltAr: ar,
      momsperiod: (await db.getMeta<Momsperiod>('momsperiod')) ?? 'kvartal',
      profil,
      momsregistrerad: arMomsregistrerad(
        profil,
        await db.getMeta<boolean>('momsregistrerad'),
      ),
      organisationsnummer: (await db.getMeta<string>('organisationsnummer')) ?? '',
      metod:
        (await db.getMeta<Redovisningsmetod>('redovisningsmetod')) ?? 'kontantmetoden',
      kvitton,
      underlagPerVerifikat,
      tidigareKop: tidigareKop(tillstand.underlag.values(), tillstand.verifikat, idag),
      assistentenSenast: assistentenSenast(await lasLogg(db)),
      allaVerifikat: [...tillstand.verifikat.values()],
      borttagbaraAr: await borttagbaraRakenskapsar(db),
      dagarSedanBackup:
        backupSenast === undefined ? undefined : dagarMellan(datum(backupSenast), idag),
      anlaggningar: [...tillstand.anlaggningar.values()],
      fastigheter: [...tillstand.fastigheter.values()],
      djurlagerinventeringar: [...tillstand.djurlagerinventeringar.values()].sort(
        (a, b) => b.datum.localeCompare(a.datum),
      ),
      rutval: await lasRutval(db),
      egnaPrisbasbelopp: await lasEgnaPrisbasbelopp(db),
      synk: {
        inloggning: await db.getMeta<Inloggning>('synk.inloggning'),
        harLosenfras: (await db.getMeta<string>('synk.losenfras')) !== undefined,
        osankta: await osankta(db),
        senast: await db.getMeta<string>('synk.senast'),
        enhet: (await db.getMeta<string>('deviceId')) ?? 'okänd',
      },
    };
  }, [db]);

  useEffect(() => {
    let avbruten = false;

    async function start() {
      await db.open();
      const enhet = await db.getMeta<string>('deviceId');
      const kontext: Skrivkontext = {
        enhet: enhet ?? 'okand',
        nu: () => new Date().toISOString(),
        idag: () => systemklocka().idag(),
      };

      await forberedBokforing(db, kontext, systemklocka());
      if ((await serieForEnhet(db)) === undefined) {
        await sattSerieForEnhet(db, verifikatserie('A'));
      }

      const nytt = await hamta();
      if (!avbruten) {
        setLaddat(nytt);
      }
    }

    // Hard rule 11: a failure here is shown, not swallowed into the console.
    start().catch((orsak: unknown) => {
      if (!avbruten) {
        setFel(orsak instanceof Error ? orsak.message : String(orsak));
      }
    });

    return () => {
      avbruten = true;
    };
  }, [db, hamta]);

  /*
   * Object URLs for the receipts waiting to be booked.
   *
   * Made here rather than in the view, because they are a resource with a
   * lifetime: every one has to be handed back or the tab keeps the bytes
   * alive for as long as it is open. Revoking twice is a no-op, which is what
   * makes the race between this effect being cancelled and its own loop
   * finishing harmless.
   */
  const kvitton = laddat?.kvitton;
  useEffect(() => {
    let avbruten = false;
    const urler: string[] = [];

    async function las() {
      const lista: Kvittobild[] = [];
      for (const underlag of kvitton ?? []) {
        const fil = await lasFil(db, underlag.sha256);
        if (fil === undefined) {
          continue;
        }
        const url = URL.createObjectURL(
          new Blob([fil.data as BlobPart], { type: fil.mime }),
        );
        urler.push(url);
        lista.push({ underlag, url });
      }
      if (avbruten) {
        urler.forEach(URL.revokeObjectURL);
        return;
      }
      setBilder(lista);
    }

    las().catch((orsak: unknown) => {
      if (!avbruten) {
        setFel(orsak instanceof Error ? orsak.message : String(orsak));
      }
    });

    return () => {
      avbruten = true;
      urler.forEach(URL.revokeObjectURL);
    };
  }, [db, kvitton]);

  /*
   * The same for the evidence already attached to a verifikat, so the list
   * can show a receipt rather than only name it - and for the receipts on a
   * draft, which are linked the same way.
   *
   * Only while one of those lists is open. Four years of receipts is fourteen
   * megabytes, and holding object URLs for all of them from the start would
   * keep the bytes alive in every other view for nothing. A file that is not
   * on this device is simply absent from the map, and the list says so.
   */
  const underlagPerVerifikat = laddat?.underlagPerVerifikat;
  const visarUnderlag = vy === 'verifikat' || vy === 'kvitton';
  useEffect(() => {
    if (!visarUnderlag) {
      return;
    }
    let avbruten = false;
    const urler: string[] = [];

    async function las() {
      const karta = new Map<string, string>();
      for (const lista of underlagPerVerifikat?.values() ?? []) {
        for (const post of lista) {
          if (karta.has(post.sha256)) {
            continue;
          }
          const fil = await lasFil(db, post.sha256);
          if (fil === undefined) {
            continue;
          }
          const url = URL.createObjectURL(
            new Blob([fil.data as BlobPart], { type: fil.mime }),
          );
          urler.push(url);
          karta.set(post.sha256, url);
        }
      }
      if (avbruten) {
        urler.forEach(URL.revokeObjectURL);
        return;
      }
      setUnderlagsbilder(karta);
    }

    las().catch((orsak: unknown) => {
      if (!avbruten) {
        setFel(orsak instanceof Error ? orsak.message : String(orsak));
      }
    });

    return () => {
      avbruten = true;
      urler.forEach(URL.revokeObjectURL);
      setUnderlagsbilder(new Map());
    };
  }, [db, visarUnderlag, underlagPerVerifikat]);

  /*
   * One sync round, used both by the button and by the automatic rounds.
   *
   * Held in a callback rather than written into the JSX because the hook
   * below needs the same function, and two copies of it would be two places
   * to change the day the result line grows a sentence.
   */
  const korSynk = useCallback(async () => {
    const lagrad = laddat?.synk.inloggning;
    const fras = await db.getMeta<string>('synk.losenfras');
    // The passphrase is optional (decision X); without one the entries go
    // to the server as they are.
    if (laddat === undefined || lagrad === undefined) {
      throw new Error('Logga in mot servern först.');
    }

    // Renewed every round, so the login lasts as long as the app is used
    // rather than five days from when the password was typed.
    const inloggning = await fornyaInloggning(lagrad);
    await db.setMeta('synk.inloggning', inloggning);

    const resultat = await synka(
      db,
      pocketbaseTransport(inloggning),
      await synkkrypto(fras),
      laddat.synk.enhet,
      { hasha: hashaFil },
    );
    await db.setMeta('synk.senast', new Date().toISOString());
    setLaddat(await hamta());

    const filer =
      resultat.filerSkickade === 0 && resultat.filerMottagna === 0
        ? ''
        : ` ${resultat.filerSkickade} underlag skickade och ` +
          `${resultat.filerMottagna} hämtade.`;
    const avvisade =
      resultat.filerAvvisade === 0
        ? ''
        : ` ${resultat.filerAvvisade} underlag stämde inte mot sin ` +
          'kontrollsumma och lämnades kvar på servern.';

    /*
     * Thrown only now, after the round has been recorded and the screen
     * refreshed: everything else went through, and what is shown should say
     * so. But thrown, so the automatic round reports it like any other
     * failure instead of calling the round a success (hard rule 11).
     */
    if (resultat.avvisade > 0) {
      throw new Error(
        `${resultat.avvisade} ${resultat.avvisade === 1 ? 'händelse' : 'händelser'} ` +
          `kunde inte skickas och försöks igen vid nästa synk. ` +
          `${resultat.avvisningsorsak ?? ''} Allt annat är synkat.`,
      );
    }

    return (
      `${resultat.skickade} skickade, ${resultat.mottagna} hämtade` +
      (resultat.nya === 0
        ? '.'
        : `, varav ${resultat.nya} var nya för den här enheten.`) +
      filer +
      avvisade
    );
  }, [db, laddat, hamta]);

  const [autosynkfel, setAutosynkfel] = useState<string | undefined>();

  /*
   * What the assistant is doing with a receipt, in books where it has been
   * at work lately. It runs every two minutes and a reading takes about one,
   * so a receipt is "being read" for five minutes after it was added; still
   * without a draft after that, it did not get one, and the reason went to
   * the owner's chat. After an hour the receipt is simply waiting again. Two
   * weeks without a word from the assistant and nothing is promised at all.
   */
  const assistentstatus = (underlag: Underlag): Assistentstatus | undefined => {
    const senast = laddat?.assistentenSenast;
    if (senast === undefined) {
      return undefined;
    }
    const nu = Date.now();
    if (nu - Date.parse(senast) >= ASSISTENT_AKTIV_MS) {
      return undefined;
    }
    const alder = nu - Date.parse(underlag.tillagd);
    return alder < ASSISTENT_LASTID_MS
      ? 'laser'
      : alder < ASSISTENT_BESKED_MS
        ? 'inget-utkast'
        : undefined;
  };
  const vantarPaAssistenten =
    vy === 'kvitton' &&
    (laddat?.kvitton ?? []).some((kvitto) => assistentstatus(kvitto) === 'laser');

  useAutosynk({
    aktiv: laddat?.synk.inloggning !== undefined,
    osankta: laddat?.synk.osankta ?? 0,
    synka: korSynk,
    onFel: setAutosynkfel,
    bevaka: vantarPaAssistenten,
  });

  if (fel !== undefined) {
    return (
      <main>
        <Varumarke />
        <p role="alert" data-testid="uppstart-fel">
          Bokfink kunde inte starta: {fel}
        </p>
      </main>
    );
  }

  if (laddat === undefined) {
    return (
      <main>
        <Varumarke />
        <p>Läser bokföringen …</p>
      </main>
    );
  }

  const idag = systemklocka().idag();
  const valtBild = bilder.find((kandidat) => kandidat.underlag.id === valtKvitto);

  /** Whether a picked file is an encrypted backup rather than a plain one. */
  function onArKrypteradText(text: string): boolean {
    try {
      return arKrypterad(JSON.parse(text));
    } catch {
      return false;
    }
  }
  const foreslagetLov =
    forslagsmall === undefined ? undefined : lovForMallId(forslagsmall.mall);
  /*
   * The leaves as templates at today's rates, for matching a receipt's words.
   * The receipt suggests what it is; the rate is settled in the form.
   */
  const lovmallar = allaLov().map((lov) => lovTillMall(lov, momsForLov(lov, idag).sats));
  const halvtPbb = (() => {
    const ar = delar(idag).ar;
    try {
      return { ar, belopp: halvtPrisbasbelopp(ar, laddat.egnaPrisbasbelopp) };
    } catch {
      // A year whose prisbasbelopp is not known yet; the question is asked without it.
      return undefined;
    }
  })();

  /**
   * Reads a receipt and turns what it says into a suggestion.
   *
   * The text is stored on the underlag the first time, so a receipt is read
   * once however often it is opened - recognising one takes seconds on a
   * phone, and the answer does not change.
   *
   * A failure here is shown next to the receipt rather than thrown at the
   * screen: OCR not working is a reason to type the figures in, not a reason
   * the booking cannot be made.
   */
  // Read out before the closures below, because TypeScript will not carry the
  // "laddat is loaded" narrowing into a function declaration.
  const { anvandning } = laddat;

  /**
   * The leaf a receipt points at, strongest signal first.
   *
   * How the same supplier was booked last time beats any word on the
   * receipt: a farm shop's receipt says "moms", "kort" and the name of each
   * product, but who it is from says what it was. Failing that, the words
   * the receipt shares with the leaves, ranked by use on this device.
   */
  function foreslaMall(
    tolkat: Kvittoforslag,
    text: string,
  ): { mall: Uuid; skal: string } | undefined {
    const minne = foreslaFranTidigare(tolkat, laddat?.tidigareKop ?? []);
    if (minne !== undefined) {
      const vem = tolkat.leverantor ?? 'samma leverantör';
      return {
        mall: minne.mall,
        skal: `så bokfördes förra kvittot från ${vem}, ${minne.forebild.datum}`,
      };
    }
    return ordforslag(text, 'kvittot');
  }

  function ordforslag(
    text: string,
    vad: 'kvittot' | 'bankraden',
  ): { mall: Uuid; skal: string } | undefined {
    const traff = foreslaMallForText(lovmallar, text, anvandning);
    return traff === undefined
      ? undefined
      : { mall: traff.mall.id, skal: `${vad} nämner ”${traff.traff}”` };
  }

  function tolka(text: string, sakerhet: number | undefined): void {
    /*
     * A reading this poor is not a reading. Offering the figures it found
     * would be worse than offering nothing: they look exactly like an answer,
     * and on a dark photograph the largest number on the page is as likely to
     * be a weight in kilos as an amount.
     */
    if (sakerhet !== undefined && sakerhet < LASBAR_SAKERHET) {
      setForslag(undefined);
      setForslagsmall(undefined);
      setOcr({
        laser: false,
        fel:
          'Kvittot gick inte att läsa. Prova att fotografera om det i bättre ljus, ' +
          'eller fyll i uppgifterna för hand.',
      });
      return;
    }

    const tolkat = tolkaKvitto(text, idag);
    setForslag(tolkat);
    setForslagsmall(foreslaMall(tolkat, text));
    setOcr({
      laser: false,
      ...(sakerhet !== undefined && sakerhet < OSAKER_SAKERHET
        ? {
            fel:
              'Läsningen var osäker. Stäm av beloppet och datumet mot kvittot innan ' +
              'du bokför.',
          }
        : {}),
    });
  }

  /**
   * Which of the engine's readings to believe.
   *
   * Not the one it is most confident about. Confidence answers a different
   * question - how sure it is of the letters - and on real photographs it has
   * preferred a reading that turned 926,00 into 2926,00 over one that got it
   * right. A receipt prints what was paid several times over, so the reading
   * whose total is corroborated most often is the better reading, and
   * confidence only breaks a tie.
   */
  function valjLasning(lasningar: readonly Ocrresultat[]): Ocrresultat {
    let basta = lasningar[0]!;
    let bastaStod = tolkaKvitto(basta.text, idag).stod ?? 0;

    for (const lasning of lasningar.slice(1)) {
      const stod = tolkaKvitto(lasning.text, idag).stod ?? 0;
      if (stod > bastaStod || (stod === bastaStod && lasning.sakerhet > basta.sakerhet)) {
        basta = lasning;
        bastaStod = stod;
      }
    }
    return basta;
  }

  async function lasKvitto(underlag: Underlag): Promise<void> {
    if (underlag.text !== undefined) {
      tolka(underlag.text, underlag.sakerhet);
      return;
    }

    setOcr({ laser: true });
    try {
      const fil = await lasFil(db, underlag.sha256);
      if (fil === undefined) {
        throw new Error('Underlagets fil saknas i databasen.');
      }
      const { text, sakerhet } = valjLasning(await lasKvittotext(fil.data, fil.mime));
      if (text.trim().length === 0) {
        throw new Error(
          underlag.mime === 'application/pdf'
            ? 'PDF:en innehåller ingen text att läsa. Den är förmodligen en inskannad ' +
                'bild - fyll i uppgifterna för hand, underlaget är sparat.'
            : 'Ingen text kunde läsas ur underlaget.',
        );
      }
      await sparaUnderlagstext(db, await skrivkontext(db), underlag.id, text, sakerhet);
      tolka(text, sakerhet);
      setLaddat(await hamta());
    } catch (orsak) {
      // Hard rule 11: said out loud, next to the receipt it concerns.
      setOcr({
        laser: false,
        fel: orsak instanceof Error ? orsak.message : String(orsak),
      });
    }
  }

  return (
    <>
      <main>
        {/*
         * Which book is open, on every screen, once there is more than one.
         * The mistake this guards against is a receipt from the firm booked
         * in the association's books, and that happens on the booking screen,
         * not on the home screen.
         */}
        {bokval.bocker.length > 1 && (
          <p className="bokrad" data-testid="aktiv-bok">
            <span>
              Bok: <strong>{bokval.aktiv.namn}</strong>
            </span>
            {vy !== 'bocker' && (
              <button
                type="button"
                className="knapp knapp--text"
                onClick={() => setVy('bocker')}
              >
                Byt bok
              </button>
            )}
          </p>
        )}
        {vy === 'attgora' && (
          <div className="rubrikrad">
            <Varumarke />
          </div>
        )}
        {vy === 'attgora' && (
          <AttGoraSida
            idag={idag}
            senaste={laddat.senaste}
            verifikat={laddat.allaVerifikat}
            rakenskapsar={laddat.rakenskapsar}
            onRapporter={() => setVy('rapporter')}
            utkast={laddat.utkast.length}
            kvitton={laddat.kvitton.length}
            dagarSedanBackup={laddat.dagarSedanBackup}
            momsdeklarationer={
              laddat.momsregistrerad
                ? vantandeMomsdeklarationer(laddat.rakenskapsar, laddat.momsperiod, idag)
                : []
            }
            visaMoms={laddat.momsregistrerad}
            fakturor={vantandeFakturor(laddat.kvitton, idag)}
            onSnabbBackup={async (losenfras) => {
              // Same names and wording as the Säkerhetskopia screen, so a
              // folder of copies reads the same whichever button made them.
              const krypterad = losenfras !== undefined;
              const fil = krypterad
                ? await skapaKrypteradKopia(db, losenfras)
                : await exporteraSomText(db);
              const datum = new Date().toISOString().slice(0, 10);
              const namn = krypterad
                ? `${filprefix}-sakerhetskopia-${datum}.json`
                : `${filprefix}-oskyddad-kopia-${datum}.json`;
              const utfall = await delaEllerSpara(namn, fil, 'application/json');
              await db.setMeta('backup.senast', systemklocka().idag());
              setLaddat(await hamta());
              const vad = krypterad
                ? 'Den krypterade säkerhetskopian'
                : 'Den oskyddade kopian';
              return utfall === 'delad'
                ? `${vad} delades.`
                : `${vad} sparades som ${namn}.`;
            }}
            onMoms={() => setVy('moms')}
            onKvitton={() => setVy('kvitton')}
            onUtkast={() => setVy('kvitton')}
            onVisaVerifikat={() => setVy('verifikat')}
          />
        )}

        {vy === 'kvitton' && (
          <Kvitton
            kvitton={bilder}
            assistentstatus={assistentstatus}
            onBokfor={(kvitto) => {
              setFormularnyckel((forra) => forra + 1);
              setValtKvitto(kvitto.underlag.id);
              setBankrad(undefined);
              setForslag(undefined);
              setForslagsmall(undefined);
              setVy('bokfor');
              void lasKvitto(kvitto.underlag);
            }}
            onForfallodag={async (kvitto, forfallodag) => {
              await sparaForfallodag(
                db,
                await skrivkontext(db),
                kvitto.underlag.id,
                forfallodag,
              );
              setLaddat(await hamta());
            }}
            onLasText={async ({ underlag }) => {
              if (underlag.text !== undefined) {
                return underlag.text;
              }
              const fil = await lasFil(db, underlag.sha256);
              if (fil === undefined) {
                throw new Error('Underlagets fil saknas i databasen.');
              }
              const { text, sakerhet } = valjLasning(
                await lasKvittotext(fil.data, fil.mime),
              );
              if (text.trim().length > 0) {
                await sparaUnderlagstext(
                  db,
                  await skrivkontext(db),
                  underlag.id,
                  text,
                  sakerhet,
                );
                setLaddat(await hamta());
              }
              return text;
            }}
            onTaBort={async (kvitto) => {
              await taBortUnderlag(db, await skrivkontext(db), kvitto.underlag.id);
              if (valtKvitto === kvitto.underlag.id) {
                setValtKvitto(undefined);
              }
              setLaddat(await hamta());
            }}
            onLaggTill={async (filer, forberedelse) => {
              const kontext = await skrivkontext(db);
              let nya = 0;
              let fanns = 0;
              for (const fil of filer) {
                const forberedd = await forberedUnderlag(fil, forberedelse);
                const { nytt } = await sparaUnderlag(db, kontext, {
                  sha256: await hashaFil(forberedd.data),
                  mime: forberedd.mime,
                  filnamn: forberedd.filnamn,
                  data: forberedd.data,
                });
                if (nytt) {
                  nya += 1;
                } else {
                  fanns += 1;
                }
              }
              setLaddat(await hamta());
              return nya === 0
                ? 'Kvittot fanns redan sparat.'
                : `${nya === 1 ? 'Kvittot sparades' : `${nya} kvitton sparades`}.` +
                    (fanns > 0 ? ` ${fanns} fanns redan.` : '');
            }}
          >
            <Utkastlista
              utkast={laddat.utkast}
              konton={laddat.konton}
              underlag={laddat.underlagPerVerifikat}
              underlagsbilder={underlagsbilder}
              onAndra={(utkast) => {
                setAndrarUtkast(utkast);
                setVy('frikontering');
              }}
              onBokfor={async (utkast) => {
                const verifikat = await bokforUtkast(
                  db,
                  await skrivkontext(db),
                  utkast,
                  verifikatserie(laddat.serie),
                  utkast.mall === undefined ? 'manuell' : 'mall',
                );
                setLaddat(await hamta());
                return `Bokfört som ${beteckning(verifikat)}.`;
              }}
              onKassera={async (utkast) => {
                await kasseraUtkast(db, await skrivkontext(db), utkast.id);
                setLaddat(await hamta());
              }}
            />
          </Kvitton>
        )}

        {vy === 'bank' && (
          <Bankimport
            onTillbaka={() => setVy('mer')}
            onLasFil={async (fil) => {
              const text = avkodaText(new Uint8Array(await fil.arrayBuffer()));
              const transaktioner = lasKontoutdrag(text);
              return matchaKontoutdrag(
                transaktioner,
                laddat.poster.map((post) => post.verifikat),
                FORETAGSKONTO,
              );
            }}
            onBokfor={(transaktion) => {
              setFormularnyckel((forra) => forra + 1);
              setBankrad(transaktion);
              setValtKvitto(undefined);
              /*
               * The bank line fills the form the way a receipt does: the same
               * suggestion, from a different reader. The amount is flipped to
               * what the form asks for - "att betala" is a positive number,
               * while the statement shows money leaving as negative.
               */
              setForslag({
                datum: transaktion.datum,
                brutto:
                  transaktion.belopp < 0
                    ? negate(transaktion.belopp)
                    : transaktion.belopp,
                leverantor: transaktion.text,
              });
              setForslagsmall(ordforslag(transaktion.text, 'bankraden'));
              setVy('bokfor');
            }}
          />
        )}

        {/*
         * A menu rather than a page. Everything under it used to be stacked
         * in one scroll, and the kontoplan's three hundred rows meant the
         * import, the backup and the fiscal years all began five screens
         * down - on the phone this is used from.
         */}
        {vy === 'mer' && (
          <Mer
            onValj={setVy}
            dolda={dolda}
            profil={laddat.profil}
            momsregistrerad={laddat.momsregistrerad}
            onKalender={async () => {
              const poster = paminnelser({
                profil: laddat.profil,
                momsregistrerad: laddat.momsregistrerad,
                rakenskapsar: laddat.rakenskapsar,
                momsperiod: laddat.momsperiod,
                underlag: laddat.kvitton,
                idag,
              });
              if (poster.length === 0) {
                return 'Det finns inga kommande datum att lägga in.';
              }
              const namn = `${filprefix}-datum.ics`;
              const utfall = await delaEllerSpara(
                namn,
                skrivIcs(poster, new Date().toISOString()),
                'text/calendar',
              );
              const antal = poster.length === 1 ? 'Ett datum' : `${poster.length} datum`;
              return utfall === 'delad'
                ? `${antal} delades. Välj Kalender för att lägga in dem.`
                : `${antal} sparades som ${namn}. Öppna filen för att lägga in dem i kalendern.`;
            }}
          />
        )}

        {vy === 'konton' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Kontosida
              konton={laddat.konton}
              onSpara={async (konto, fanns) => {
                await skrivKonto(db, await skrivkontext(db), konto, fanns);
                setLaddat(await hamta());
              }}
            />
          </>
        )}

        {vy === 'filer' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Filhantering
              rakenskapsar={laddat.rakenskapsar}
              onImportera={async (filer) => {
                const resultat = await importeraSieFiler(
                  db,
                  await skrivkontext(db),
                  filer,
                  {
                    avslutaTomOchMed: forraArsslutet(systemklocka().idag()),
                  },
                );
                setLaddat(await hamta());
                return (
                  `${resultat.verifikat} verifikat och ${resultat.konton} konton ` +
                  `importerade från ${filer.length} fil${filer.length === 1 ? '' : 'er'}.` +
                  (resultat.redanImporterade > 0
                    ? ` ${resultat.redanImporterade} fanns redan.`
                    : '')
                );
              }}
              onPlaneraUnderlag={(namn) =>
                planeraUnderlagsimport(namn, laddat.allaVerifikat, laddat.rakenskapsar)
              }
              onImporteraUnderlag={async (filer, plan) => {
                const utfall = await importeraUnderlag(
                  db,
                  await skrivkontext(db),
                  filer.map((fil) => ({
                    ...fil,
                    // iOS Files hands over a PDF with no type at all; the name
                    // is then the only thing left to go on.
                    mime: fil.mime === '' ? (mimeAvFilnamn(fil.namn) ?? '') : fil.mime,
                  })),
                  plan,
                  { hasha: hashaFil },
                );
                setLaddat(await hamta());
                return (
                  `${utfall.nya} underlag sparade och ${utfall.kopplade} kopplade ` +
                  `till verifikat.` +
                  (utfall.redanFanns > 0 ? ` ${utfall.redanFanns} fanns redan.` : '') +
                  (utfall.okopplade.length > 0
                    ? ` ${utfall.okopplade.length} sparades utan koppling.`
                    : '') +
                  (utfall.avvisade.length > 0
                    ? ` ${utfall.avvisade.length} kunde inte sparas: ` +
                      utfall.avvisade
                        .map((post) => `${post.namn} (${post.orsak})`)
                        .join(', ')
                    : '')
                );
              }}
              onExporteraSie={(id) => exporteraSie(db, id)}
              onArkivpaket={(id) =>
                byggArkivpaket(
                  db,
                  id,
                  systemklocka().idag(),
                  { hasha: hashaFil },
                  laddat.organisationsnummer === ''
                    ? {}
                    : { orgnr: laddat.organisationsnummer },
                )
              }
            />
          </>
        )}

        {vy === 'sakerhetskopia' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Sakerhetskopia
              onArKrypterad={onArKrypteradText}
              onBackupTagen={async () => {
                await db.setMeta('backup.senast', systemklocka().idag());
                setLaddat(await hamta());
              }}
              onSakerhetskopia={async (losenfras) =>
                losenfras === undefined
                  ? exporteraSomText(db)
                  : skapaKrypteradKopia(db, losenfras)
              }
              onAterstall={async (rafil, losenfras) => {
                /*
                 * A wrong passphrase and a damaged file fail the same way, and
                 * both are said in words rather than as a decryption error:
                 * AES-GCM authenticates, so a changed byte is a refusal.
                 */
                let text = rafil;
                if (losenfras !== undefined && onArKrypteradText(rafil)) {
                  const paket = laspaket(rafil);
                  const nyckel = await harledNyckel(
                    losenfras,
                    paket.salt,
                    paket.iterationer,
                  );
                  try {
                    text = new TextDecoder().decode(
                      await dekryptera(nyckel, paket.iv, paket.chiffer),
                    );
                  } catch {
                    throw new Error(
                      'Kopian gick inte att låsa upp. Antingen är lösenfrasen fel, ' +
                        'eller så har filen ändrats sedan den skrevs.',
                    );
                  }
                }

                // Every file is checked against its own checksum on the way in.
                // A restore that quietly accepted a damaged receipt would be
                // worse than one that refuses.
                const resultat = await importera(db, las(text), { hasha: hashaFil });
                setLaddat(await hamta());
                const filer =
                  resultat.nyaFiler === 0
                    ? ''
                    : ` ${resultat.nyaFiler} underlag återställdes.`;
                return resultat.nyaHandelser === 0
                  ? `Kopian innehöll ingenting som saknades.${filer}`
                  : `${resultat.nyaHandelser} händelser lästes in.${filer}`;
              }}
            />
          </>
        )}

        {vy === 'foretag' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Foretagsinstallningar
              profil={laddat.profil}
              momsregistrerad={laddat.momsregistrerad}
              onMomsregistrerad={async (registrerad) => {
                await db.setMeta('momsregistrerad', registrerad);
                setLaddat(await hamta());
              }}
              organisationsnummer={laddat.organisationsnummer}
              onOrganisationsnummer={async (nummer) => {
                await db.setMeta('organisationsnummer', nummer);
                setLaddat(await hamta());
              }}
              momsperiod={laddat.momsperiod}
              onMomsperiod={async (period) => {
                await db.setMeta('momsperiod', period);
                setLaddat(await hamta());
              }}
              metod={laddat.metod}
              onMetod={async (metod) => {
                await db.setMeta('redovisningsmetod', metod);
                setLaddat(await hamta());
              }}
            />
          </>
        )}

        {vy === 'enhet' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Enhetsinstallningar
              serie={laddat.serie}
              onSerie={async (nytt) => {
                const rensat = nytt.trim().toUpperCase();
                if (!/^[A-ZÅÄÖ0-9]{1,4}$/.test(rensat)) {
                  return;
                }
                await sattSerieForEnhet(db, verifikatserie(rensat));
                setLaddat(await hamta());
              }}
            />
          </>
        )}

        {vy === 'rakenskapsar' && <Tillbaka onTillbaka={() => setVy('mer')} />}

        {vy === 'rakenskapsar' && (
          <Rakenskapsarsida
            rakenskapsar={laddat.rakenskapsar}
            konton={laddat.konton}
            idag={idag}
            borttagbara={laddat.borttagbaraAr}
            onTaBort={async (ar) => {
              await taBortRakenskapsar(db, await skrivkontext(db), ar.id);
              setLaddat(await hamta());
            }}
            onMomslas={async (ar, tom) => {
              await momslas(db, await skrivkontext(db), ar.id, tom);
              setLaddat(await hamta());
            }}
            onAvsluta={async (ar) => {
              await avslutaRakenskapsar(db, await skrivkontext(db), ar.id);
              setLaddat(await hamta());
            }}
            onHamtaChecklista={(ar) => arsavslutschecklista(db, ar, idag)}
            onSkapaNastaAr={async (ar) => {
              const nasta = await skapaNastaRakenskapsar(db, await skrivkontext(db), ar);
              setLaddat(await hamta());
              return nasta;
            }}
            onForUtgaendeBalanser={async (ar, nastaArId) => {
              const overforing = await forUtgaendeBalanserTillNastaAr(
                db,
                await skrivkontext(db),
                ar,
                nastaArId,
                verifikatserie(laddat.serie),
              );
              setLaddat(await hamta());
              return overforing;
            }}
          />
        )}

        {vy === 'enhet' && (
          <Synk
            url={laddat.synk.inloggning?.url ?? ''}
            epost={laddat.synk.inloggning?.epost ?? ''}
            inloggad={laddat.synk.inloggning !== undefined}
            osankta={laddat.synk.osankta}
            autosynkfel={autosynkfel}
            senast={laddat.synk.senast}
            enhet={laddat.synk.enhet}
            harLosenfras={laddat.synk.harLosenfras}
            onLoggaIn={async (url, epost, losenord) => {
              const inloggning = await loggaIn(url, epost, losenord);
              // The token is stored and the password is not: a token can be
              // revoked from the server, a password cannot.
              await db.setMeta('synk.inloggning', inloggning);
              setLaddat(await hamta());
              return `Inloggad mot ${inloggning.url}.`;
            }}
            onLoggaUt={async () => {
              await db.setMeta('synk.inloggning', undefined);
              // So the next server gets everything rather than nothing.
              await glomServern(db);
              setLaddat(await hamta());
            }}
            onLosenfras={async (fras) => {
              await db.setMeta('synk.losenfras', fras);
              setLaddat(await hamta());
            }}
            onSynka={korSynk}
          />
        )}

        {vy === 'bocker' && (
          <>
            <Tillbaka onTillbaka={() => setVy('mer')} />
            <Bocker {...bokval} />
          </>
        )}

        {/* Status last: useful when something is wrong, noise the rest of
            the time. */}
        {vy === 'enhet' && <StartPage db={db} />}

        {vy === 'frikontering' && andrarUtkast !== undefined && (
          <FriKontering
            key={andrarUtkast.id}
            idag={idag}
            start={{
              datum: andrarUtkast.datum,
              beskrivning: andrarUtkast.beskrivning,
              konteringar: andrarUtkast.konteringar,
              ...(andrarUtkast.mall === undefined ? {} : { mall: andrarUtkast.mall }),
            }}
            konton={laddat.konton}
            // The receipt is already linked to the draft, by the draft's id.
            kvitton={[]}
            redigering={{
              rubrik: 'Ändra utkastet',
              inledning:
                'Ändringarna sparas i utkastet. Det bokförs först när du trycker Bokför ' +
                'under Kvitton.',
              knapp: 'Spara utkastet',
            }}
            onTillbaka={() => {
              setAndrarUtkast(undefined);
              setVy('kvitton');
            }}
            onBokfor={async ({ datum, beskrivning, konteringar, mall }) => {
              /*
               * Saved under the same id: the receipt stays linked and the
               * draft is the same draft, changed. The assistant's reasons
               * stay too, since they are about the receipt, and the review
               * can see what was changed against them.
               */
              await sparaUtkast(
                db,
                await skrivkontext(db),
                skapaUtkast({
                  id: andrarUtkast.id,
                  datum,
                  beskrivning,
                  konteringar,
                  ...(mall === undefined ? {} : { mall }),
                  ...(andrarUtkast.motivering === undefined
                    ? {}
                    : { motivering: andrarUtkast.motivering }),
                }),
              );
              setLaddat(await hamta());
              setAndrarUtkast(undefined);
              setVy('kvitton');
              return 'Utkastet är sparat.';
            }}
          />
        )}

        {vy === 'frikontering' && andrarUtkast === undefined && (
          <FriKontering
            idag={idag}
            {...(friStart === undefined ? {} : { start: friStart })}
            {...(friStart === undefined || valtKvitto === undefined
              ? {}
              : { forvaltUnderlag: valtKvitto })}
            konton={laddat.konton}
            kvitton={laddat.kvitton}
            onTillbaka={() => {
              setFriStart(undefined);
              setVy('bokfor');
            }}
            onBokfor={async ({ datum, beskrivning, konteringar, underlagId, mall }) => {
              const kontext = await skrivkontext(db);
              const verifikat = await bokforUtkast(
                db,
                kontext,
                skapaUtkast({
                  id: newIdentifier(),
                  datum,
                  beskrivning,
                  konteringar,
                  ...(mall === undefined ? {} : { mall }),
                }),
                verifikatserie(laddat.serie),
              );
              if (underlagId !== undefined) {
                await kopplaUnderlag(db, kontext, underlagId, verifikat.id);
                if (underlagId === valtKvitto) {
                  setValtKvitto(undefined);
                  setForslag(undefined);
                  setForslagsmall(undefined);
                  setOcr({ laser: false });
                }
              }
              if (friStart !== undefined) {
                setFriStart(undefined);
                setBankrad(undefined);
              }
              setLaddat(await hamta());
              return `Bokfört som ${beteckning(verifikat)}.`;
            }}
          />
        )}

        {vy === 'bokfor' && (
          <>
            {senast !== undefined && (
              <p className="kort" data-testid="senast-bokfort" role="status">
                Bokfört som {senast}.
              </p>
            )}

            <BokforUtgift
              // Remounted when a receipt or a bank line starts a new entry,
              // so nothing from the last one is left in the fields - but not
              // when a photograph is attached to the entry in progress, which
              // would throw away what has been typed. The suggestion below is
              // passed whether it came from a photograph or from a bank line;
              // only the picture and the OCR status belong to a receipt.
              key={formularnyckel}
              idag={idag}
              {...(bankrad === undefined ? {} : { forvaltBetalkonto: FORETAGSKONTO })}
              {...(forslag === undefined ? {} : { forslag })}
              {...(foreslagetLov === undefined
                ? {}
                : { foreslagetLov, forslagsskal: forslagsmall?.skal ?? '' })}
              {...(halvtPbb === undefined ? {} : { halvtPrisbasbelopp: halvtPbb })}
              {...(valtBild === undefined
                ? {}
                : {
                    underlag: {
                      filnamn: valtBild.underlag.filnamn,
                      url: valtBild.url,
                      mime: valtBild.underlag.mime,
                      ...(valtBild.underlag.text === undefined
                        ? {}
                        : { text: valtBild.underlag.text }),
                    },
                    onSlappUnderlag: () => setValtKvitto(undefined),
                    ocrLaser: ocr.laser,
                    ...(ocr.fel === undefined ? {} : { ocrFel: ocr.fel }),
                  })}
              onFriKontering={() => {
                setFriStart(undefined);
                setVy('frikontering');
              }}
              onAndraKontering={(start) => {
                setFriStart(start);
                setVy('frikontering');
              }}
              onHanvisning={setVy}
              anvandning={laddat.anvandning}
              konton={laddat.konton}
              onFotografera={async (fil, forberedelse) => {
                const forberedd = await forberedUnderlag(fil, forberedelse);
                const { underlag } = await sparaUnderlag(db, await skrivkontext(db), {
                  sha256: await hashaFil(forberedd.data),
                  mime: forberedd.mime,
                  filnamn: forberedd.filnamn,
                  data: forberedd.data,
                });

                // Attached to the entry in progress, then read. Storing first
                // means the picture survives even if the booking is abandoned.
                setValtKvitto(underlag.id);
                setLaddat(await hamta());
                await lasKvitto(underlag);
              }}
              onBokfor={async ({ mall, datum, beskrivning, konteringar }) => {
                const enhet = await db.getMeta<string>('deviceId');
                const kontext: Skrivkontext = {
                  enhet: enhet ?? 'okand',
                  nu: () => new Date().toISOString(),
                  idag: () => systemklocka().idag(),
                };

                const verifikat = await bokforUtkast(
                  db,
                  kontext,
                  skapaUtkast({
                    id: newIdentifier(),
                    datum,
                    beskrivning,
                    konteringar,
                    mall: mall.id,
                  }),
                  verifikatserie(laddat.serie),
                  'mall',
                );

                if (valtKvitto !== undefined) {
                  await kopplaUnderlag(db, kontext, valtKvitto, verifikat.id);
                  setValtKvitto(undefined);
                  setForslag(undefined);
                  setForslagsmall(undefined);
                  setOcr({ laser: false });
                }
                setBankrad(undefined);

                setSenast(beteckning(verifikat));
                setLaddat(await hamta());
              }}
            />
          </>
        )}

        {vy === 'rapporter' && (
          <Rapporter
            onTillbaka={() => setVy('mer')}
            konton={laddat.konton}
            verifikat={laddat.poster.map((post) => post.verifikat)}
            ingaendeBalanser={laddat.ingaendeBalanser}
            betalkonton={BETALKONTON}
            rakenskapsar={laddat.rakenskapsar}
            allaVerifikat={laddat.allaVerifikat}
            idag={idag}
            visaMoms={laddat.momsregistrerad}
          />
        )}

        {vy === 'moms' && <Tillbaka onTillbaka={() => setVy('mer')} />}
        {vy === 'moms' && (
          <Momssida
            rakenskapsar={laddat.rakenskapsar}
            verifikat={laddat.allaVerifikat}
            momsperiod={laddat.momsperiod}
            metod={laddat.metod}
            onInstallningar={() => setVy('foretag')}
            onLas={async (ar, tom) => {
              await momslas(db, await skrivkontext(db), ar.id, tom);
              setLaddat(await hamta());
            }}
            onBokforMomsredovisning={async (fran, till) => {
              const forslag = momsredovisning({
                fran,
                till,
                verifikat: laddat.allaVerifikat,
              });
              const verifikat = await bokforUtkast(
                db,
                await skrivkontext(db),
                skapaUtkast({ id: newIdentifier(), ...forslag }),
                verifikatserie(laddat.serie),
              );
              setLaddat(await hamta());
              return `Momsredovisningen bokfördes som ${beteckning(verifikat)}.`;
            }}
            onExportera={async (fran, till) => {
              const rapport = beraknaMomsrapport({
                fran,
                till,
                verifikat: laddat.allaVerifikat,
              });
              const orgnr = await db.getMeta<string>('organisationsnummer');
              const fil = skrivEskd({
                organisationsnummer: orgnr ?? '',
                rapport,
              });
              await delaEllerSpara(
                `eSKD_Moms_${till.replace(/-/g, '').slice(0, 6)}.xml`,
                kodaLatin1(fil),
                'text/xml',
              );
            }}
          />
        )}

        {vy === 'verifikat' && (
          <Verifikatlista
            poster={laddat.allaPoster}
            rakenskapsar={laddat.rakenskapsar}
            idag={idag}
            konton={laddat.konton}
            underlag={laddat.underlagPerVerifikat}
            underlagsbilder={underlagsbilder}
            kvitton={bilder}
            onSparaUnderlag={async (fil, forberedelse) => {
              const forberedd = await forberedUnderlag(fil, forberedelse);
              const { underlag } = await sparaUnderlag(db, await skrivkontext(db), {
                sha256: await hashaFil(forberedd.data),
                mime: forberedd.mime,
                filnamn: forberedd.filnamn,
                data: forberedd.data,
              });
              setLaddat(await hamta());
              return underlag;
            }}
            onKopplaUnderlag={async (post, underlag) => {
              await kopplaUnderlag(
                db,
                await skrivkontext(db),
                underlag.id,
                post.verifikat.id,
              );
              setLaddat(await hamta());
            }}
            annulleringsdatum={(post) => {
              const ar = laddat.rakenskapsar.find(
                (kandidat) => kandidat.id === post.rakenskapsarId,
              );
              return ar === undefined
                ? undefined
                : datumForAnnullering(ar, post.verifikat.datum, idag);
            }}
            onAnnullera={async (post) => {
              const ar = laddat.rakenskapsar.find(
                (kandidat) => kandidat.id === post.rakenskapsarId,
              );
              const nar =
                ar === undefined
                  ? undefined
                  : datumForAnnullering(ar, post.verifikat.datum, idag);
              if (nar === undefined) {
                return;
              }
              await annulleraVerifikat(db, await skrivkontext(db), post.verifikat, nar);
              setLaddat(await hamta());
            }}
            onRatta={async (post, andring) => {
              // Lets the refusal reach the form, which shows it: a correction
              // that crosses a year or a filed period has to say so.
              await rattaVerifikat(db, await skrivkontext(db), post.verifikat, andring);
              setLaddat(await hamta());
            }}
          />
        )}

        {vy === 'anlaggning' && (
          <Anlaggningssida
            onTillbaka={() => setVy('mer')}
            rakenskapsar={laddat.rakenskapsar}
            anlaggningar={laddat.anlaggningar}
            fastigheter={laddat.fastigheter}
            idag={idag}
            egnaPrisbasbelopp={laddat.egnaPrisbasbelopp}
            onHamtaPrisbasbelopp={hamtaPrisbasbelopp}
            onSparaPrisbasbelopp={async (ar, belopp) => {
              await sparaPrisbasbelopp(db, ar, belopp);
              setLaddat(await hamta());
            }}
            onRegistrera={async (uppgifter) => {
              const tillgang = await registreraAnlaggningstillgang(
                db,
                await skrivkontext(db),
                uppgifter,
              );
              setLaddat(await hamta());
              return `${tillgang.benamning} registrerad.`;
            }}
            onAvyttra={async (id, avyttring) => {
              await avyttraAnlaggningstillgang(db, await skrivkontext(db), id, avyttring);
              setLaddat(await hamta());
              return avyttring.typ === 'forsaljning'
                ? 'Försäljningen registrerad.'
                : 'Utrangeringen registrerad.';
            }}
            onBeraknaAvskrivning={async (rakenskapsarId, poolkonton) => {
              const ar = laddat.rakenskapsar.find(
                (kandidat) => kandidat.id === rakenskapsarId,
              );
              if (ar === undefined) {
                throw new Error('Det räkenskapsåret finns inte.');
              }
              return berakningAvArsAvskrivning(db, ar, poolkonton);
            }}
            onBokforAvskrivning={async (
              rakenskapsarId,
              belopp,
              avskrivningskostnadKonto,
              ackAvskrivningKonto,
            ) => {
              const ar = laddat.rakenskapsar.find(
                (kandidat) => kandidat.id === rakenskapsarId,
              );
              const verifikat = await bokforAvskrivning(
                db,
                await skrivkontext(db),
                ar?.slut ?? idag,
                verifikatserie(laddat.serie),
                belopp,
                avskrivningskostnadKonto,
                ackAvskrivningKonto,
              );
              setLaddat(await hamta());
              return `${beteckning(verifikat)} bokfört.`;
            }}
            onRegistreraFastighet={async (uppgifter) => {
              const tillgang = await registreraFastighetstillgang(
                db,
                await skrivkontext(db),
                uppgifter,
              );
              setLaddat(await hamta());
              return `${tillgang.benamning} registrerad.`;
            }}
            onAvyttraFastighet={async (id, avyttring) => {
              await avyttraFastighetstillgang(db, await skrivkontext(db), id, avyttring);
              setLaddat(await hamta());
              return avyttring.typ === 'forsaljning'
                ? 'Försäljningen registrerad.'
                : 'Utrangeringen registrerad.';
            }}
            onBokforFastighetsavskrivning={async (
              id,
              belopp,
              avskrivningskostnadKonto,
              ackAvskrivningKonto,
            ) => {
              const verifikat = await bokforFastighetsavskrivning(
                db,
                await skrivkontext(db),
                idag,
                verifikatserie(laddat.serie),
                id,
                belopp,
                avskrivningskostnadKonto,
                ackAvskrivningKonto,
              );
              setLaddat(await hamta());
              return `${beteckning(verifikat)} bokfört.`;
            }}
          />
        )}

        {vy === 'lager' && (
          <Lagersida
            onTillbaka={() => setVy('mer')}
            inventeringar={laddat.djurlagerinventeringar}
            idag={idag}
            onRegistrera={async (uppgifter) => {
              const inventering = await registreraDjurlagerinventering(
                db,
                await skrivkontext(db),
                uppgifter,
              );
              setLaddat(await hamta());
              return `Inventeringen ${inventering.datum} registrerad.`;
            }}
            onBokforLagerforandring={async (inventering) => {
              const verifikat = await bokforLagerforandring(
                db,
                await skrivkontext(db),
                inventering,
                verifikatserie(laddat.serie),
              );
              setLaddat(await hamta());
              return `Lagerförändringen bokfördes som ${beteckning(verifikat)}.`;
            }}
          />
        )}

        {vy === 'periodisering' && (
          <Bokslutspostsida
            onTillbaka={() => setVy('mer')}
            rakenskapsar={laddat.rakenskapsar}
            konton={laddat.konton}
            idag={idag}
            onBokfor={async ({ ar, post, beskrivning }) => {
              const { verifikat, aterforing } = await bokforBokslutspost(
                db,
                await skrivkontext(db),
                ar,
                post,
                beskrivning,
                verifikatserie(laddat.serie),
              );
              setLaddat(await hamta());
              return (
                `Bokfört som ${beteckning(verifikat)} den ${verifikat.datum} och ` +
                `tillbakafört som ${beteckning(aterforing)} den ${aterforing.datum}.`
              );
            }}
          />
        )}

        {vy === 'egetkapital' && (
          <Egetkapitalsida
            onTillbaka={() => setVy('mer')}
            rakenskapsar={laddat.rakenskapsar}
            idag={idag}
            onHamtaSammanstallning={(ar, uttagInsattningKonton) =>
              egetkapitalsammanstallning(db, ar, uttagInsattningKonton)
            }
            onBokfor={async ({
              typ,
              datum,
              betalkonto,
              uttagInsattningKonto,
              belopp,
            }) => {
              const verifikat = await bokforEgetUttagInsattning(
                db,
                await skrivkontext(db),
                datum,
                verifikatserie(laddat.serie),
                typ,
                betalkonto,
                uttagInsattningKonto,
                belopp,
              );
              setLaddat(await hamta());
              return `${beteckning(verifikat)} bokfört.`;
            }}
          />
        )}

        {vy === 'arsbokslut' && (
          <Arsbokslutsida
            onTillbaka={() => setVy('mer')}
            rakenskapsar={laddat.rakenskapsar}
            verifikat={laddat.allaVerifikat}
            konton={laddat.konton}
            rutval={laddat.rutval}
            onRutval={async (konto, rad) => {
              await sparaRutval(db, konto, rad);
              setLaddat(await hamta());
            }}
            onNebilaga={() => setVy('nebilaga')}
            onBokforResultat={async (ar) => {
              const verifikat = await bokforResultatoverforing(
                db,
                await skrivkontext(db),
                ar,
                verifikatserie(laddat.serie),
              );
              setLaddat(await hamta());
              return `${beteckning(verifikat)} bokfört.`;
            }}
            onMomsomforing={async (ar, omforing) => {
              const verifikat = await bokforMomsomforing(
                db,
                await skrivkontext(db),
                ar.slut,
                verifikatserie(laddat.serie),
                omforing,
              );
              setLaddat(await hamta());
              return `${beteckning(verifikat)} bokfört.`;
            }}
          />
        )}

        {vy === 'nebilaga' && (
          <Nebilagasida
            onTillbaka={() => setVy('mer')}
            rakenskapsar={laddat.rakenskapsar}
            verifikat={laddat.allaVerifikat}
            rutval={laddat.rutval}
            onLas={lasNe}
            onLasJusteringar={lasNeJusteringar}
            onSpara={async (arId, justeringar, deklarant) => {
              await sparaNejusteringar(db, arId, justeringar);
              await sparaDeklarant(db, deklarant);
            }}
            onSparaFil={async (namn, innehall) => {
              await delaEllerSpara(namn, innehall, 'text/plain');
            }}
            onArsbokslut={() => setVy('arsbokslut')}
            nu={() => ({ datum: systemklocka().idag(), tid: klockslag() })}
          />
        )}
      </main>

      {/* Outside main: navigation is a sibling of the page, not part of it. */}
      <Vyval
        vy={vy}
        onValj={setVy}
        antal={{ kvitton: laddat.utkast.length + laddat.kvitton.length }}
      />
    </>
  );
}
