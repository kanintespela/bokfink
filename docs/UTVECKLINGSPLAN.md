# Utvecklingsplan för Kontera

Detta dokument beskriver vad som ska byggas, i vilken ordning, och varför. Det uppdateras löpande — när en punkt blir klar ska den bockas av i samma commit som gjorde den klar.

**Innehåll**

1. [Mål och avgränsning](#1-mål-och-avgränsning)
2. [Plattformsverkligheten](#2-plattformsverkligheten) — vad en PWA faktiskt kan på iOS
3. [Arkitektur](#3-arkitektur)
4. [Datamodell](#4-datamodell)
5. [Teknikval](#5-teknikval)
6. [Etapper](#6-etapper)
7. [Kompletteringar till kravlistan](#7-kompletteringar-till-kravlistan)
8. [Risker](#8-risker)
9. [Öppna beslut](#9-öppna-beslut)
10. [Källor](#10-källor)

---

## 1. Mål och avgränsning

### Mål

Ersätta en kommersiell bokföringsapp för enskild firma med en öppen PWA som

- klarar löpande bokföring av utgifter och inkomster snabbare än dagens app,
- räknar ut moms och bokslutsunderlag korrekt,
- hanterar lager, inventarier och anläggningstillgångar med automatiska avskrivningar,
- aldrig kan tappa data, och
- inte kostar något att driva.

### Utanför omfattningen

Aktiebolag och handelsbolag, löneadministration och arbetsgivardeklaration, koncernredovisning, flera samtidiga användare, integrationer mot bank via PSD2 (kräver betald tredjepart), e-fakturering enligt Peppol.

Dessa kan tas in senare, men får inte styra arkitekturen nu.

### Grundförutsättningar

| Förutsättning | Läge |
|---|---|
| Företagsform | Enskild firma |
| Redovisningsregelverk | K1, förenklat årsbokslut (BFNAR 2006:1) |
| Bokföringsmetod | **Kontantmetoden.** Faktureringsmetoden byggs som inställning men är inte standard |
| Räkenskapsår | Kalenderår |
| Momsperiod | **Kvartal** |
| Enheter | **iPhone och dator, båda ska kunna bokföra.** Kräver synkronisering, se [3.1](#31-flera-enheter) |
| Migrering | **Befintlig bokföring importeras från SIE-fil.** Ligger därför redan i Etapp 1 |
| Säkerhetskopia | Krypterad fil till iCloud Drive som grund. Synkmålet kan ersätta den, se [öppna beslut 1](#9-öppna-beslut) |

---

## 2. Plattformsverkligheten

Flera av de önskade funktionerna beskrevs som "OS-nativa API:er". En PWA når inte dem direkt. Här är vad som faktiskt går, och hur varje krav ska lösas. Detta är planens viktigaste avsnitt — det är här ett projekt av den här typen normalt kör fast.

| Krav | Läget i en PWA på iOS | Lösning i Kontera |
|---|---|---|
| **Biometrisk inloggning** | Apples LocalAuthentication nås inte från webben, men **WebAuthn med plattformsautentiserare är Face ID / Touch ID**. PRF-tillägget (Safari 18+, passkeys i iCloud-nyckelringen) ger 32 byte deterministiskt nyckelmaterial per passkey. Externa säkerhetsnycklar stöds inte på iOS. | Passkey för upplåsning. PRF-utdata → HKDF → AES-GCM-nyckel som krypterar databasen. Fallback: lösenfras via Argon2id/PBKDF2, alltid tillgänglig som återställningsväg. |
| **On-device OCR** | Apples Vision Framework är **inte** åtkomligt från webben. Shape Detection API (`TextDetector`) saknas i Safari. | **Tesseract.js** (WASM, Apache-2.0) med svensk och engelsk språkdata paketerad lokalt. Körs i en Web Worker, helt offline. Kvaliteten på kvitton är ojämn — därför är OCR ett *förslag* som fylls i ett formulär, aldrig en automatisk bokföring. Om träffsäkerheten inte räcker: utvärdera en ONNX-modell (t.ex. PaddleOCR) via `onnxruntime-web`. |
| **Kamera och beskärning** | `getUserMedia` och `<input type="file" capture>` fungerar i installerad PWA. Beskärning görs i canvas. | Fungerar som önskat. Bilder komprimeras till WebP/JPEG innan lagring. |
| **Lokala notiser vid datum** | **Detta går inte.** iOS saknar schemalagda lokala notiser; Notification Triggers API finns inte i Safari. Web Push finns från iOS 16.4 men *bara* för hemskärmsinstallerad PWA **och kräver en pushserver** — alltså precis det projektet vill undvika. | Tre lager: (a) en **att göra-vy** med tydliga varningar när appen öppnas, (b) **`.ics`-export** av momsdatum, förfallodagar och deklarationsdatum som läggs in i iOS Kalender och då ger riktiga notiser utan server, (c) *valfritt senare:* Web Push via en liten VAPID-worker på gratisnivå. Se [öppna beslut 6](#9-öppna-beslut). |
| **PDF-generering** | Fungerar helt lokalt. | **pdf-lib** (MIT) med inbäddat typsnitt som har å, ä och ö. PDFKit är Node-orienterat och tyngre. |
| **Distribution via delningsmenyn** | Web Share API nivå 2 (delning av filer) fungerar i Safari på iOS. | Fakturor delas som PDF till Mail, Meddelanden eller Filer. Nedladdningsfallback för desktop. |
| **Lagring** | IndexedDB. Hemskärmsinstallerade PWA:er är **undantagna** Safaris sjudagarsvräkning av lagring, men data försvinner om appen avinstalleras eller telefonen tappas. Kvot ≈ 1 GB, utökas efter fråga till användaren. | Dexie över IndexedDB, `navigator.storage.persist()` vid start, och **säkerhetskopiering som en icke förhandlingsbar del av produkten** — inte en extrafunktion. |
| **Bakgrundssynk** | Background Sync och Periodic Background Sync saknas på iOS. | Backup körs när appen är öppen, och appen visar hur gammal senaste kopian är. |

### Konsekvens

Två krav måste omformuleras:

1. **"Lokala notiser" blir "kalenderintegration + att göra-vy".** Det ger samma nytta — en påminnelse i telefonen på rätt dag — utan serverkostnad.
2. **"On-device OCR via Vision/ML Kit" blir "on-device OCR via WASM".** Fortfarande lokalt och gratis, men mindre träffsäkert än Apples modell. Designen måste därför göra det snabbt att rätta ett förslag.

Allt övrigt går att bygga som beskrivet.

---

## 3. Arkitektur

```
┌──────────────────────────────────────────────┐
│  features/  vyer och formulär per område     │
│  ui/        delade komponenter               │
└───────────────┬──────────────────────────────┘
                │
┌───────────────▼──────────┐  ┌────────────────┐
│  domain/                 │  │  platform/     │
│  bokföring, moms,        │  │  kamera, share │
│  avskrivningar, rapporter│  │  WebAuthn, fil │
│  SIE/SRU/eSKD            │  │  notiser       │
│  ren TypeScript          │  └────────────────┘
└───────────────▲──────────┘
                │
┌───────────────┴──────────────────────────────┐
│  data/  Dexie · IndexedDB · migrationer      │
└──────────────────────────────────────────────┘
```

**Bärande principer**

- `domain/` är ren och deterministisk: inga ramverk, inga webbläsar-API:er, ingen klocka. Den ska gå att köra i Node och kommer att överleva varje omskrivning av gränssnittet.
- All persistens går genom repositories i `data/`. Domänen känner inte till IndexedDB.
- Plattformsberoenden ligger bakom gränssnitt i `platform/`, så att iOS-egenheter hanteras på ett ställe.
- **Append-only huvudbok.** Bokförda verifikat skrivs aldrig om. Utöver verifikaten finns en händelselogg som registrerar varje ändring — den är grunden för spårbarheten som bokföringslagen kräver.

### 3.1 Flera enheter

Att både telefon och dator ska kunna bokföra är planens största enskilda arkitekturkonsekvens. Säkerhetskopiering räcker inte; det krävs synkronisering med konflikthantering. Den måste finnas i datamodellen från första commit — att lägga till synk i efterhand betyder att all befintlig data måste migreras.

Tre följder:

**1. Operationsloggen är synkenheten.** Kontera lagrar inte "nuvarande tillstånd" som sanning, utan en append-only logg av händelser med globalt unika id (UUIDv7), enhets-id och logisk klocka. Synkronisering blir då en union av två loggar i stället för en sammanslagning av två databaser. Det passar bokföring ovanligt bra: en huvudbok *är* redan en append-only logg, och en bokförd kontering ändras aldrig. Även en rättelse av beskrivning eller datum är en ny händelse i loggen, inte en överskrivning.

**2. En verifikatserie per enhet.** Kravet på obruten nummerserie krockar med flera enheter — två enheter kan inte oberoende dela ut nummer 42 i samma serie. Lösningen är att varje enhet äger sin egen serie, till exempel `A` på telefonen och `B` på datorn. Varje serie förblir obruten var för sig, vilket bokföringslagen tillåter, och numret kan delas ut direkt utan att enheterna behöver nå varandra. Detta är hela anledningen till att verifikatserier finns med redan i Etapp 1.

**3. Konflikter blir sällsynta, men inte omöjliga.** Bokförda konteringar kan aldrig kollidera eftersom de är oföränderliga. Beskrivning och datum på ett bokfört verifikat får rättas (se Etapp 1 under [etapper](#6-etapper)), och om två enheter rättar samma fält var för sig vinner den rättelse som ligger sist i loggordning, medan båda står kvar i verifikatets rättelsehistorik. Det som i övrigt kan kollidera är föränderliga poster: företagsinställningar, kundregister, konteringsmallar och utkast. Där gäller sist-skrivet-vinner per fält, med båda versionerna bevarade i loggen så att ingenting går förlorat.

**Synken kräver en delad lagringsplats.** iCloud Drive går inte att nå från en PWA:s API:er — den kan bara ta emot filer som användaren aktivt delar dit. Det duger för säkerhetskopiering men inte för synkronisering. Något som båda enheterna kan skriva till behövs alltså, och samma lagring kan då också vara det automatiska backupmålet och lösa förvaringsfrågan i bokföringslagen 7 kap. Se [öppna beslut 1](#9-öppna-beslut).

Fram till Etapp 5 sköts flera enheter manuellt genom export och import av databasfilen. Det är otympligt men fungerar, och gör att synken kan byggas när datamodellen har satt sig.

### 3.2 Synkbackend: PocketBase

PocketBase är en självhostad backend i en enda Go-binär med inbyggd SQLite, auth, filhantering, realtidsuppdateringar över SSE, adminvy och inbyggda säkerhetskopior. Licensen är MIT. Den driftas redan för ett annat projekt, vilket gör den till det billigaste tillskottet av alla alternativ: samma server, samma backuprutin, samma inloggningsmodell.

**Den passar Konteras synkmodell ovanligt bra.** PocketBase är en CRUD-backend, inte en replikeringsmotor som CouchDB. Det spelar ingen roll här, eftersom synkenheten enligt [3.1](#31-flera-enheter) är en append-only operationslogg och inte ett föränderligt tillstånd. Synk över CRUD blir då:

- **push** — skapa de operationer servern inte redan har
- **pull** — hämta allt efter senaste sedda markör
- **ingen konfliktlösning i transporten**, eftersom operationer är oföränderliga och sammanslagningen sker lokalt på enheten

En enda collection räcker för hela synken:

| Fält | Typ | Roll |
|---|---|---|
| `op_id` | text, unikt index | UUIDv7 från enheten. Ger idempotens — en dubblett avvisas av indexet i stället för att skapa en andra kopia |
| `device` | text | vilken enhet som skapade operationen |
| `payload` | text | krypterat innehåll. Servern ser aldrig bokföringen |
| `created` | autodate | markör för inkrementell hämtning |

Kvittobilder läggs som filfält i en egen collection, innehållsadresserade på SHA-256 så att samma bild aldrig laddas upp två gånger.

**Tre saker att räkna med**

1. **PocketBase-id måste vara exakt 15 tecken.** En UUIDv7 på 36 tecken kan alltså inte vara postens id. Lägg den i ett eget fält med unikt index och låt PocketBase behålla sitt eget id. Begränsningen är känd och kan komma att tas bort, men bygg inte på att den gör det.
2. **PocketBase är fortfarande v0.x** (v0.39 sommaren 2026) och utvecklaren avråder uttryckligen från kritiska produktionsystem för den som inte är beredd på manuella migreringssteg mellan versioner. Se riskhanteringen nedan.
3. **Inkrementell hämtning behöver stabil ordning.** Två operationer kan få samma tidsstämpel, så sortera på `created` och `id` tillsammans och paginera med markör i stället för offset.

**Varför v0.x ändå är acceptabelt här**

Kontera gör aldrig PocketBase till sanningskälla. Enheterna äger bokföringen; servern är en brevlåda för operationer och en plats för säkerhetskopian. Går en PocketBase-uppgradering sönder förlorar vi synkbekvämlighet i en kväll, inte räkenskapsinformation. Det håller så länge två regler följs:

- **Arkivpaketet ligger utanför PocketBase** och går att läsa utan den. Sjuårsarkiveringen får aldrig vila på en v0-produkt.
- **Ingen domänlogik i PocketBase.** Inga hooks som räknar moms, validerar verifikat eller delar ut verifikationsnummer. Servern ska kunna bytas mot en dum filhink utan att en enda regel går förlorad. Det är också vad som gör bytet möjligt om PocketBase inte håller.

**Var servern står spelar roll.** Räkenskapsinformation ska förvaras i Sverige, eller elektroniskt inom EU om platsen anmäls till Skatteverket och omedelbar åtkomst kan ges vid kontroll. En egen PocketBase inom EU löser därmed synk, automatisk säkerhetskopiering och förvaringsfrågan i samma drag — vilket ingen av de kommersiella molnlagringstjänsterna gör.

---

## 4. Datamodell

Entiteter i första versionen. Alla belopp i öre, alla datum som `YYYY-MM-DD`.

| Entitet | Innehåll | Noteringar |
|---|---|---|
| `Foretag` | namn, organisationsnummer, adress, momsregistrering, redovisningsmetod, momsperiod, logotyp | En per databas. Flera böcker är flera databaser, se beslut V och Etapp 10 |
| `Rakenskapsar` | start, slut, status (öppet / momslåst t.o.m. datum / avslutat) | Ingående balanser per konto |
| `Konto` | nummer, namn, kontotyp, momskod, aktiv, favorit | BAS-kontoplan + egna konton |
| `Momskod` | sats, riktning, deklarationsrutor, specialfall | Driver både bokföring och momsrapport |
| `Verifikat` | serie, nummer, datum, beskrivning, status, skapad, källa, annullerar, rättelser | Konteringen är oföränderlig efter bokföring; beskrivning och datum får rättas, och varje rättelse sparas i `rattelser` med gammalt värde, när och vem. `annullerar` pekar på det verifikat detta upphäver |
| `Kontering` | verifikat, konto, debet, kredit, projekt, motpart, momskod | Summan av alla rader = 0 |
| `Konteringsmall` | namn, sökord, konto, momssats | Beslutsträdets svar blir mallar internt, så momsdelning och öresutjämning räknas på ett ställe. Egna mallar skapas inte längre (beslut R); gamla händelser läses fortfarande |
| `Underlag` | blob, mime, SHA-256, OCR-text, kopplade verifikat | Hashen ger integritet vid arkivering |
| `Motpart` | kund eller leverantör, org.nr, VAT-nummer, betalvillkor | |
| `Projekt` | namn, kund, timtaxa, status | Kan sättas per konteringsrad |
| `Artikel` | benämning, pris, enhet, momssats, lagerförd | |
| `Faktura` / `Fakturarad` | nummer, datum, förfallodag, rader, betalningar, status | Genererar verifikat vid bokföring |
| `Anlaggningstillgang` | anskaffningsvärde, datum, metod, nyttjandeperiod, restvärde, avyttring | Genererar avskrivningsverifikat |
| `Lagerpost` / `Lagerhandelse` | artikel, antal, anskaffningsvärde, inköp/uttag/inventering | Lagervärde vid bokslut |
| `Korjournalpost` | datum, sträcka, syfte, från, till, mätarställning | Underlag för milersättning |
| `Handelse` | tidpunkt, typ, entitet, data | Append-only spårbarhetslogg |
| `Skattetabell` | år, prisbasbelopp, momssatser, egenavgifter, schablonavdrag | Versionerad datafil per år |

Varje post bär dessutom `id` (UUIDv7), `enhet`, `andrad` (logisk klocka) och `raderad` (gravsten) för att kunna synkroniseras mellan enheter. `Handelse`-loggen är den auktoritativa källan — övriga tabeller är materialiserade vyer som ska gå att bygga om från loggen. Ett test verifierar att ombyggnad från loggen ger identisk databas.

---

## 5. Teknikval

| Område | Val | Motiv |
|---|---|---|
| Språk | TypeScript, `strict` | Bokföring är regelrik; typer fångar en stor del av felen |
| Ramverk | React + Vite | Störst ekosystem, snabbt bygge, bra PWA-stöd |
| Service worker | `vite-plugin-pwa` (Workbox) | Offline, installerbarhet, uppdateringshantering |
| Lagring | Dexie 4 över IndexedDB | Bra migrationsstöd och transaktioner |
| Validering | Zod | Validering vid alla gränser: import, backup, filformat |
| Utseende | Egen CSS nu, ramverk omprövas i Etapp 1 | Etapp 0 behövde hundra rader CSS. Att välja ramverk innan det finns skärmar att bygga är en gissning, och ett oanvänt beroende strider mot beroendepolicyn |
| Diagram | Egen SVG | Prövat i Etapp 4 och Chart.js behövdes inte: staplar och en linje blev ett par hundra rader som ärver appens färger, klarar mörkt läge och bär sina siffror som text |
| PDF | pdf-lib (MIT) | Fungerar i webbläsaren, kan bädda in typsnitt |
| OCR | Tesseract.js (Apache-2.0) | Enda realistiska helt lokala alternativet i webbläsaren |
| Kryptering | Web Crypto (AES-GCM), WebAuthn PRF | Inbyggt, granskat, snabbt |
| Synk och backup | PocketBase (MIT), självhostad inom EU | En binär att drifta, redan i drift för annat. Se [3.2](#32-synkbackend-pocketbase) |
| Test | Vitest, fast-check, Playwright | Enhets-, egenskaps- och flödestester |
| Belopp | Heltal i öre, branded `Ore` | Flyttal och pengar hör inte ihop |

Ingen av dessa har licensavgift eller runtime-beroende till en extern tjänst.

---

## 6. Etapper

Omfattning anges relativt: **S** liten, **M** medel, **L** stor.

### Etapp 0 — Fundament · S · ✅ klar

Skelettet som allt annat vilar på.

- ✅ Vite + React + TypeScript, ESLint, Prettier, `npm run verify`
- ✅ PWA-manifest, service worker, ikoner
- ✅ Dexie med schemaversionering och migrationsramverk
- ✅ Testrigg: Vitest, fast-check, Playwright
- ✅ GitHub Actions som kör `verify` och e2e-tester på varje push

**Klart när:** appen går att installera på hemskärmen, öppnas i flygplansläge och visar en tom startsida; CI är grön.

**Utfall.** Tre saker är värda att komma ihåg:

- **Domängränsen är lintad, inte bara dokumenterad.** `src/domain/` får inte importera andra lager, inte röra DOM eller lagring, och inte läsa klockan. Reglerna lades in innan katalogen fanns — en gräns som införs efter första överträdelsen har redan misslyckats.
- **Hård regel 8 är inbyggd i migrationsramverket.** Ett schemasteg märkt `destructive` kastar inuti Dexies uppgraderingstransaktion om ingen backupfunktion finns, vilket avbryter migreringen och lämnar databasen orörd. Båda utfallen testas.
- **Ett verkligt fel hittades av offline-testet.** Utan `clientsClaim` tog service workern aldrig kontroll över första sessionen, så appen gick sönder om man installerade den och tappade nätet innan första omladdningen.

**Kvar till Etapp 1:** valet av utseende. Se anteckningen i [teknikval](#5-teknikval).

### Etapp 1 — Bokföringskärnan · L · ✅ klar

Hjärtat. Ingenting annat får byggas ovanpå en osäker kärna.

- ✅ Kontoplan, sökbar, med egna konton och favoriter. **Ingen BAS-datafil paketerades.** Kontoplanen kommer ur SIE-importen — 299 konton med användarens egna namn och SRU-koder — plus elva grundkonton som en tom installation behöver för att alls gå att bokföra i. En BAS-fil blir aktuell först vid onboarding i Etapp 9
- ✅ `Verifikat` och `Kontering` med balansvalidering i domänen
- ✅ Verifikatserier med obruten numrering per räkenskapsår. Numret följer bokföringsordning, aldrig affärshändelsens datum — den befintliga bokföringen gör det trettio gånger på fyra år
- ✅ **Konteringsmallar**, flyttade hit från Etapp 3. Mätning av den befintliga bokföringen visar att de tolv vanligaste kontokombinationerna täcker 61 % av alla verifikat, och att bara 14 % är engångsformer. En mall är därför inte en bekvämlighet ovanpå kärnan utan det normala sättet att bokföra — och kriteriet nedan om tjugo sekunder är inte nåbart om steg två är att hitta rätt bland flera hundra konton. **Ersatta av beslutsträdet** (beslut R, se Etapp 3): en lista med namn kräver att man redan vet vilket som är rätt
- ✅ Registreringsflöde optimerat för en hand på en telefon: **vad hände → belopp → betalsätt → klart**, med konteringen alltid utfällbar och ändringsbar. Betalsättet har egna pengar (2017) som förval vid inköp, eftersom 55 % av de befintliga verifikaten är betalda privat och bara 27 % från företagskontot
- ✅ Oföränderlighet: en bokförd kontering kan inte ändras — belopp, konton, serie och nummer ligger fast. **Annullering** — full spegelvändning plus ett nytt verifikat — är det användaren möter under verbet *Ändra*, eftersom det är vad en människa faktiskt gör när något blivit fel, och lättare att följa i efterhand än en partiell justering. Partiell rättelseverifikation finns kvar som expertväg. Kopplingen går åt båda håll, så ett annullerat verifikat kan visa vilket verifikat som annullerade det
- ✅ **Rättelse av beskrivning och datum** (2026-09-17). Bokföringslagen 5 kap. 8 § tillåter att en verifikation rättas om det framgår när och av vem, så de två fälten som säger vad ett verifikat betyder går att rätta direkt i verifikationslistan. Rättelsen är en egen händelse (`verifikat.rattat`), originalvärdet står kvar bredvid det nya under verifikatet, och ett datum får inte lämna räkenskapsåret eller korsa en inlämnad momsdeklaration åt något håll. Tidigare formulerades regeln som att bokförda verifikat var helt oföränderliga, med 5 kap. 5 § som källa — men den paragrafen tillåter rättelse och ställer villkor för den. Se hård regel 5 i `CLAUDE.md`
- ✅ Utkastläget är säkerhetsventilen som gör oföränderligheten uthärdlig: ett utkast går att ändra fritt, och först vid *Bokför* blir verifikatet låst. Det är därför Kontera inte behöver den möjlighet att radera det senast bokförda verifikatet som flera konkurrenter erbjuder
- ✅ Händelselogg (append-only), som tabellerna är vyer av. Loggens innebörd uttrycks en gång, som data, så att minnesbilden och databasen inte kan glida isär
- ✅ Dagbok, huvudbok och verifikationslista med sök. Dagboken är verifikationslistan i datumordning — samma poster, och den enda ärliga skillnaden är sorteringen
- ✅ Räkenskapsår, ingående balanser, periodlåsning
- ✅ Verifikatserie per enhet, valbar per installation, och synkfälten i datamodellen från början
- ✅ **SIE-4 import och export** (`#FORMAT PC8`, `#SIETYP 4`, `#KONTO`, `#IB`, `#UB`, `#RES`, `#VER`/`#TRANS`). Flyttad hit från Etapp 4: att få in den riktiga bokföringen i kärnan så tidigt som möjligt är det bästa tänkbara testet av datamodellen, och den upptäcker fel medan de fortfarande är billiga att rätta
- ✅ **Säkerhetsventil:** fullständig export och import av databasen som JSON, redan här

**Klart när:** en utgift kan bokföras på under 20 sekunder; ett obalanserat verifikat går inte att spara; ett bokfört verifikat går inte att ändra ens via konsolen; export följt av import ger identisk databas (egenskapstest); och en befintlig bokföring från ett annat program kan importeras via SIE utan förlust.

**Utfall.** Fem saker är värda att komma ihåg:

- **Den riktiga bokföringen gick in.** Fyra års bokföring från ett annat program importeras i ett svep, varje serie obruten, varje års konteringar summerade till noll, och 2023 med sina två parallella serier A och V isär. En andra import lägger till ingenting. Exporten tillbaka stämmer mot källan konto för konto på varje `#IB`, `#UB` och `#RES`.
- **Mätning slog gissning två gånger.** Att mallar skulle vara det normala sättet att bokföra kom ur att de tolv vanligaste kontokombinationerna täcker 61 % av verifikaten. Att betalsättet skulle ha egna pengar som förval kom ur att 55 % av dem är betalda privat. Ingen av de sakerna hade planen förutsett.
- **Oföränderligheten stängdes från två håll.** Domänen fryser ett bokfört verifikat, och Dexies hooks vägrar varje `update` och `delete` på tabellen — ett fruset objekt binder bara den kod som håller i det.
- **Två buggklasser går bara att se på riktig enhet.** `crypto.randomUUID` saknas utanför secure context, och Chromium emulerar inte iOS safe areas. Båda hittades genom att titta på en installerad app på en telefon, inte i CI.
- **`noUncheckedIndexedAccess` och domänens lint-gräns fyrade sex gånger** och hade rätt varje gång. Ingen av dem tystades; koden böjde sig i stället.

### Etapp 2 — Moms · M · ✅ klar

- ✅ Momskoder med satser 25 / 12 / 6 % och momsfritt, med satserna ur mervärdesskattelagen (2023:200) 8 kap.
- ✅ Automatisk uppdelning i netto och moms, **åt båda hållen**: ett kvitto anger vad som betalades, en faktura anger nettot och lägger på momsen. Skillnaden mellan de två är exakt den öresutjämning som finns i den befintliga bokföringen, och som nu bokförs automatiskt på 3740
- ✅ Kontantmetod och faktureringsmetod som inställning. Metoden avgör **när ett verifikat skrivs**, inte hur ett skrivet läses, så rapporten är densamma — där de verkligen skiljer sig är vad som står obetalt vid ett årsskifte, och den avstämningen hör till bokslutet i Etapp 8
- ✅ Momsrapport per period med **samtliga** rutor, även de tomma. Beräknad ur kontonas rörelser i stället för ur en momskod per rad, vilket är det enda som fungerar på en bokföring inläst från SIE — den bär inga koder alls
- ✅ Specialfall: omvänd skattskyldighet, EU-inköp och EU-försäljning, import, varor och tjänster — som rutor i rapporten och som momskoder vid registrering
- 🟡 Periodisk sammanställning: **beloppen** räknas fram och appen säger till när en sådan behövs, men vilka köpare de gäller kräver kundregistret i Etapp 6. Lämnas i e-tjänsten till dess
- ✅ Periodlåsning efter inlämnad deklaration, gjord från deklarationen där den hör hemma. **Låset stoppar bara det som kan ändra en deklaration** (beslut O): ett verifikat nekas i en momslåst period bara om någon rad hamnar på ett konto som deklarationen läser. Bokslutets poster — periodisering, avskrivning, momsomföring — dateras årets sista dag och måste gå att bokföra efter att fjärde kvartalet deklarerats
- ✅ **Momsredovisning** med en knapp på Moms-sidan: periodens momskonton töms mot 2650 med ruta 49 i hela kronor, och öresskillnaden går till 3740 — samma verifikat som andra bokföringsprogram bokar varje kvartal, återskapat på öret. Momsrapporten hoppar över en sådan avräkning (och öresnollning av ett momskonto mot 3740), som annars nollade sin egen period: på den importerade bokföringen visade varje kvartal 0 i ruta 10, 48 och 49 tills det rättades 2026-09-13. Efter rättningen stämmer ruta 49 mot avräkningens belopp på 2650 i varje importerat kvartal
- 🟡 **eSKD-export** (XML) för **samtliga** rutor. Rutorna 05–12, 48 och 49 är hämtade ur Skatteverkets egen filbeskrivning; övriga ur Microsofts dokumentation av Dynamics 365-formatet för den svenska momsdeklarationen, som stämmer med Skatteverkets lista på alla nio namn som finns i båda. Ett felaktigt namn faller säkert: DTD:n avvisar ett okänt element, så filen vägras i stället för att en felaktig siffra lämnas in. Skulle blanketten få en ny ruta **vägras den med namn** i stället för att gissas. Ruta 49 skrivs även när den är noll — en nolldeklaration säger att ingenting ska betalas, vilket inte är samma sak som att inte säga något alls

**Klart när:** en exempelbokföring ger en momsrapport som stämmer mot handräknat facit ruta för ruta, och eSKD-filen accepteras vid uppladdning.

**Utfall.** Kriteriet överträffades på första halvan och är obekräftat på andra:

- **Rapporten stämmer mot riktiga inlämnade deklarationer, inte bara mot ett exempel.** Ett helt års kvartal räknade fram ur den importerade bokföringen stämde på kronan med vad som lämnades in, utom ett som skilde en krona. Orsaken är känd: nollningen av konto 2641 bokfördes *efter* momsöverföringen, så det tidigare programmet räknade med en annan ingående moms än den året slutligen står på. Skillnaden ligger i när rapporten kördes, inte i hur den räknas.
- **Avrundningsregeln var det som avgjorde.** Skatteförfarandeförordning (2011:1261) 22 kap. 1 §: belopp som avser skatt eller avgift anges i hela kronor "så att öretal faller bort" — trunkering, inte avrundning till närmaste krona, och tillämpad per ruta. Med avrundning till närmaste hade andra kvartalet blivit fel med en krona.
- **eSKD-filen är obekräftad.** Den skrivs enligt Skatteverkets beskrivning men har inte laddats upp. Det är det enda som återstår av etappens acceptanskriterium, och det kräver en skarp inlämning. DTD:n går inte längre att hämta — adressen i DOCTYPE, som alla generatorer ändå skriver ut, svarar 404 — så validering före inlämning är inte möjlig lokalt.

### Etapp 3 — Kvitton, kamera och automatik · M

- ✅ Fotografering, beskärning, komprimering och lagring av underlag. Bilden **bedöms innan den sparas** — för mörk, för suddig eller för liten i bild — med gränser hämtade ur fyra riktiga kvitton där utfallet är känt. Det är det enda ögonblick då ett nytt foto kostar ingenting, och forskningsläget är entydigt om att inmatningsbilden avgör resultatet. Varningen vägrar aldrig: ett dåligt foto på ett kvitto är värt mer än inget foto. Beskärningen erbjuds **innan** bilden sparas och aldrig efteråt: ett sparat underlag är räkenskapsinformation och ska bevaras i det skick det hade (bokföringslagen 7 kap. 2 §). Utsnittet appliceras före skalningen, så att de 2000 pixlarna längsta sidan går åt till kvittot i stället för till bordet runt omkring
- ✅ Koppling underlag ↔ verifikat, med SHA-256 för integritet. Filen lagras **innehållsadresserad** vid sidan av händelseloggen, eftersom en logg som bär megabytes av bilder inte går att spela om, synka eller läsa som JSON. Kopplingen är många-till-många och ligger på underlaget, eftersom ett bokfört verifikat är oföränderligt. Därför går ett underlag att **lägga till i efterhand** på ett bokfört verifikat — kvittot som glömdes vid bokföringen fotas eller väljs bland de väntande kvittona under Verifikat. Konteringen rörs inte, och kopplingen blir en egen händelse i loggen med tid och enhet. Den kräver en extra bekräftelse, eftersom ingenting erbjuder att ta bort den: kopplat är underlaget räkenskapsinformation (bokföringslagen 7 kap. 2 §)
- ✅ **Massimport av underlag från ett annat program.** Verifikaten kommer som SIE och kvittona som en mapp med filer, och ingen av halvorna säger vilken bild som hör till vilken bokning. Kopplingen reser i filnamnet — `2025-A50-faktura.pdf` betyder verifikat A50 i räkenskapsåret som börjar 2025 — i stället för i en separat manifestfil som kan komma i otakt med mappen. Året namnger räkenskapsåret och inte verifikatets datum, eftersom numren löper per serie och år (hård regel 6) och ett brutet räkenskapsår annars skulle placera A50 i två böcker. Planeringen är ren och skild från utförandet, så skärmen visar vad importen tänker göra innan något skrivs (hård regel 10), och en fil som inte går att placera sparas ändå utan koppling: ett underlag är bevis även när automatiken inte hittar hem. Körd två gånger gör den ingenting andra gången — filer adresseras på innehåll och kopplingen skrivs bara när den är ny. **Prövad mot riktiga data:** fyra SIE-filer ur ett annat program och underlag därifrån, där sex av sju filer namngav ett verifikat och den sjunde kändes igen på innehållet som redan lagrat
- 🟡 OCR i Web Worker: förslag på datum, belopp, moms och leverantör. **Betalsätt föreslås inte** — det står sällan på kvittot på ett sätt som går att lita på, och förvalet egna pengar träffar redan 55 % av fallen. Tesseract.js med svensk språkdata, allt från egen origin: 26 MB som hämtas första gången ett kvitto läses och cachas därefter, i stället för att paketeras med appen. Bilden **förbehandlas med lokal tröskling** före läsningen, och läses om på originalet när resultatet blir dåligt — mätt på samma foto: konfidens 68 → 84 och halva tiden, med fyra rader som annars försvann. Vilken av två läsningar som används avgörs av **hur många gånger kvittot upprepar summan**, inte av motorns konfidens: en läsning på 43 gav rätt totalsumma medan en på 50 gjorde 926,00 till 2926,00. Under konfidens 40 lämnas inget förslag alls
- ✅ **PDF läses som text**, inte som bild. En leverantörsfaktura har ett riktigt textlager, och båda de testade fakturorna tolkades exakt rätt — belopp, moms och datum — där två av fyra fotograferade kvitton inte gick att läsa alls. pdf.js (Apache-2.0), 3 MB som hämtas vid behov och cachas. Texten läggs ut med kolumnerna bevarade, eftersom en fakturas totalrad har fem siffror och bara den under *ATT BETALA* ska bokföras
- ✅ Regelmotor som föreslår svar i beslutsträdet utifrån kvittots text, med svarens sökord. Rankningen behöver ingen maskininlärning: frekvens ur den egna händelseloggen räcker, vilket också är det enda som är förenligt med att ingen data lämnar enheten. Matchningen kräver helt ord och minst fyra tecken — en kaffebryggare är inte kaffe, och "AB" står på varje svenskt kvitto. Förslaget fyller i svaret, belopp och datum i ett tryck, men bara när användaren trycker på det
- ✅ **Leverantörsminne och förklarade förslag** (2026-10-28). Det starkaste tecknet på vad ett kvitto gäller är vem det kommer från, så ett kvitto från en leverantör som bokförts förut föreslås som förra gången. Leverantören känns igen på organisationsnumret, som OCR läser rätt mycket oftare än namnet, och annars på namnet. Först därefter räknas orden på kvittot, och ord som står på nästan alla kvitton (moms, totalt, kort, kassa) räknas inte: sökordet *moms* gjorde att ett kvitto på saltsten föreslogs som *Fått tillbaka moms*. Förslaget säger vilket konto det bokför på och varför, till exempel *Konto 4000, kvittot nämner ”saltsten”*, så att ett felaktigt förslag syns innan det bokförs
- ✅ **Öresutjämning från underlaget** (2026-10-28). Tolkningen läser fakturans fyra summor, belopp exklusive moms, moms, avrundning och att betala, och formuläret bokför skillnaden mellan betalt och netto + moms på 3740 när den är under en krona. Momsen som dras av är då den som debiterades. Vid kortbetalning gäller det belopp kortet drogs på, eftersom avrundning till hela kronor bara gäller kontanter. Mätt mot de 61 PDF-fakturorna i den egna bokföringen: öresutjämningen blev rätt på 21 av 23, och de två som återstår är inskannade utan textlager. Fotona i samma underlag, nedskalade och liggande på sidan från det tidigare programmet, läses nästan aldrig rätt; vridning och förstoring före läsningen är nästa steg
- ✅ **Kvittovakten** (beslut Y, 2026-10-28). Kvitton som fotas i appen blir utkast av sig själva: en timer på servern låter Claude läsa varje nytt kvitto genom ägarens Hermes, i två frågor, först bilden och sedan konteringen med kontoplanen och tidigare bokningar av samma leverantör eller samma slags köp. Svaren kontrolleras av Bokfinks egen kod innan något blir ett utkast. Netto + moms + avrundning ska bli betalt belopp på öret och momsen en riktig momssats, och konteringen granskas som kvittoassistentens förslag. Ägaren får besked i sin chatt och bokför under Kvitton. I en provkörning mot kvitton med facit lästes beloppen rätt på alla fyra, också två liggande, lågupplösta foton där Tesseract inte fick ut något belopp, och med historiken blev konteringen densamma som ägarens egen. Uppsättningen står i [`server/kvittovakt/`](../server/kvittovakt/README.md). I appen visar ett nyss fotat kvitto *Assistenten läser kvittot…* medan vakten arbetar, appen synkar var 20:e sekund så länge Kvitton-fliken är öppen och något väntar, och *Bokför själv i stället* finns kvar som alternativ. Utkastet visar assistentens motivering och kan ändras före bokföringen: konton, belopp, datum och beskrivning, med samma kontroller som fri kontering. Ett kvitto som bara ett utkast har kopplat kan tas bort, eftersom ett utkast inte är bokföring. Det behövdes efter att en samtidig borttagning och koppling stoppade synken på två enheter
- ✅ **Beslutsträd i stället för mallar** (beslut R). Bokföringen börjar med *Vad har hänt?* — Pengar ut, Pengar in, Flytta pengar, Moms, Vid årets slut — och några svar senare står konto, moms och möjliga betalsätt klara, enligt BAS K1 2018. Varje svars moms har källa i koden: levande djur och foder 25 %, livsmedel efter datum (12 % till 31 mars 2026, tillfälligt 6 % till och med 2027, därefter frågar appen), försäkring och finansiella tjänster undantagna, stöd och egna pengar utan moms. En maskin frågar om halvt prisbasbelopp och tre år innan den blir en tillgång på 1221 (BFNAR 2006:1 punkt 6.30–6.31). Där kvittot avgör — resor, föreningsavgift, övrigt — väljs satsen i formuläret. Sökfältet hittar svaren direkt, de mest använda visas först, och *Ändra konteringen* tar över raderna till fri kontering. Momsredovisning, lager, obetalda fakturor och avskrivning pekar vidare till sina skärmar. Nya böcker startar med BAS K1:s konton; befintliga behåller sina och får de saknade tillagda. En såld inventarie på 1222 räknas i ruta 05
- ✅ **Fri kontering** för det frågorna inte räcker till, och för att ändra en föreslagen kontering — kvitton med flera momssatser, betalning av moms, inventarieköp — med debet och kredit i var sin kolumn och bokför-knappen avstängd tills raderna balanserar. Ett väntande kvitto kan kopplas på vägen
- ✅ **Inga framtida datum** (beslut P): bokföringen nekar ett datum efter i dag, oavsett vilken skärm som bokför
- ✅ **Kvittoassistent via Claude** (beslut N). Ägaren skickar ett foto eller en PDF i Claude-appen till en session som körs på ägarens egen server, till exempel en Raspberry Pi, får ett konteringsförslag byggt på den egna kontoplanen och på hur samma leverantör bokförts tidigare, och svarar ja. Då skickas ett **utkast** med underlaget kopplat, och appen visar det under fliken Kvitton där ägaren granskar och trycker Bokför. Assistenten kan inte bokföra — den har ingen verifikatserie — så varje nummer delas fortfarande ut av en enhet där en människa tryckt på knappen (hård regel 10). Kopplingen kräver ingen ny datamodell: bokföringen behåller utkastets id, så ett underlag som kopplats till utkastet är verifikatets underlag i samma stund. Verktyget (`src/agent/`) är en enhet utan skärm som går med i synken: det läser hela loggen till en databas i minnet vid varje körning och sparar ingenting mellan körningarna, hämtar aldrig filer, kontrollerar konton, balans och periodlåsning innan något skickas, och vägrar ett kvitto som redan hör till ett utkast eller verifikat. Bilder kodas om till samma gränser som appens kamera (2000 px, JPEG 80) med ImageMagick, och EXIF med platsuppgifter tas bort. Provat mot en tillfällig PocketBase 0.39.9 med riktig kryptering: utkast och underlag kom fram och kunde läsas av en annan enhet. Arbetsgången för sessionen står i `.claude/skills/kvitto/SKILL.md`
- ⏸️ Bankimport från kontoutdrag (CSV) med matchning mot redan bokförda poster. **Nedprioriterad efter beslut K.** Koden för kolumntolkning och matchning finns kvar, men bygger på gissade kolumnnamn som aldrig testats mot en riktig exportfil, eftersom bankens app inte visar kontoutdrag i mobilen — det enhet som sköter den löpande bokföringen enligt beslut H. Utan ett nåbart utdrag finns ingen indata att importera, och användaren känner inget behov av funktionen. Byggs vidare om ett utdrag blir nåbart igen, t.ex. via internetbanken på dator
- 🟡 Utländsk valuta med kurs. Beloppet räknas om till kronor (bokföringslagen 4 kap. 6 §) med en kurs användaren anger, och både beloppet och kursen skrivs in i verifikatets beskrivning — en siffra som ingen kan räkna fram igen är inte räkenskapsinformation. Omräkningen sker i heltal via BigInt, eftersom produkten av öre och en kurs med sex decimaler passerar 2^53. **Kursdifferens** finns som domänfunktion men används inte ännu: den uppstår bara i faktureringsmetoden, där fakturan bokförs vid ett tillfälle och betalas vid ett annat, och hör därför ihop med reskontran i Etapp 6. **Vilken kurs som ska användas för beskattningsunderlaget vid EU-inköp är en regelfråga som inte är avgjord** — appen registrerar den kurs den får

**Klart när:** ett fotograferat kvitto ger ett ifyllt formulär där högst ett fält behöver rättas i typfallet.

**Läge.** Huvuddelen är uppfylld och testad: e2e-testet fotograferar ett kvitto med texten *Kraftfoder 25 kg / Att betala 520,31 / 2026-02-13*, och ett tryck på förslaget fyller i svaret, belopp och datum. Bankimporten är byggd men nedprioriterad — se beslut K.

### Etapp 4 — Rapporter och datautbyte · M

- ✅ Resultat- och balansräkning per period (helår, kvartal, månad), med samma period föregående år som jämförelse. Grupperad efter BAS-kontoklasserna, inte efter det förenklade årsbokslutets blankett — den svarar på en annan fråga och hör till bokslutet i Etapp 8. Tecknen följer hur en resultaträkning skrivs ut: intäkter positiva, kostnader negativa, och kolumnsumman är resultatet. Balansräkningen bär periodens resultat som en egen rad, eftersom resultatkontona inte stängs mot eget kapital förrän vid bokslutet — utan den raden går en balansräkning mitt i året inte ihop
- ✅ Nyckeltal och diagram: resultat per månad, likviditet vid varje månadsskifte, kostnadsfördelning och momsskuld. **Chart.js används inte** — fyra bilder som är staplar och en linje ritas som egen SVG på ett par hundra rader i stället för med ett bibliotek på 200 kB. Egen SVG ärver appens färger genom CSS-variabler, fungerar i mörkt läge utan att tillsägas, skalar till vilken bredd som helst och bär sina egna siffror som text — vilket gör dem läsbara för en skärmläsare, något en canvas inte kan
- 🟡 Export av huvudbok, verifikationslista, resultat- och balansräkning till **CSV och JSON**, från den vy rapporten står i. CSV:n är skriven för att öppnas rätt i ett svenskt Excel: semikolon, decimalkomma, CRLF och byte order mark — utan dem öppnas filen som en kolumn text, eller så tolkas 1.5 som ett datum. Debet och kredit får var sin kolumn, som en bokföringsexport läses. JSON skriver belopp i hela ören, eftersom det som läser JSON är ett program och 520.31 redan har passerat ett flyttal. **Riktig xlsx saknas** — se [öppna beslut](#9-öppna-beslut). **Kundreskontra** kräver kundregistret i Etapp 6
- Delning av rapporter som PDF
- Export till redovisningskonsult: ett paket med SIE, rapporter och underlag

SIE ligger sedan Etapp 1. Här kompletteras det med golden file-test av hela varvet ut och in.

**Klart när:** resultat- och balansräkningen stämmer mot handräknat facit för en exempelbokföring, och rapporterna är läsbara på en telefonskärm.

### Etapp 5 — Säkerhet, säkerhetskopiering och synkronisering · L

Detta är gränsen för när appen får användas skarpt.

- ⏸️ Lås med passkey (Face ID / Touch ID) via WebAuthn, med PRF-härledd krypteringsnyckel. **Nedprioriterat efter beslut G.** Appen har en användare, telefonen är redan låst av iOS, och ett lås i appen ovanpå det skyddar mot en angripare som redan har enheten upplåst i handen. Det som verkligen läckte — säkerhetskopian — är krypterad sedan Etapp 5:s första punkt. Byggs om förutsättningarna ändras
- ⏸️ Lösenfras som fallback och återställningsväg, med utskrivbar återställningskod. Hör ihop med låset ovan. Lösenfrasen för säkerhetskopian finns och gör sitt jobb
- 🟡 Kryptering av databas och underlag i vila (AES-GCM). **Säkerhetskopian krypteras**, med AES-GCM-256 och en nyckel härledd ur en lösenfras med PBKDF2-SHA256 i 600 000 varv (OWASP:s rekommendation). Salt, algoritm och antal varv står i klartext i filen, så att den går att öppna om sju år och så att varvtalet kan höjas utan att gamla kopior blir olästa. AES-GCM autentiserar: fel lösenfras och ändrad fil misslyckas likadant, vilket är det som gör en kopia trygg att lägga i molnet. **Databasen på enheten krypteras inte**, som följd av beslut G: utan ett lås måste nyckeln ligga bredvid låset, och iOS krypterar redan enhetens lagring. Synkens nyttolast krypteras om en lösenfras är satt; annars går den okrypterad till den egna servern (beslut X)
- ⏸️ **Automatisk** krypterad säkerhetskopiering. **Nedprioriterad.** En PWA har ingen ståendebehörighet att skriva till en mapp — `navigator.share` visar delningsarket varje gång, och File System Access API (som skulle kunna komma ihåg en mapp) finns inte i WebKit, varken på iOS eller macOS. Enda tänkbara kryphålet är att peka Safaris förvalda nedladdningsmapp på en iCloud Drive-mapp under Inställningar och låta appen trigga en vanlig nedladdning i stället för delningsarket — oprövat på en installerad hemskärms-PWA, och just den sortens sak som bara går att verifiera på riktig telefon, inte i emulering eller CI. Vald väg tills vidare: manuell knapp, men snabb — se raden nedan
- ✅ **Snabb manuell säkerhetskopiering**, byggd i stället för automatik. Kortet för gammal kopia på Att göra-sidan är inte bara en varning utan hela flödet: lösenfras och knapp direkt i kortet, utan omväg via Inställningar. Krypteringslogiken delas med Inställningar-sidans egen "Spara krypterad säkerhetskopia" via en gemensam funktion, så de två vägarna inte kan glida isär. Fortfarande en full export varje gång, inte inkrementell — databasen är i skrivande stund liten nog att det inte känns
- ✅ Tydlig varning i gränssnittet när senaste kopian är för gammal. Ett kort på Att göra-sidan, samma plats som väntande utkast och kvitton, eftersom en gammal kopia är precis den sortens sak den sidan finns för. Ingen kopia alls är det mest brådskande läget och visas direkt, annars räknas dagar sedan `backup.senast` (satt när en kopia, krypterad eller ej, faktiskt sparats eller delats) mot en trettiodagarsgräns — en UX-avvägning, inte en regel ur lagen
- ✅ **Testad återställning** till en tom enhet — inklusive ett automatiskt test som gör det. Två lager: ett Playwright-test som tömmer webbläsarens IndexedDB, laddar om appen och läser in en krypterad kopia via gränssnittet — den verkliga vägen för en tappad telefon — och ett datalagertest som kedjar hela kryptot (PBKDF2-nyckel härledd på nytt ur enbart lösenfrasen, AES-GCM-dekryptering, import) och jämför hela tillståndet och hela loggen mot originalet, underlag inräknat. Fel lösenfras testas separat: nyckeln den ger authenticerar inte, så AES-GCM vägrar
- ✅ **Arkivpaket för sjuårsarkiveringen**: SIE-fil, verifikationslista som PDF, samtliga underlag som var kopplade till ett verifikat det året, checksummor och en läsanvisning (`LASMIG.txt`), i en zip-fil som går att läsa utan Kontera. Zip-skrivaren är handskriven — samma motivering som SIE- och eSKD-skrivarna: det är den enda fil som måste gå att öppna på vilken dator som helst 2033, utan att det här projektets beroendeträd nödvändigtvis går att installera längre — och verifierad för hand mot tre oberoende läsare (Debians unzip, Pythons zipfile, 7-Zip) medan den skrevs. Det är så en verklig kompatibilitetslucka hittades: Debians unzip 6.00 hanterar inte UTF-8-flaggan för filnamn, så arkivnamn är begränsade till ASCII — kostar inget eftersom varje namn arkivet faktiskt använder (en SHA-256, en fast textrad) redan är ASCII. PDF:en byggs med **pdf-lib** (MIT), planerat val sedan teknikval, lazy-laddat precis som pdfjs-dist så att bygget inte kostar något förrän arkivet faktiskt exporteras. Varje underlag omhashas mot sin egen kontrollsumma innan det tas med — ett bitrötat kvitto ska aldrig arkiveras som om det vore helt
- ✅ **Synkservern är i drift** (beslut W), som en egen PocketBase-instans på samma server som appen, nådd genom tailnetet. Den första händelsen kom dit 2026-09-18. Den ersätter beslut I, som lät servern vänta och lät enheterna byta krypterade kopior som filer. Filvägen finns kvar och fungerar fortfarande, eftersom import slår ihop i stället för att skriva över. Priset står kvar: en tjänst till att hålla vid liv, byggd på en 0.x-produkt med manuella migreringssteg. Det är därför servern aldrig är sanningskälla ([3.2](#32-synkbackend-pocketbase)), och därför den ska klara en omstart utan att någon gör något
- ✅ **Synkronisering mellan telefon och dator** enligt [3.1](#31-flera-enheter) och [3.2](#32-synkbackend-pocketbase): utbyte av operationsloggar över PocketBase, krypterade om en lösenfras är satt. Protokollet är en union av två append-only-loggar och innehåller ingen konfliktlösning, för det finns ingenting att lösa — händelser är oföränderliga och namngivna med UUIDv7, så en dubblett är en no-op och fel ordning löses av att loggen viks ihop i id-ordning. En kö-tabell håller reda på vad servern inte sett; det som kommer *från* servern hamnar aldrig i kön. Provat mot en riktig PocketBase 0.39.9: två databaser, krypterade nyttolaster, identiska loggar efteråt
- ✅ **Underlagen följer med synken.** Händelseloggen bär aldrig bilder — det är det som gör den möjlig att spela om och skicka — så filerna åker i en egen runda efter händelserna, adresserade på sitt innehåll. Utbytet blir en mängddifferens i stället för ett protokoll: en avbruten överföring kostar bara de filer den inte hann med, och en ny körning avslutar jobbet. Det som hämtas hashas innan det sparas, eftersom adressen är ett löfte om innehållet och en kopia som inte håller det inte är räkenskapsinformation (bokföringslagen 7 kap. 1 §); en fil som inte stämmer räknas och rapporteras i stället för att stoppa resten. Byten krypteras med samma nyckel som händelserna, som byte och inte base64
- ✅ **Automatisk synk vid fyra tillfällen** — appen öppnas, den kommer fram igen, nätet återvänder, eller något bokförts här (efter en paus, så att en skur av poster blir en runda). Ingen timer: den hade väckt en telefon i en ficka för att ställa en fråga ingen väntar på. Ingenting sker förrän server, inloggning och lösenfras alla finns, så en app som inte satts upp gör fortfarande ingen nätverkstrafik alls (hård regel 7). En runda som misslyckas visas som en rad i synkrutan, inte som ett larm — nästa tillfälle försöker igen
- ✅ **Att byta server tömmer markören och köar om hela loggen.** Utan det blir bytet en tyst nullåtgärd: kön håller bara det som aldrig skickats, så en enhet som synkat en gång hade loggat in på den nya servern, skickat ingenting och rapporterat framgång
- ✅ Synkklienten bakom ett gränssnitt i `src/platform/` med fem metoder, vilket är det som gör påståendet i [3.2](#32-synkbackend-pocketbase) kontrollerbart: servern kan bytas mot en dummare filhink utan att en enda regel går förlorad
- ✅ Synkstatus i gränssnittet: vad som väntar på att skickas, när det senast lyckades, och vilken enhet det här är. Serveruppsättningen ligger i [`server/pocketbase/`](../server/pocketbase/README.md)
- ✅ **Serverns schema ligger i repot**, som PocketBase-migreringar i [`server/pocketbase/pb_migrations/`](../server/pocketbase/README.md#uppdatera-schemat) som servern själv kör vid start. Det första skriptet satte gränsen för en händelse till `0`, vilket PocketBase läser som standardgränsen 5 000 tecken och inte som obegränsat. En större händelse avvisades med en naken 400 och höll kvar allt bakom sig i kön (upptäckt 2026-10-28). Gränsen är nu 10 MB, samma som för en fil
- ✅ **En händelse som servern avvisar stoppar inte resten.** Varje händelse skickas för sig och lämnar kön så fort servern har tagit den, så en avbruten runda kostar bara det den inte hann med. En avvisad händelse räknas, ligger kvar i kön och visas med serverns skäl, och hämtningen från den andra enheten går igenom ändå. Ett nätverksfel stoppar däremot rundan, eftersom allt annat skulle misslyckas likadant
- ✅ **Nya försök efter ett fel, medan appen är öppen**: efter 15 sekunder, efter en minut och sedan var femte minut. Servern är en dator hemma som startar om ibland, och en telefon som frågade mitt i en omstart ska inte behöva stängas och öppnas för att försöka igen. En dold app frågar ingenting, så det är fortfarande ingen timer som väcker en telefon i fickan
- ✅ **Serveradressen fylls i** när appen har öppnats från en adress på tailnetet. Servern antas ligga bredvid appen, på port 8444. Det är bara ett förslag i fältet: ingenting skickas förrän användaren loggar in
- ✅ **Lösenfrasen för synken är valbar, och ingen är förvald** (beslut X). Utan den går händelserna som JSON och underlagen som sina egna byte till servern, och en ny enhet behöver bara logga in. Med den krypteras båda som förut. Båda sorterna läses av alla enheter, så en server kan ha en blandning medan enheterna går över: en händelse börjar alltid med `{`, vilket base64 aldrig gör, och en okrypterad fil stämmer mot sin adress som den är. En enhet utan lösenfras som möter krypterad bokföring ber om lösenfrasen i stället för att visa ett krypteringsfel
- Konfliktvy för de fall som inte kan avgöras automatiskt

**Klart när:** hela databasen kan återskapas på en ny enhet från en säkerhetskopia, verifierat av ett automatiserat test; två enheter som bokfört var för sig i flygplansläge kan synkas utan att ett enda verifikat går förlorat eller dubbleras, verifierat av ett egenskapstest.

> **Milstolpe M1 — skarp användning.** Efter Etapp 5 kan den nuvarande appen sägas upp.

### Etapp 6 — Kunder, projekt och fakturering · L · ⏸️ nedprioriterad

**Nedprioriterad efter beslut M.** Fakturering behövs sällan eller aldrig i verksamheten, så hela etappen — kund- och projektregister, fakturor, kundreskontra — väger inte sin egen omfattning just nu. Byggs om förutsättningarna ändras. Se [öppna beslut](#9-öppna-beslut).

- Kund-, projekt- och artikelregister med timtaxor
- Tidregistrering per projekt som blir fakturaunderlag
- Fakturor, offerter och betalningspåminnelser som PDF, med eget utseende och logotyp
- Distribution via delningsmenyn
- Kundreskontra: obetalda fakturor, förfallobevakning, delbetalningar, dröjsmålsränta
- Automatisk bokföring av faktura och betalning enligt vald redovisningsmetod
- Leverantörsreskontra för obetalda leverantörsfakturor

**Klart när:** en faktura kan skapas, delas och senare matchas mot en betalning, med rätt bokföring i båda metoderna.

### Etapp 7 — Anläggningsregister och lager · M

Fakturering (Etapp 6) nedprioriterad efter beslut M (behövs sällan eller aldrig) — Etapp 7 blev nästa steg i stället, i två halvor.

**Rättelse till planens egen formulering**, upptäckt vid genomgång av BFN:s K1-vägledning (BFNAR 2006:1, uppdaterad 2025-03-24) innan koden skrevs: maskiner och inventarier skrivs **kollektivt** av (punkt 6.38) — alla inventarier i en gemensam pott, en avskrivningssiffra per år för hela potten, aldrig en egen flerårsplan per pryl. En försäljningsvinst eller -förlust bokförs inte heller separat, utan bakas in i samma års avskrivning (punkt 7.4, 7.9). Registret finns kvar — för spårbarhet och för kompletteringsregeln, som behöver varje tillgångs eget anskaffningsvärde och ålder — men "en avskrivningsplan per inventarie" nedan var fel bild av regelverket.

- ✅ **Anläggningsregister**: benämning, anskaffningsdatum, anskaffningsvärde, nyttjandeperiod, avyttring (försäljning eller utrangering). `src/domain/anlaggning/anlaggningstillgang.ts`
- ✅ **Avskrivningar enligt K1**, som en kollektiv pott: direktavdrag när anskaffningsvärdet är högst ett halvt prisbasbelopp (punkt 6.30) eller nyttjandeperioden högst tre år (punkt 6.31); annars räkenskapsenlig avskrivning (huvudregel 30 %, kompletteringsregel 20 %/år per kvarvarande tillgång) eller restvärdesavskrivning (25 %) på hela potten — och hela potten får skrivas av på en gång när den är högst ett halvt prisbasbelopp (punkt 6.38). `src/domain/anlaggning/avskrivning.ts`, hand-verifierat mot BFN:s egna exempel 6-5, 6-6, 6-8
- ✅ **Alla tre metoder räknas parallellt**, plus direktavdrags-till-noll-alternativet, och vilken som bokförs är alltid ett val — aldrig ett redan ifyllt förslag (hård regel 10)
- 🟡 **Avskrivningsverifikat bokförs på en knapptryckning, inte automatiskt vid bokslut** — bokslut som flöde finns inte än (det är Etapp 8), så "automatiskt … vid bokslut" är omformulerat till samma mönster som OCR-förslag: appen räknar fram och visar, användaren trycker Bokför
- ✅ **Ny "versioned yearly data"-tabell**: prisbasbelopp per år (`src/domain/skatt/skattetabell.ts`), 2023–2026 hämtade och verifierade var för sig mot regeringens fastställanden — appens första sådan tabell, mönstret för nästa (egenavgifter, schablonavdrag)

**Utökning, upptäckt vid genomgång av en befintlig anläggningsförteckning** inför en engångsmigrering: verksamheten är lantbruk, med byggnader, markanläggningar, mark, skog och djurlager — fyra regelverk den ursprungliga planen inte täckte. Byggt i stället för att bara importera inventarie-fliken och tappa resten av historiken.

- ✅ **Fastighetskomponenter**, avskrivna individuellt (till skillnad från den kollektiva potten ovan): byggnad (Skatteverkets procentsats per byggnadstyp, RSV 2003:6), markanläggning (5 %, eller 10 % för täckdike/skogsväg), mark och skog (skrivs aldrig av). `src/domain/anlaggning/fastighetstillgang.ts`, `byggnadsprocentsatser.ts` — kontrollerat mot en befintlig bokföring och mot handräknat facit: en ekonomibyggnad på 64 518,50 kr ger exakt 2 580,74 kr i årlig avskrivning tre år i rad, en markanläggning på 27 413,75 kr ger 1 370,69 kr
- ✅ **Djurlager** (IL 17 kap. 5 §): djur i jordbruk är alltid lagertillgångar, värderade lägst till 85 % av Skatteverkets årliga produktionsutgift (SKVFS, bara 2025 inlagt — ett saknat år vägras hellre än gissas), aldrig mer än nettoförsäljningsvärdet. `src/domain/lager/djurlager.ts`, `djurproduktionsutgift.ts` **Lagerförändringen bokförs** från inventeringen på balansdagen (punkt 7.7 d): konto 1400 förs till det inventerade värdet mot 4990, som i ägarens egen bokföring varje år. Inventering en gång om året, ingen löpande räknare (ägarens beslut 2026-09-13)
- ✅ Egna skärmar: fastighetskomponenterna som en andra sektion på anläggningsregistret, djurlagret som en ny sida (`Fastighetssektion.tsx`, `Lagersida.tsx`) — verifierade i webbläsaren mot samma öresexakta tal
- ⏸️ **Skogsavdrag** (IL 21 kap.) är medvetet inte byggt — en separat avdragsrätt som blir aktuell först vid en virkesförsäljning; att gissa på mekaniken innan den behövs riskerar att bli fel
- ⏸️ Lagerregister för annat än djur (inköp, uttag, svinn, inventering av vanligt varulager) — inte aktuellt för den här verksamheten, byggs om det blir det
- ⏸️ Lagervärdering och lagerförändring vid bokslut — nästa steg

**Klart när:** ett inköp bokfört till poolkontot ger ett avskrivningsunderlag och tre parallella avskrivningsförslag som stämmer mot handräknat facit, inklusive året för anskaffning och året för avyttring — uppfyllt för anläggningshalvan (se `src/data/anlaggning.test.ts`, exempel 6-5 genom en riktig liggare). Fastighetskomponenter och djurlager uppfyllda på samma sätt, mot handräknat facit. Lagerregister-halvans motsvarande kriterium för vanligt varulager återstår (inte aktuellt just nu).

### Etapp 8 — Bokslut och deklaration · L

- ✅ **Obetalda fakturor och periodisering enligt K1**, ombyggt 2026-09-13 efter research med ägaren. K1 tar vid årets slut upp en sluten lista: obetalda kund- och leverantörsfakturor (BFNAR 2006:1 punkt 6.56, 6.70), förskott och räntor över 5 000 kr (6.59, 6.60, 6.72, 6.73) och beslutade men ej utbetalda stöd och ersättningar (6.61) — inget annat, och en försäkringspremie som berör två år kostnadsförs i sin helhet. Varje post bokförs på årets sista dag och **förs tillbaka automatiskt första dagen nästa år** (ägarens beslut), så att betalningen räknas en gång. Obetalda fakturor tas upp med moms, eftersom årets sista momsdeklaration ska ta med moms på obetalda fakturor enligt bokslutsmetoden. Den tidigare periodiseringen per dag, som följde K2 snarare än K1, är borttagen
- ✅ **Bokslutsverifikationer och checklista för årsavslut.** Räkenskapsårsskärmen visar nu vad som är mekaniskt kontrollerbart (öppna utkast, momstäckning, djurlager inventerat i år, dagar sedan backup) som ✅/❌, och en påminnelse om att kontrollera avskrivningar och periodiseringar för hand - det är ett omdöme, inte något en checklista kan se (hård regel 10). Två nya steg innan "Avsluta" går att trycka: skapa nästa räkenskapsår (`nastaRakenskapsarsperiod` - tolv kalendermånader oavsett hur långt det avslutade året var, bokföringslagen 3 kap. 3 §) och beräkna och föra över utgående balanser dit, återanvänder `beraknaSaldon`/`utgaendeBalanser` från rapportmodulen så överföringen aldrig kan säga något annat än en rapport skulle. `src/domain/bokslut/arsavslut.ts`, `src/data/arsavslut.ts`, `src/features/rakenskapsar/Rakenskapsarsida.tsx`
- ✅ **Egna uttag och insättningar, eget kapital-hantering för enskild firma.** En enskild firma har ingen lön till sig själv (BFN K1 punkt 6.66: eget kapital är bara tillgångar minus skulder) - ny skärm bokför ett rått uttag eller insättning (BAS 2013 mot valfritt betalkonto, inget kostnads- eller intäktskonto inblandat) och visar en sammanställning per år: IB, uttag och insättningar var för sig, årets resultat hittills, UB. `src/domain/bokslut/egetkapital.ts`, `src/data/egetkapital.ts`, `src/features/bokslut/Egetkapitalsida.tsx`
- ✅ **Förenklat årsbokslut enligt K1.** Årets saldon sorteras i blankettens rutor (B1–B16, R1–R11, U1–U4), samma rutor som NE-bilagan använder. Kopplingen konto → ruta är avskriven ur BAS egen tabell, *BAS Förenklat årsbokslut (K1) – Kontoplan 2018* med minimikontoplan, den senaste K1-tabell BAS publicerar. Bara intervall tabellen täcker får en ruta: grupper den utelämnar (18, 21–22, 25, 28, 36, 38, 48, 88) listas som konton utan ruta i stället för att gissas in någonstans, och syns också som en differens. Där BAS själv anger två rutor – 37xx och 39xx (R1/R2, beroende på om intäkten var momspliktig) och 77xx och 7980 (R9/R10, beroende på tillgången) – väljer användaren. Valet sparas per konto och gäller alla år, eftersom det beror på verksamheten och inte på året: med bara momspliktig försäljning hör 3740 öresutjämning till R1. B10 är eget kapital vid årets slut och tar in den del av resultatet som ännu inte förts över, eftersom blanketten saknar en resultatrad på balanssidan. Därför blir B10 densamma före och efter en bokslutspost 8999 mot 2019 – vilket är det som gör det säkert för Kontera att bokföra en också (beslut S), inte bara läsa in en som ett annat program bokat. Avstämt mot de fyra importerade åren: balansen går ihop på öret varje år, och det enda konto som kräver ett val är 3740 öresutjämning. `src/domain/bokslut/forenkladArsbokslut.ts`, `src/features/bokslut/Arsbokslutsida.tsx`
- 🟡 **NE-bilagan** framräknad ur bokföringen, med avstämning mot resultat och balans. Sidan 1 är det förenklade årsbokslutet i hela kronor, med fältkoder och tecken ur Skatteverkets fältnamnstabell `NE_SKV2161-13-02-25-02` (paketet för beskattningsperiod 2025P4). Varje ruta **avrundas till närmaste krona**: Skatteverkets anvisning för NE säger "avrundat till hela kronor", och trunkeringen i skatteförfarandeförordningen 22 kap. 1 § gäller belopp som avser skatt eller avgift, vilket NE-rutorna inte är. B10 och R11 räknas sedan ur de avrundade rutorna, så som blanketten definierar dem ("tillgångar - skulder" och summan av raderna ovanför R11), vilket gör att sidan 1 alltid går ihop – ett egenskapstest håller det. Sidan 2 för över R11 till R12 och tillämpar de inmatade justeringarna i blankettens ordning och tecken till R47 eller R48, med blankettens tre tak (R30, R34, R36). Justeringarna som inte står i bokföringen matas in, per år; att räkna fram egenavgifter och liknande är nästa punkt. Avstämt mot de tre stängda importerade åren: sidan 1 går ihop, och underskotten hamnar i R48. **Inte uppladdad ännu.** `src/domain/skatt/nebilaga.ts`, `src/features/bokslut/Nebilagasida.tsx`
- 🟡 **SRU-export** (`INFO.SRU` + `BLANKETTER.SRU`) för uppladdning i Skatteverkets filöverföring. Formatet följer Skatteverkets *Teknisk information om filöverföring* och filexemplet i 2025P4-paketet: ISO 8859-1, CR LF, en #post per rad, belopp i hela kronor med inledande minustecken. Golden files i `src/domain/sru/__fixtures__/`. **Bara beskattningsperioder vars fältnamnstabell kontrollerats skrivs** – i dag 2025P4. Ett senare år vägras med ett meddelande, eftersom blanketten kan ändras mellan åren; 2026P4 läggs till när Skatteverket publicerar paketet (brukar ske i november) och filen kan provas i filöverföringens testingång, som öppnar i december. Brutet räkenskapsår vägras också. Personnumret måste ha tolv siffror och rätt kontrollsiffra, eftersom seklet inte går att få fram ur det tiosiffriga organisationsnumret. `src/domain/sru/sru.ts`
- ✅ **Två automatiska kontroller vid bokslutet**, båda upptäckta genom att stämma av mot en inlämnad NE-bilaga. Ett debetsaldo på 2650 är en momsfordran, inte en skuld, och hör hemma på 1650 bland tillgångarna – annars hamnar det som ett minusbelopp i B14. Årsbokslutsskärmen upptäcker det och bokför omföringen på bokslutsdagen på en knapptryckning; beloppet byter ruta, resultat och eget kapital står stilla. NE-skärmen föreslår föregående års underskott (R48) som årets R24, men fyller aldrig i det själv. `src/domain/bokslut/momsomforing.ts`
- ✅ **Årets resultat till eget kapital, och omföringen av 20xx-kontona vid årsskiftet** (beslut S), samma praxis som i andra bokföringsprogram. Årsbokslutsskärmen bokför 8999 mot 2019 på en knapptryckning – synlig så länge något av resultatet sitter kvar på resultatkontona, och för en delsumma om en rättelse landar i året efter en tidigare överföring. "Beräkna och för över utgående balanser" bokför därefter en omföring av alla 20xx-underkonton (skattekontot, uttag, insättningar, årets resultat) mot 2010 som ett verifikat på det nya årets första dag, så varje år börjar på noll i stället för att de växer sig stora. Ingen av delarna rör resultatet – `forenkladArsbokslut.ts` räknar likadant med eller utan dem. Byggs inte förrän det nya året kan bokföras (inga framtida datum); en repeterad knapptryckning känner igen en redan bokförd omföring i stället för att dubblera den. `src/domain/bokslut/egetkapital.ts`, `src/data/egetkapital.ts`, `src/data/arsavslut.ts`
- ⏸️ Skattemässiga justeringar: schablonavdrag för egenavgifter, räntefördelning, periodiseringsfond, expansionsfond

**Klart när:** en NE-bilaga går att ladda upp hos Skatteverket och siffrorna stämmer mot bokföringen post för post.

### Etapp 9 — Påminnelser, körjournal och polering · S

- ✅ Att göra-vy: momsdatum, förfallodagar, obokförda kvitton, gammal säkerhetskopia. **Momsdatum klart** (2026-10-04): ett kvartal som tagit slut utan att perioden låsts visas som ett kort med sista dag för deklaration och betalning — skatteförfarandelagen 26 kap. 26 § (12 maj, 17 augusti, 12 november, 12 februari) och 62 kap. 3 §, flyttad till nästa vardag enligt lag (1930:173) om beräkning av lagstadgad tid 2 §, med helgdagarna ur lag (1989:253). Kortet försvinner när perioden låses på Moms-sidan, vilket kortet själv säger. Ett avslutat räkenskapsår hoppas över, så en importerad historik inte lyser upp. **Bara kvartalsmoms:** månadsmoms kan följa två olika tabeller (26 kap. 27–28 §§) och årsmoms beror på EU-handel (33 och 33 a §§), så där visas inget datum hellre än ett gissat. Obokförda kvitton och gammal säkerhetskopia fanns redan. **Förfallodagar** (beslut T): en leverantörsfaktura som väntar som underlag får en förfallodag, som en egen händelse i loggen (`underlag.forfallodag`). OCR föreslår datumet bara när det står efter en etikett som *Förfallodatum* eller *Betala senast*, och förslaget sparas aldrig utan ett tryck. Fakturan som förfaller först visas på Att göra, med leverantören när texten säger vem, tills betalningen bokförs och underlaget kopplas. Kundfakturor saknas fortfarande, eftersom faktureringen i Etapp 6 är nedprioriterad
- ✅ **`.ics`-export** av momsdatum, deklarationsdatum och fakturaförfall till iOS Kalender (2026-10-04). En knapp under Mer delar en kalenderfil med heldagsposter och två påminnelser, en vecka före och samma dag klockan nio: momsdeklarationerna för öppna år som inte låsts, inkomstdeklarationen för varje år i bokföringen (2 maj året efter, skatteförfarandelagen 32 kap. 1 §, flyttad till nästa vardag) och fakturorna med förfallodag. Varje post har ett stabilt UID, så en kalender som respekterar det uppdaterar i stället för att dubblera vid en ny import. Skrivaren är handskriven, och referensfilen är läst med Pythons icalendar-paket. **Inte provad i iOS Kalender ännu.** Datum för år som inte skapats finns inte i filen, så den behöver exporteras igen efter varje nytt räkenskapsår
- ✅ **Navigering som i andra bokföringsappar** (2026-10-28). Fem flikar: Översikt, Kvitton, Bokför, Verifikat och Mer, samma uppdelning som Bokio, Fortnox och Spiris har i mobilen. Moms hade en egen flik för något som görs fyra gånger om året, medan kvitton, som fotas varje vecka, låg som en länk längst ned på startsidan. Under Mer ligger det som görs kvartalsvis, årsvis eller en gång, grupperat som Löpande, Bokslut, Register och Inställningar. Startsidan har inte längre en länklista under att göra-listan, och Bokför finns inte längre både som knapp och flik. Kvitton-fliken är en inkorg för allt som väntar på att bokföras: kameran överst, utkasten från kvittoassistenten och de fotade kvittona, med antalet som väntar på fliken. Översikten svarar på två frågor: finns det något att göra, med ett kort per sak, och hur går året, med resultat, pengar i kassa och bank och moms att betala samt de tre senast bokförda verifikaten. Redovisningsperiod och redovisningsmetod ställs in under Företaget i stället för överst på momssidan, som nu bara visar vad som gäller
- Körjournal med milersättning och avdragsberäkning
- Traktamente och representation med gällande avdragsregler
- Tillgänglighet, mörkt läge, tumvänliga klickytor, snabbknappar från hemskärmen
- Onboarding för första start

### Etapp 10 — Föreningsbok · M

Appen ska kunna föra bokföringen för vilken ideell förening som helst, bredvid en enskild firma (beslut V och Z). Det första fallet att prova mot är en bygdegårdsförening som hyr ut sin lokal och äger sin fastighet, och bedöms därför vara bokföringsskyldig. Den är inte momsregistrerad, bokför i dag i ett annat bokföringsprogram för föreningar, har räkenskapsår lika med kalenderår och en revisor som får en SIE-fil. Bokföringsskyldigheten och vilket allmänt råd bokslutet ska följa är ännu inte bekräftade med revisorn. Fallet är ett prov, inte en gräns för vad profilen får innehålla.

**Så skiljer sig föreningen från enskild firma** (BFNAR 2010:1 med ändring genom BFNAR 2024:6, och Skatteverkets sidor om ideella föreningar; se källorna):

- **Ingen ägare.** Föreningen är en egen juridisk person. Egna uttag och insättningar (2013, 2017), NE-bilaga, egenavgifter och personnummer finns inte; föreningen har organisationsnummer.
- **Eget kapital** är *balanserat över-/underskott* och *årets över-/underskott*. *Reserverade medel för ändamål* ingår i eget kapital och påverkar inte resultatet (punkt 6.66–6.67). Föreningen gör inga avsättningar för framtida åtaganden (6.68).
- **Intäkter** delas i medlemsavgifter (intäkt när de betalas, 7.1), gåvor och bidrag (7.2–7.4) och övriga verksamhetsintäkter. Ett villkorat bidrag med återbetalningsskyldighet redovisas som skuld tills det med hög sannolikhet inte återkrävs (6.77, 7.4). Ett bidrag får redovisas det år det betalas eller det år det hänför sig till, om beslut och dokumentation finns innan bokslutet är färdigt (7.3). En medlemsavgift är aldrig ett förskott (6.73).
- **Bokslutet** följer bilaga 2: resultaträkning och balansräkning med **jämförelsetal på varje rad** (5.2), en öppningsbalansräkning när rådet börjar tillämpas (1.5) och underskrift av styrelsen med datum per ledamot (bilaga 2 i BFNAR 2024:6). Byggnad och mark delas med utgångspunkt i taxeringsvärdet (6.4). Ändringen 2024:6 gäller räkenskapsår som inleds efter 30 juni 2024 och rör bara momshänvisningen (mervärdesskattelagen 2023:200) i 2.4 och 6.27 samt bilagans utseende.
- **Kontantmetod eller faktureringsmetod** får båda användas (4.1). Rättelse sker genom ny verifikation (4.5).
- **Moms.** Medlemsavgifter, bidrag, lotter och annonser i föreningens egen tidning är momsfria. En förening som inte är momsregistrerad får inte dra av ingående moms, så momsen ingår i kostnaden och anskaffningsvärdet. Uthyrning av lokal är momsfri om föreningen inte väljer frivillig skattskyldighet. Registrering krävs bland annat vid momspliktig försäljning och vid köp av tjänster från utlandet.
- **Skatt.** En ideell förening lämnar Inkomstdeklaration 3 (SKV 2003), inte INK2. Medlemsavgifter, bidrag och gåvor är skattefria. Kapital-, fastighets- och rörelseinkomster beskattas med 20,6 % om föreningen inte är allmännyttig; en allmännyttig förening har undantag. Appen gör ingen deklaration för föreningen, och SRU-filen för NE-bilagan hör inte till föreningsprofilen.
- **Bokföringsskyldighet** gäller om tillgångarna överstiger 1,5 miljoner kronor, om föreningen bedriver näringsverksamhet, om den är moderföretag i en koncern eller om stadgarna föreskriver det. Appen avgör inte detta; en förening som för bokföring frivilligt bokför på samma sätt.

- ✅ **Flera böcker** (beslut V, 2026-10-22). Varje bok är en egen databas, med egna verifikat, konton, räkenskapsår, inställningar, säkerhetskopior och exporter. Den ursprungliga databasen är första boken och behövde ingen migrering. Ett litet register håller namnen och vilken bok som är öppen på enheten; försvinner det hittas bokdatabaserna igen. Med fler än en bok står den öppna bokens namn överst på varje skärm, eftersom det är på Bokför-skärmen ett kvitto hamnar i fel bok. Exporterade filer får bokens namn, utom den ursprungliga bokens som behåller sina. **En säkerhetskopia bär sin boks identitet**, och en återställning till en bok som redan har innehåll vägrar en kopia från en annan bok — en återställning slår ihop, och hård regel 5 ger ingen väg att ta bokförda verifikat ur fel bok igen. En tom bok tar kopians identitet, vilket är hur en bok flyttas till en ny enhet: skapa en tom bok och läs in kopian. `src/data/bokregister.ts`, `src/data/bokidentitet.ts`, `src/features/bocker/Bocker.tsx` **En bok kan tas bort** (2026-10-30): under Böcker, för varje bok utom den första. En bok som ingen har använt, alltså med bara det en ny bok startar med (`arEnbartStartdata`), tas bort direkt utan fråga. En bok med bokföring, utkast, kvitton, egna konton eller projekt kräver att man skriver bokens namn, och frågan säger vad den innehåller, att räkenskapsinformation ska bevaras i sju år (7 kap. 2 § BFL) och att en synkad boks server behåller sin egen kopia. Databasen tas bort före registerposten, så ett misslyckande lämnar boken som den var; tas den öppna boken bort öppnas den första, med ett meddelande som överlever omladdningen. Den första boken kan inte tas bort, eftersom registret skulle sätta tillbaka den. `src/data/bokregister.ts` (`lasBokinnehall`, `tabortBok`)
- 🟡 **Föreningsprofil** per bok (beslut Z). Man väljer *Enskild firma* eller *Ideell förening* när boken skapas, och valet kan inte ändras. Delarna byggs som egna commits, i den här ordningen:
  1. ✅ **Profilen i bokens databas** och väljaren vid skapande. Profilen ligger i bokens metadata bredvid identiteten och följer med säkerhetskopian; en tom bok som tar en kopias identitet tar också dess profil, även när kopian saknar en (då är den en firmas). Böcker som fanns före profilen är enskild firma. En profil som versionen inte känner till, till exempel från en nyare app, vägras med ett felmeddelande i stället för att tas för en firma. Väljaren har inget förval, eftersom valet inte kan ändras. `src/domain/bok/bokprofil.ts`, `src/data/bokidentitet.ts`
  2. ✅ **Skärmar och påminnelser efter profil.** En förening har inte NE-bilagan, eget kapital med egna uttag och insättningar, djurlagret eller årsbokslutet för enskild näringsidkare (K1); de dyker upp igen när föreningen får sina egna motsvarigheter (steg 3 och 5). Adressen till en dold vy öppnar Översikt, som en adress som aldrig funnits. Kalenderfilen har ingen inkomstdeklaration för en förening, eftersom dess sista dag inte är belagd. **Moms är en egen inställning** under Företaget, *inte momsregistrerad* från början: tills den slås på finns ingen momsskärm, inga momsdeklarationsdatum och ingen momssiffra på Översikt och i Nyckeltal, och momsperioden döljs. En enskild firma är alltid momsregistrerad som förut. Texten om personnummer byts mot föreningens organisationsnummer. `src/domain/bok/bokprofil.ts` (`harFunktion`, `arMomsregistrerad`), `src/ui/vy.ts` (`doldaVyer`). ⚠️ Beslutsträdet bokför fortfarande ingående moms och betalsätt som egen insättning även i en förening; det byts i punkten om beslutsträd för föreningen, så en förenings bokföring bör ännu göras med fri kontering
  3. ✅ **Eget kapital för föreningen** (BFNAR 2010:1 punkt 6.66–6.67). Under *Eget kapital* i en föreningsbok visas ingående kapital, årets över-/underskott och utgående kapital, med det balanserade kapitalet före årets resultat som en egen rad, och en uppdelning i *reserverade medel för ändamål* och *ej reserverat*. Bilaga 2 har bara balanserat och årets under eget kapital, så de reserverade medlen står som en uppdelning av det balanserade och inte som en tredje sort. En reservering flyttar kapital från 2010 till ett eget konto per ändamål, eller tillbaka, och rör aldrig resultatet. **Ändamålets konto väljs av föreningen** inom 2020–2049, och finns det inte skapas det med det namn man anger; appen föreslår inget kontonummer, eftersom BAS-numren för föreningars fonder inte är belagda här. Kontona listas i bokens metadata (`reserveradeMedelKonton`), och **årsskiftets omföring av 2011–2019 mot 2010 hoppar över dem**, annars hade reserveringen vikts in i 2010 den 1 januari. Appen avgör inte vad som får reserveras eller hur mycket: ett större belopp än det fria kapitalet nekas inte, utan visas som ett negativt *ej reserverat*. `src/domain/bokslut/foreningskapital.ts`, `src/data/foreningskapital.ts`, `src/features/bokslut/Foreningskapitalsida.tsx`. ⚠️ Överföringen av årets resultat (8999 mot 2019) och balansräkningens uppställning ligger i steg 5; tills dess finns ingen knapp för den i en föreningsbok
- ✅ **Föreningens kontoplan.** En ny föreningsbok startar med ett eget startset om 44 konton (`FORENINGENS_GRUNDKONTON`) i stället för BAS K1:s, och utan konton som hör till en ägare (2012, 2013, 2017). Numren följer kontoplanen hos en förening som fört sin bokföring i ett föreningsprogram, och namnen är våra egna, så att en bok som startas här och en som importeras därifrån använder samma nummer för samma sak. **BAS har ingen kontoplan för ideella föreningar** (bas.se har en för alla utom K1 och en K1 för enskilda näringsidkare), så inget i startsetet påstås vara BAS:s. Två nummer styrs av bokföringsmotorn och inte av den kontoplanen: 3740 för öresutjämning, dit varje kvittos avrundning går, och 3010 för försäljning, så att den hålls isär från övriga verksamhetsintäkter i bilaga 2. Ett konto som redan finns i boken lämnas som det är, så en importerad kontoplan behåller sina namn. Förtryckta SRU-koder ingår inte: kopplingen till Inkomstdeklaration 3 är inte belagd. `src/data/uppstart.ts`. ⚠️ Anläggningar-skärmens förvalda konton (1129, 1229 med flera) är fortfarande K1:s och måste ändras för hand i en föreningsbok
- ✅ **Periodisering av bidrag och andra poster vid årets slut.** Under *Obetalda fakturor och periodisering* har en föreningsbok en egen lista (`FORENINGENS_BOKSLUTSPOSTER`, BFNAR 2010:1) i stället för K1:s. De två bidragsposterna kommer först: **beslutat bidrag som inte betalats ut** blir en fordran på 1600 och en intäkt på 3710 (6.53, 7.3 b), och kräver att man bekräftar att det finns ett beslut och dokumentation om beloppet, som regeln kräver; **bidrag som hör till nästa år** tas ur årets intäkt och hålls som skuld på 2900 (6.76). Båda gäller bara en förening som redovisar bidrag det år de hör till (7.3 b); redovisar den dem när de betalas ska inget tas upp. Därtill obetald faktura till kund och från leverantör, förskott från hyresgäst och till leverantör (över 5 000 kr, 6.51 och 6.73) och upplupen ränta, alla utan momsdelning eftersom en icke momsregistrerad förening inte drar av moms (6.71, 7.12). Varje post bokförs 31 december och återförs 1 januari, som firmans. Posten för ränta betald i förväg finns inte för en förening, eftersom BFNAR 2010:1 inte nämner den, och ett villkorat bidrag som blivit intäkt är ingen periodisering utan en flytt från skuld till intäkt som bokförs med Fri kontering. En momsregistrerad förening får en varning om att momsen inte delas här. `src/domain/bokslut/bokslutspost.ts`, `src/features/bokslut/Bokslutspostsida.tsx`
- ✅ **Beslutsträd för föreningen.** Bokför-skärmen i en föreningsbok ställer föreningens egna frågor (`FORENINGSTRAD`, `src/domain/beslutstrad/foreningstrad.ts`): *Pengar ut* (fastigheten, kontor och post, inventarier, varor och vinster, försäkring, bankavgift, ränta, avgift till organisation, amortering, deposition tillbaka), *Pengar in* (medlemsavgift, bidrag i fyra vägar, gåva, uthyrning, lotter, försäljning, deltagaravgift, försäkringsersättning, ränta, lån, deposition), *Flytta pengar* (kassa, bank, placeringskonto) och *Vid årets slut*. Den bokför för en förening som **inte är momsregistrerad**: alla blad bokför bruttot på kostnaden, eftersom en utgift är utbetalningen exklusive *avdragsgill* moms (BFNAR 2010:1 punkt 7.12 a). En momsregistrerad förening får inget eget träd och bokför med Fri kontering, eftersom momsen i en blandad verksamhet måste fördelas och det inte är utrett här. Ett villkorat bidrag tas upp som skuld (6.77), ett bidrag till en byggnad eller inventarie hänvisas till Anläggningar (6.12, 6.33), och en medlems utlägg bokförs när föreningen betalar tillbaka. Bladens id börjar på `f-`. **Kvittoassistenten** får veta profilen i `kvittovakt.json` (`profil`, `momsregistrerad`), eftersom profilen ligger i bokens metadata och synkloggen inte för den med sig. För en förening frågar den läsaren om en ideell förening, säger att det inte finns någon moms att dela av och att hela beloppet är kostnaden, och visar föreningens svar och konton i stället för firmans; `lage` visar föreningens översikt. En momsregistrerad förening vägras vid start, med ett fel som säger varför. En fil utan fält är en firmas som förut. `src/agent/konfig.ts`, `lasning.ts`, `lage.ts`
- 🟡 **Projekt per konteringsrad** (beslut AA). Ett projekt är en egen post (`projekt.skapat`) med en kod och ett namn, och en konteringsrad pekar på det med id; **ett projekt per rad och valfritt**, så en faktura kan delas mellan två bidrag och de flesta rader har inget. Det kan sitta på alla sorters rader, så att en skuld för ett villkorat bidrag kan följas per projekt. Koden blir objektnumret i SIE (`#DIM 6 "Projekt"`, `#OBJEKT 6 "kod" "namn"`, `#TRANS konto {6 "kod"}`, enligt SIE 4C punkt 8.17) och ändras inte efteråt; namnet och om projektet är avslutat får ändras. Ett projekt kan **rättas på en bokförd rad** som en beskrivning kan det, med datum och vem som gjorde det (5 kap. 8 § BFL), eftersom det inte ändrar något belopp eller konto. Ägaren har inte tillgång till det nuvarande programmets bokföring och vet därför inte om det använt projekt, så **SIE-importen läser `#DIM`, `#OBJEKT` och objektlistan i `#TRANS`** i stället för att släppa dem som i dag. Ett projekt har bara kod och namn; mer data är mer att underhålla. Revisorn ska kunna få: **A.** en SIE 4-fil med fullständig verifikations- och objektinformation, **B.** ett projektutdrag ur huvudboken per projekt, **C.** budget mot faktiskt utfall för ett projekt, och **D.** underlag för fördelning av gemensamma kostnader. Delarna byggs som egna commits i den här ordningen:
  1. ✅ **Projektet som post och på en konteringsrad.** Nya händelser `projekt.skapat` och `projekt.andrat`, en ny tabell `projekt` (schemaversion 8, en vy av loggen som de andra, taggad `fore-projektmigrering` före ändringen) och ett valfritt `projekt` på en rad. Ett projekt som inte finns, eller är avslutat, nekas när en rad sparas eller bokförs; en annullering släpps igenom för ett avslutat projekt, eftersom ett fel annars inte gick att rätta, och bär projektet med sig. Två projekt får inte ha samma kod (versaler och gemener räknas lika). Återföringen vid årets slut tappade tidigare projektet och gör det inte längre. Syns ännu inte i något formulär. `src/domain/projekt/projekt.ts`, `src/data/kommandon.ts`
  2. ✅ **Rättelse av projekt** på en bokförd rad. Under *Rätta text, datum eller projekt* i verifikationslistan har varje rad ett projektval. Rättelsen skrivs i händelsen `verifikat.rattat` och sparas på verifikatet med radens nummer (från noll), det gamla projektet och det nya, plus när och vilken enhet (5 kap. 8 § BFL); belopp, konton och ordning rörs aldrig. Ett nytt projekt måste finnas och vara öppet, medan ett projekt får tas bort från en rad även om det har avslutats. Vaktkoden på en bokförd rad jämför nu allt utom projektet, och kräver att varje rad vars projekt skiljer har en egen rättelse som säger samma sak, så en ändring runt rättelsen nekas. En rättelse av flera fält på en gång (beskrivning och datum, eller flera rader) nekades tidigare av samma vakt med felet *kan inte ändras*, eftersom den bara godtog exakt en ny rättelse; det är rättat i en egen commit. `rattaVerifikat` i `src/data/kommandon.ts`, `ratta` i `src/domain/verifikat/verifikat.ts`
  3. ✅ **SIE med projekt** (A). Exporten deklarerar `#DIM 6 "Projekt"` och ett `#OBJEKT` per projekt, och skriver objektlistan på varje rad som har ett: `#TRANS 5020 {6 "P2026"} 1000.00`. Importen läser dem: varje objekt i dimension 6 blir ett projekt, även ett som ingen rad använder, eftersom de är föreningens lista; ett projekt som redan finns under samma kod återanvänds, så ett andra år inte ger en andra uppsättning; ett objekt en rad använder men filen aldrig deklarerat blir ändå ett projekt. Ett objektnummer som inte passar som kod (mellanslag, snedstreck, för långt) skrivs som en som passar, och det sägs. **Andra dimensioner läses inte in**, och det sägs en gång per dimension. Importens varningar visades tidigare aldrig för användaren; de står nu i meddelandet efter importen. `#OIB`, `#OUB` och `#PSALDO` skrivs inte: ingående balanser har inget projekt, så ett objektsaldo vore inte ett riktigt saldo, och en mottagare räknar om det ur verifikationernas objektlistor. `src/domain/sie/parser.ts`, `skrivare.ts`, `src/data/sieimport.ts`, `sieexport.ts`
  4. ✅ **Projekt i formulären** och en skärm för att skapa och avsluta projekt. Skärmen *Projekt* ligger under Mer, bland registren: kod och namn, byt namn, avsluta och öppna igen; koden visas som låst. **Fri kontering** och utkast som ändras har ett projektval per rad. **Bokför** (frågorna) har ett enda val som sätter projektet på kostnads- eller intäktsraden och inte på betalningsraden eller momsraden, eftersom det är kostnaden som ett projekt följer; fältet börjar tomt för varje ny post, så ett projekt aldrig följer med från förra. **Periodisering** sätter projektet på intäkts-/kostnadsraden och balansraden men inte momsraden, och återföringen får det med sig. Alla valen är gömda tills boken har ett projekt, och ett avslutat projekt erbjuds bara på en rad som redan har det. Verifikat, utkast och förslag visar projektets kod på raden. Kvittoassistenten sätter inget projekt (beslut AA). `src/features/projekt/Projektsida.tsx`, `src/features/bokfor/Projektval.tsx`, `medProjektPaKonto` i `src/domain/projekt/projekt.ts`
  5. ✅ **Projektutdrag** per projekt (B). Under Rapporter finns en flik *Projekt* när boken har minst ett projekt: man väljer projekt och period (hela projektet eller ett räkenskapsår) och får intäkter (klass 3), kostnader (klass 4–7), finansiella poster (klass 8) och resultat, med summan per konto, samt raderna bakom siffrorna i den ordning de bokfördes. Resultatkonton räknas inom perioden; **balanskonton räknas från projektets början till periodens slut**, eftersom ett bidrag som tas emot ett år och används nästa måste följas över årsskiftet, och ingående balanser saknar projekt. **"Vad som återstår av ett bidrag" är skulden på projektet**: ett bidrag som tagits emot men ännu inte tagits upp som intäkt ligger på en skuldrad med projektet, och det som står kvar där är det som återstår att använda. Det förutsätter att bidraget bokförts som skuld; bokförs det direkt som intäkt finns ingen skuld att visa, och en budget att jämföra mot kommer med del 7. Varje belopp visas i sin grupps tecken, så en skuld är positiv. En annullering bär projektet och tar ut beloppen igen. Utdraget kan exporteras som CSV och JSON, raderna först och summorna i en egen kolumn, ur samma funktion som skärmen. `src/domain/projekt/projektutdrag.ts`, `projektutdragTabell` i `src/domain/export/tabeller.ts`, `src/features/projekt/Projektutdrag.tsx`
  6. ⬜ **Fördelning av gemensamma kostnader** (D): en rapport över kostnader utan projekt per konto, och en bokning som flyttar ett belopp mellan *inget projekt* och ett projekt på samma konto, så att kontots saldo inte ändras men projektets utfall gör det
  7. ⬜ **Budget mot utfall per projekt** (C), tillsammans med punkten om budget mot utfall nedan
- ⬜ **Budget mot utfall.** Föreningens stadgar kan ge årsmötet en redovisning av budget- och verksamhetsplan
- ✅ **Bokslut för förening** (beslut: regelverket är BFNAR 2010:1, förenklat årsbokslut, bekräftat av ägaren 2026-10-30). Det får upprättas när föreningens nettoomsättning tillsammans med bidrag, gåvor, medlemsavgifter och liknande intäkter normalt är högst 3 miljoner kronor och den inte är skyldig att upprätta årsredovisning; gränsen får överskridas enstaka år men inte flera i rad (BFN:s vägledning, kommentar till 1.1). Under *Förenklat årsbokslut* visar en föreningsbok uppställningen i **bilaga 2** (i lydelsen efter BFNAR 2024:6): resultaträkning och balansräkning med **jämförelsetal för varje post** (kapitel 5), där en post utan belopp båda åren utelämnas, inga poster läggs till eller slås ihop, och Årets över-/underskott står under Eget kapital. Eget kapital räknas fram som tillgångar minus skulder minus obeskattade reserver (6.66), så balansräkningen går ihop av sig själv, och därför **måste ett konto med belopp som ingen post tar placeras** innan bokslutet är klart. Bilagan ger ingen kontoplan, så **vilken post ett konto hör till är föreningens egen bedömning**: förvalet följer kontots nummer och är ett förslag, och var till exempel fastighetens kostnader hör hemma (Verksamhetskostnader eller Övriga externa kostnader) bör stämmas av med revisorn. De ändamålsbestämda medlen visas i en not till eget kapital, som vägledningen anger, och inte som en egen post. Sidan har en knapp för att föra årets resultat på eget kapital (8999 mot 2019), underskriftsrader för varje styrelseledamot och *Skriv ut eller spara som PDF* som skriver ut bara bokslutet. Det första året har inga jämförelsetal; sidan säger det, och föregående år behöver läsas in, till exempel ur en SIE-fil. Inte byggt: övriga noter än den för ändamålsbestämda medel, varulager och finansiella placeringar (värderas för hand), och öppningsbalansräkningen (1.5), som kommer med de ingående balanserna. `src/domain/bokslut/foreningsbokslut.ts`, `src/data/foreningsbokslut.ts`, `src/features/bokslut/Foreningsbokslutsida.tsx`

**Kända begränsningar.** Synken är inställd per bok, men servern skiljer inte på böcker: två böcker får inte synka mot samma konto. Kvittoassistenten (beslut N) hör till den bok vars synk den är inställd på. Registret är per enhet, så en bok som ska finnas på både telefon och dator skapas på den andra enheten genom att läsa in en säkerhetskopia i en tom bok.

---

## 7. Kompletteringar till kravlistan

Punkter som saknades i den ursprungliga kravlistan men som behövs för att appen ska fungera i verkligheten. De är redan inarbetade i etapperna ovan.

**Krav som följer av lagen**

1. **Oföränderlighet, annullering och rättelseverifikat.** En bokförd kontering får inte ändras — fel rättas med en ny verifikation som pekar på originalet (bokföringslagen 5 kap. 5 §). Beskrivning och datum får rättas, om det framgår när och av vem (5 kap. 8 §). I gränssnittet sker det oftast som annullering: hela verifikatet speglas bort och ett nytt skrivs. Detta måste finnas i datamodellen från början; det går inte att lägga till efteråt.
2. **Obruten verifikationsnummerserie** per serie och räkenskapsår.
3. **Spårbarhetslogg.** Vem gjorde vad och när.
4. **Arkivpaket för sju år.** Räkenskapsinformationen ska kunna presenteras i vanlig läsbar form under hela arkiveringstiden (7 kap.). Ett format som bara Kontera kan läsa duger inte — därför SIE plus PDF plus originalbilder med checksummor.
5. **Var arkivet får förvaras.** Räkenskapsinformation ska som huvudregel förvaras i Sverige. Elektroniskt bevarande i ett annat EU-land är tillåtet om platsen anmäls till Skatteverket och omedelbar elektronisk åtkomst kan ges vid kontroll. Detta påverkar valet av backupmål — se [öppna beslut 1](#9-öppna-beslut).
6. **Papperskvitton.** Sedan 1 juli 2024 får originalet förstöras så snart informationen överförts på ett betryggande sätt. Kontera ska hjälpa till att göra överföringen betryggande: hela kvittot i bild, läsbarhetskontroll och checksumma.
7. **Periodlåsning** efter inlämnad momsdeklaration, så att en historisk period inte kan ändras av misstag.

**Praktiska krav**

8. **SIE-import som migreringsväg.** Utan den börjar bokföringen om från noll. Detta är den funktion som avgör om bytet från nuvarande app blir möjligt eller inte, och den ligger därför redan i Etapp 1.
9. **Bankimport och avstämning.** Skulle ha varit den enskilt största tidsbesparingen i löpande bokföring, men är nedprioriterad — se [beslut K](#9-öppna-beslut). PSD2-integration kostar pengar; import av kontoutdrag som CSV gjorde inte det, men kräver ett nåbart utdrag, vilket saknas sedan Swedbank byggde om sin app.
10. **Reskontror.** Kundreskontra fanns i kravlistan under export, men behöver finnas som funktion: vilka fakturor är obetalda och vilka har förfallit.
11. **Periodisering** av förutbetalda och upplupna poster vid bokslut.
12. **Utländsk valuta** med kurs och kursdifferens — dyker upp så fort något köps utomlands.
13. **Egna uttag och insättningar.** Specifikt för enskild firma och lätt att glömma i en generisk bokföringsmodell.
14. **Skattemässiga justeringar** utöver momsen: egenavgifter, räntefördelning, periodiseringsfond. Utan dem blir NE-bilagan fel.
15. **Öresavrundning** med eget konto och en dokumenterad, testad avrundningsregel.
16. **Skattetabeller per år** som versionerade datafiler: prisbasbelopp, momssatser, milersättning, avdragsgränser. Ska kunna uppdateras utan att röra logiken.
17. **Export till redovisningskonsult.** En knapp som paketerar allt en konsult eller revisor behöver.
18. **Flera räkenskapsår** samtidigt öppna, med ingående balanser och årsavslut.
19. **Projekt och kostnadsställe per konteringsrad**, inte bara per verifikat.
20. **Onboarding vid första start:** företagsuppgifter, räkenskapsår, momsperiod, redovisningsmetod, ingående balanser eller SIE-import.

---

## 8. Risker

| Risk | Konsekvens | Hantering |
|---|---|---|
| **Dataförlust vid tappad telefon** | Hela bokföringen borta, lagbrott | Backup är ett krav för milstolpe M1, inte en extrafunktion. Återställning testas automatiskt. |
| **Felaktig momsberäkning upptäcks vid deklaration** | Rättelse, i värsta fall skattetillägg | Handräknade facit i tester, avstämning mot nuvarande app under första året, dubbelkörning parallellt en momsperiod |
| **OCR för dålig för svenska kvitton** | Registrering blir långsammare, inte snabbare | OCR är alltid ett förslag. Mät verklig träffsäkerhet på egna kvitton innan mer arbete läggs på den. Byte till ONNX-modell är förberett. |
| **BAS-kontoplanens licensvillkor oklara** | Kan behöva tas bort ur repot | Utreds i Etapp 1. Fallback: generera kontoplanen ur de konton som faktiskt används, plus användarens egen SIE-import. Se [öppna beslut 7](#9-öppna-beslut). |
| **PocketBase bryter kompatibilitet mellan versioner** | Synken slutar fungera efter en uppgradering | PocketBase är transport, aldrig sanningskälla. Ingen domänlogik i servern, arkivpaketet utanför den, synkklienten bakom ett gränssnitt. Ett byte ska kosta en kväll, inte ett projekt. Uppgradera aldrig servern samma dag som en momsdeklaration ska lämnas. |
| **iOS ändrar lagringsregler** | Data vräks | `navigator.storage.persist()`, backup, och varning i appen när kopian är gammal |
| **Passkey försvinner** (byte av telefon utan iCloud-nyckelring) | Databasen går inte att låsa upp | Lösenfras som alternativ upplåsning plus utskrivbar återställningskod, obligatoriskt vid uppsättning |
| **Synk tappar eller dubblerar verifikat** | Bokföringen blir fel utan att det syns | Oföränderliga konteringar och en verifikatserie per enhet gör kollisioner strukturellt omöjliga. Rättelser av beskrivning och datum avgörs av loggordningen, med båda kvar i historiken. Egenskapstester som simulerar två enheter offline. Synk läggs aldrig ovanpå en datamodell som inte förberetts för den. |
| **Projektet dör halvvägs** | Bokföringen fast i ett halvfärdigt verktyg | Full export i öppna format finns redan i Etapp 1. Det ska aldrig kosta något att lämna Kontera. |
| **Etapperna växer** | Inget blir klart | Varje etapp har ett "klart när". Nya idéer läggs i denna plan, inte i pågående arbete. |

---

## 9. Öppna beslut

Tjugofyra frågor är besvarade och har arbetats in i planen. De kvarstående kan vänta.

### Besvarade

| # | Fråga | Svar | Följd |
|---|---|---|---|
| A | Redovisningsmetod | Kontantmetoden | Standard i kärnan; faktureringsmetoden byggs som inställning |
| F | Synkbackend | **Egen PocketBase-instans, samma server, eget schema** | En egen instans, skild från andra tjänster på samma server. Eget backupschema och räkenskapsinformationen avskild den dag Skatteverket ska ges åtkomst |
| G | Lås med Face ID | **Nedprioriterat.** Enanvändarapp, och telefonen är redan låst av iOS | Byggs om förutsättningarna ändras. Se Etapp 5 |
| H | Arbetsfördelning mellan enheterna | **Telefonen sköter det löpande, datorn används vid bokslut och deklaration** | Ursprungligen: synkservern sätts inte upp, filvägen räcker. Den delen ersatt av beslut W; arbetsfördelningen gäller |
| I | Synkserver eller filer | **Filer tills vidare.** PocketBase-instansen sätts inte upp. *Ersatt av beslut W* | Import slår redan ihop i stället för att skriva över, så två enheter som byter krypterade kopior hamnar i samma tillstånd. Synkkoden ligger färdig och oanvänd |
| B | Migrering | Ja, SIE-fil finns | SIE-import flyttad från Etapp 4 till Etapp 1 |
| C | Flera enheter | iPhone och dator, båda bokför | Synkronisering krävs; se [3.1](#31-flera-enheter). Operationslogg och verifikatserie per enhet in i Etapp 1 |
| D | Säkerhetskopia | Krypterad fil till iCloud Drive | Grundskyddet. Ersätts eller kompletteras av synkmålet, se fråga 1 |
| J | Momsperiod | **Kvartal** | Grundförutsättningar uppdaterad. Rapportperioder och påminnelser (Etapp 9) utgår från kvartal |
| K | Bank | **Bankimport nedprioriterad** | Bankens app visar inte kontoutdrag i mobilen — den enhet som sköter den löpande bokföringen enligt beslut H — och behovet bedöms inte finnas. Etapp 3:s bankimportpunkt nedprioriterad (⏸️), koden ligger kvar oanvänd |
| L | Automatisk säkerhetskopiering | **Manuell, men snabb** | En PWA kan inte skriva tyst till iCloud Drive (se Etapp 5). I stället: en snabbkopia direkt på Att göra-kortet, samma två tryck som ett bokfört verifikat |
| U | Kryptering av säkerhetskopian (2026-10-22) | **Valbar.** Lösenfras ger en krypterad kopia, utan lösenfras en oskyddad | Räkenskapsinformationen förvaras på enheten; kopian är redundans och ägaren väljer var den hamnar. En glömd lösenfras gör kopian oläslig för alltid, vilket kan vara värre än att den är läsbar på ägarens egen disk. Båda valen finns både på Säkerhetskopia-sidan och i snabbkopian på Att göra. Synken förblir alltid krypterad, eftersom servern inte ska behöva vara betrodd. *Den sista meningen ersatt av beslut X* |
| M | Verksamhetens art | **Fakturering behövs sällan eller aldrig** | Etapp 6 (kunder, projekt, fakturering) nedprioriterad. Nästa etapp väljs om — se [öppna beslut, kvarstående](#9-öppna-beslut) |
| N | Kvitton via Claude på egen server (2026-09-12) | **Ja, som utkast. Synkens lösenfras får ligga i en fil på servern** | Assistenten skickar utkast med underlag, aldrig bokförda verifikat. Filen har rättigheterna 600 och verktyget vägrar läsa den annars, men lösenfrasen ligger på samma maskin som synkservern: den som kommer åt maskinen kan läsa bokföringen, och löftet att servern aldrig ser bokföringen gäller inte mot den. Kvittobilderna passerar Anthropic via Claude-appen — det är ägarens eget val utanför appen; appen själv skickar fortfarande ingenting utöver synken (hård regel 7) |
| O | Momslåsets räckvidd (2026-09-13) | **Stoppar bara verifikat som påverkar momsdeklarationen** | Bokslutets poster daterade 31 december går att bokföra efter att fjärde kvartalet låsts. Ett avslutat år är fortfarande helt stängt |
| P | Framtida datum (2026-09-13) | **Går inte att bokföra** | Kontrolleras i bokföringskommandot med dagens datum i Europe/Stockholm, så alla vägar in lyder regeln |
| Q | Prisbasbelopp från SCB (2026-09-13) | **Undantag från hård regel 7: hämtas med en knapp** | Enda anropet utöver den egna synkservern. Görs bara när användaren trycker på Hämta från SCB, skickar bara årtalet (SCB:s statistikdatabas, tabell PR0101E, CC0) och sparas först efter ett andra tryck. Värdet kan också skrivas in för hand; tabellen i koden går före där den har året |
| R | Mallar eller beslutsträd (2026-09-13) | **Beslutsträd, och BAS K1-kontoplanen i stället för den importerade bokföringens konton** | Mallsidan och grundmallarna borttagna. Kontoanvändningen skiljer sig från tidigare år (t.ex. 4000 i stället för 4010, 2641 i stället för 2640, 2017 för egna insättningar), eftersom bokförda verifikat inte kan ändras. Konteringen kan alltid ändras innan den bokförs |
| T | Var en fakturas förfallodag sparas (2026-10-04) | **På det väntande underlaget**, inte i ett eget leverantörsregister | Ny händelse `underlag.forfallodag`, ingen schemaändring. Passar kontantmetoden: fakturan bokförs när den betalas, och då kopplas underlaget och påminnelsen försvinner av sig själv. En leverantörsreskontra kan byggas ovanpå i Etapp 6 om det behövs |
| V | Flera böcker, för en förening bredvid firman (2026-10-22) | **En databas per bok**, inte en bokkolumn på varje rad | Firmans befintliga bokföring flyttas inte och behöver ingen migrering. Böckerna kan inte blandas i rapporter, säkerhetskopior eller arkiv, och föreningens bok kan lämnas över hel till nästa kassör. En säkerhetskopia från en annan bok vägras. Se Etapp 10 |
| S | Omföring av 20xx-kontona vid årsskiftet (2026-09-13) | **Ja, samma praxis som andra bokföringsprogram** | Årsbokslutet får ett steg som bokför årets resultat 8999 mot 2019 på årets sista dag; "för över balanser" bokför därefter en omföring av 2011-2019 mot 2010 som ett verifikat på det nya årets första dag. Ingen av delarna påverkar resultat eller R11/B10, som redan räknar rätt utan dem – de gör bara att kontona själva, och en huvudbok, visar samma sak. Byggs inte om det nya året inte kan bokföras än (inga framtida datum); knappen görs om nästa gång |
| W | Synkservern i drift (2026-10-28) | **Ja. PocketBase-instansen enligt beslut F används för synk mellan telefon och dator**, och ersätter beslut I | Servern har varit i drift sedan september 2026, och kvittoassistenten (beslut N) går genom den. Schemat ligger i repot som migreringar som servern kör själv, och appen försöker igen av sig själv när servern inte svarar. Säkerhetskopian och arkivpaketet ligger fortfarande utanför servern, så en trasig server kostar synken men inte bokföringen. Platsen för räkenskapsinformationen på servern ska anmälas till Skatteverket om den ligger utanför Sverige (bokföringslagen 7 kap.) |
| X | Lösenfras för synken (2026-10-28) | **Valbar, och ingen som standard.** Utan lösenfras går synken okrypterad till den egna servern | Lösenfrasen låg redan i en fil på samma maskin som servern för kvittoassistenten (beslut N), så mot servern skyddade den lite, medan den måste skrivas in på varje ny enhet och utan den var allt på servern oläsligt även för ägaren. Utan lösenfras kan den som kommer åt servern eller dess säkerhetskopior läsa bokföringen. Trafiken är fortfarande krypterad (HTTPS inom tailnetet), och servern kräver inloggning. Den som vill kan sätta en lösenfras, som då krypterar som förut. Den som går över från krypterad synk tömmer servern och skickar hela loggen på nytt från en enhet, se [`server/pocketbase/`](../server/pocketbase/README.md#gå-över-till-synk-utan-lösenfras) |
| Y | Kvitton läses av Claude automatiskt (2026-10-28) | **Ja, genom ägarens Hermes på servern** | Varje nytt kvitto skickas till Anthropic utan ett tryck per kvitto, tillsammans med kontoplanen och de tidigare bokningar som liknar det. Tesseract på telefonen klarade inte vardagsfoton tillräckligt bra, och Claude läste fel på inget av de prövade. Hermes körs utan minne och utan verktyg utöver bildanalys, eftersom ett kvitto är text som någon annan skrivit. Inget blir bokfört av vakten (hård regel 10), och appen själv gör fortfarande inga externa anrop (hård regel 7) |
| Z | Föreningsprofil (2026-10-30) | **Två profiler på boken: enskild firma och ideell förening. Väljs när boken skapas och kan inte ändras. Generell för alla föreningar. Projekt per konteringsrad godkänt som funktion** | Profilen ligger i bokens egen databas och följer säkerhetskopian, så en återställd bok inte blir en firma av misstag. Den låses vid skapande eftersom konton, bokslut och rapporter skiljer sig så mycket att ett byte efteråt vore en migrering som rör bokförd data (hård regel 5). Moms är en inställning på föreningsprofilen och inte en spärr, eftersom en förening kan bli momsregistrerad. Hur projekt lagras är fortfarande öppet |
| AA | Projekt per konteringsrad (2026-10-30) | **Register med kod och namn, ett valfritt projekt per rad, rättbart efter bokföring** | Registret hindrar att "LEADER-28" och "Leader 28" blir två projekt i rapporten. Rättelsen följer 5 kap. 8 § BFL och rör inget belopp. Koden blir SIE-objektnumret (dimension 6). Projektet ligger i en ny tabell som, som de andra, är en vy av händelseloggen, så den kan byggas om. Kvittoassistenten sätter inget projekt, eftersom den inte kan veta det |

### Kvarstående

1. **Vilket år ska importen börja?** Hela historiken från det tidigare programmet, eller innevarande räkenskapsår plus ingående balanser?
2. **Riktiga notiser.** Räcker kalenderpåminnelser via `.ics`? Exporten finns sedan 2026-10-04 (Etapp 9), så frågan kan nu prövas i praktiken. Web Push kräver en pushserver. Sedan beslut W finns en server i drift, men PocketBase skickar inte push själv, så det vore en tjänst till på den.
3. **BAS-kontoplanen.** Villkoren för att distribuera kontoplanen i ett öppet repo behöver kontrolleras med BAS-intressenternas förening innan den paketeras. Efter beslut R bär appen ett femtiotal nummer och namn ur BAS K1 2018 som grundkonton.
4. ~~**Licens.**~~ Besvarad 2026-10-21: MIT. CC0 har en ansvarsfriskrivning men ingen patentlicens, och räknas därför inte som öppen källkod av alla. MIT är kort och vanlig för kod.
5. **Kan en nedladdning från den installerade PWA:n landa direkt i iCloud Drive** om Safaris förvalda nedladdningsmapp pekas dit under Inställningar, utan delningsarket i vägen? Skulle göra säkerhetskopian ett tryck snabbare, men går bara att testa på en riktig telefon — se Etapp 5.
6. **Riktig xlsx, eller räcker CSV?** Exporterna skriver CSV som öppnas rätt i ett svenskt Excel, och SIE finns för det en revisor faktiskt vill ha. En äkta `.xlsx` är ett zip-baserat format, och zip-skrivaren från Etapp 5:s arkivpaket finns redan — kvar är bara OOXML-delen. Fortfarande bara värt det om någon mottagare kräver formatet. *Rekommendation: avvakta tills det efterfrågas.*
7. **Kompletteringsregelns exakta årsräkning** (BFN K1, Etapp 7): att anskaffningsåret räknas som ett helt år oavsett när på året köpet skedde är väletablerad praxis, men gick inte att verifiera mot inkomstskattelagen 18 kap. 17 §:s lagtext direkt (skatteverket.se avvisade hämtning, lagen.nu för stor för hämtningsverktyget). Isolerad i en egen funktion (`kvarvarandeVardeEnligtKompletteringsregeln`) så den går att rätta utan att röra poolberäkningen om en djupare lagtextgenomgång skulle visa något annat.
8. ~~**Föreningsprofil.**~~ Besvarad 2026-10-22: ja, i samma kodbas och som en egen bok per förening (beslut V). Profilen bor på boken. Hur projekt lagras är fortfarande öppet — se Etapp 10.
9. ~~**Årsredovisningens tröskel för föreningar.**~~ Besvarad 2026-10-30: förenklat årsbokslut får upprättas när nettoomsättningen tillsammans med bidrag, gåvor, medlemsavgifter och liknande intäkter normalt är högst tre miljoner kronor och föreningen inte är skyldig att upprätta årsredovisning (6 kap. 3 § BFL, BFN:s vägledning till BFNAR 2010:1). Appen kontrollerar inte gränsen.
10. **INK3 för föreningar.** Skatteverket anger att en förening lämnar Inkomstdeklaration 3. Vilka uppgifter appen kan hjälpa till med, om några, är inte undersökt. Räkna inte med någon SRU-fil för föreningen.

---

## 10. Källor

- [Bokföringslag (1999:1078)](https://www.riksdagen.se/sv/dokument-och-lagar/dokument/svensk-forfattningssamling/bokforingslag-19991078_sfs-1999-1078/)
- [SFS 2024:342 — ändringar i bokföringslagens arkiveringsregler](https://svenskforfattningssamling.se/sites/default/files/sfs/2024-05/SFS2024-342.pdf)
- [BFN om den ändrade regeln för överföring av räkenskapsinformation](https://www.bfn.se/vad-innebar-den-andrade-regeln-om-overforing-av-rakenskapsinformation-i-bokforingslagen/)
- [BFNAR 2006:1 (K1) — vägledning](https://www.bfn.se/wp-content/uploads/vl06-1-k1enskilda-kons.pdf)
- [BFN: ändringar i K1 för enskilda näringsidkare](https://www.bfn.se/andringar-i-k1-for-enskilda-naringsidkare/)
- [Föreningen SIE-gruppen — formatspecifikationer](https://sie.se/format/)
- [BFNAR 2010:1 — ideella föreningar och registrerade trossamfund som upprättar förenklat årsbokslut](https://www.bfn.se/wp-content/uploads/2020/06/bfnar10-1-grund.pdf)
- [BFNAR 2024:6 — ändring i BFNAR 2010:1](https://bfn.se/wp-content/uploads/bfnar2024-6.pdf)
- [Skatteverket — bokföring och kassaregister för ideella föreningar](https://www.skatteverket.se/foretagochorganisationer/foreningar/ideellforening/bokforingsskyldighet.4.70ac421612e2a997f85800033022.html)
- [Skatteverket — moms för ideella föreningar](https://skatteverket.se/foreningar/driva/ideellforening/moms.4.18e1b10334ebe8bc80003909.html)
- [Skatteverket — deklarera och betala skatt i en ideell förening](https://www.skatteverket.se/foreningar/deklarera/deklareraochbetalaskattienideellforeningelleretttrossamfund.4.1927c51b15e7ee438721ff8.html)
- [Skatteverket — filöverföring av inkomstdeklaration (SRU)](https://www.skatteverket.se/foretag/etjansterochblanketter/allaetjanster/tjanster/filoverforing.4.1f604301062bf0c47e8000527.html)
- [Skatteverket — lämna momsdeklaration via fil (eSKD)](https://skatteverket.se/foretag/moms/deklareramoms/skapaochskickainmomsdeklarationviafil.4.2fb39afe18dabf1e4d223cc.html)
- [WebKit — Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/)
- [Yubico — Developers Guide to the WebAuthn PRF extension](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html)
