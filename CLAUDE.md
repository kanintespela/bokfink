# CLAUDE.md

Instruktioner för AI-assistenter och människor som arbetar i det här repot. Läs hela filen innan du ändrar något.

## Projektet i en mening

Kontera är en local-first PWA för bokföring i svensk enskild firma: all data på användarens enhet, inga serverberoenden, öppna exportformat, och bokföringsreglerna implementerade i koden.

Projektet drivs av **en person med AI-assistans**. Det betyder att koden ska vara skriven för att kunna granskas snabbt av en trött människa på en telefon, och att en AI ska kunna göra rätt utan att fråga om trivialiteter — men fråga om allt som rör tolkning av regelverk.

## Arbetsflöde

- **Atomära commits direkt till `main`.** Inga feature-branches.
- En commit = **en logisk, komplett och fungerande ändring**. Aldrig "trasigt nu, fixas i nästa commit".
- `main` ska vara grön i varje commit. Kör `npm run verify` innan du committar.
- Dela upp stora ändringar i flera commits i rätt ordning: datamodell → domänlogik → UI → dokumentation.
- Refaktorering och funktionsändring blandas aldrig i samma commit.
- Uppdatera `docs/UTVECKLINGSPLAN.md` i samma commit som du slutför en punkt i den.

### Commit-meddelanden

Conventional Commits, på engelska, imperativ form:

```
feat(vat): calculate reverse charge VAT for EU purchases
fix(ledger): reject verifications with unbalanced foreign currency rows
refactor(sie): extract PC8 encoder from the writer
docs(plan): mark stage 2 as complete
```

Scope är funktionsområdet: `ledger`, `accounts`, `vat`, `assets`, `inventory`, `invoice`, `receipt`, `ocr`, `sie`, `sru`, `report`, `backup`, `auth`, `pwa`, `ui`, `plan`.

Motivera i brödtexten *varför*, inte *vad* — diffen visar redan vad. Nya runtime-beroenden motiveras alltid, med licens.

### Undantag för webbsessioner

Sessioner som körs via Claude Code på webben kan vara tvingade till en egen branch och pull request. Det ändrar inte kravet på atomära commits — behåll dem och merga snabbt till `main`.

**Du får merga dina egna PR:er utan att fråga.** Projektägaren har gett stående tillstånd. Vi förlitar oss på git-historiken för att kunna backa, inte på granskning före merge — det är det som håller utvecklingstakten uppe i ett enmansprojekt. Merga med vanlig merge, inte squash: de atomära commitsen är hela poängen och ska finnas kvar i historiken på `main`.

Vänta på grön CI innan du mergar. Det är den enda spärren vi har, och den ersätter granskningen.

### Sessioner i en git-worktree

En worktree kan inte ha `main` utcheckad — huvudrepot har den — så sessionen
hamnar på en egen `claude/*`-branch vare sig den vill eller inte. Den branchen
är ett arbetsbord, inte ett mål: den har ingen upstream, syns inte på GitHub,
och `main` hinner gå vidare medan du jobbar.

**Börja med att hämta:** `git fetch origin` och utgå från `origin/main`. Basen
är annars så gammal som förra gången någon session rörde den här worktreen.

**Avsluta med att landa arbetet.** När `npm run verify` är grönt:

```sh
git fetch origin
git rebase origin/main
npm run verify        # igen, på kombinationen — det är den som ska bli main
git push origin HEAD:main
```

Rebasen är tillåten just här: branchen är opublicerad, så ingen historik som
nått `main` skrivs om. Blir det konflikt, lös den i rebasen — slå aldrig ihop
två commits till en för att slippa den.

**Lämna aldrig en avslutad session med opushade commits.** Arbetet finns då
bara på den här maskinen, i en katalog som nästa städning kan ta bort, och
nästa session bygger vidare på en `main` som saknar det. Om något hindrar
pushen: säg det uttryckligen i svaret i stället för att låta det se klart ut.

### Att backa när något blir fel

- **`git revert <sha>`** skapar en ny commit som ångrar en gammal. Historien skrivs aldrig om, och en revert kan i sin tur revertas. Detta är standardvägen och den enda som är säker efter att något nått `main`.
- **Tagga varje avslutad etapp** (`git tag etapp-1 && git push origin etapp-1`). Då finns det alltid en känd fungerande punkt att jämföra mot eller checka ut. Webbsessioner kan inte pusha taggar — miljöns git-relä släpper bara igenom branchar — så taggen får sättas lokalt eller som en release i GitHubs gränssnitt. Merge-commiten för etappen duger som referens under tiden.
- **Tagga före varje schemamigrering** som rör riktig bokföring. En migrering som gick fel är svårare att backa än kod.
- Skriv aldrig om historik på `main`. Inga rebase, inga amend, inga force-push.

## Språk

| Var | Språk |
|---|---|
| Gränssnittstext, felmeddelanden till användare | Svenska |
| Dokumentation (`README.md`, `docs/`) | Svenska |
| Kod, identifierare, kodkommentarer | Engelska |
| Commit-meddelanden, PR-texter | Engelska |

**Undantag:** juridiskt definierade domäntermer behåller sina svenska namn i koden, eftersom en översättning riskerar att bli subtilt fel. Skriv dem utan diakriter i identifierare (`rakenskapsar`, inte `räkenskapsår`).

### Ordlista

| Domänterm (kod) | Betydelse | Engelsk term som **inte** ska användas |
|---|---|---|
| `Verifikat` | En bokförd affärshändelse med minst två konteringsrader | `Transaction`, `JournalEntry` |
| `Kontering` | En rad i ett verifikat: konto, belopp, debet/kredit | `Posting`, `Line` |
| `Konto` | Ett BAS-konto | `Account` |
| `Verifikatserie` | Nummerserie, t.ex. `A`, `B` | `Series` |
| `Rakenskapsar` | Räkenskapsår med start-, slutdatum och status | `FiscalYear` |
| `Moms` | Mervärdesskatt | `VAT` (tillåtet i UI-nära kod och filformat) |
| `Momskod` | Kod som styr momssats och deklarationsruta | — |
| `Underlag` | Kvitto, faktura eller annat bevis kopplat till ett verifikat | `Attachment`, `Document` |
| `Anlaggningstillgang` | Post i anläggningsregistret | `Asset` |
| `Ore` | Belopp i heltal öre | `Amount`, `Money` |

## Hårda regler

Dessa får aldrig brytas. Om en uppgift verkar kräva att en av dem bryts: stanna och fråga.

1. **Pengar är heltal i öre.** Typen `Ore` (branded `number`). Inga flyttal, någonstans, i något led. Ett belopp som passerar en `float` är en bugg även om testet råkar gå igenom.
2. **Avrundning är explicit.** Varje ställe som avrundar har en namngiven funktion, en kommentar om vilken regel som gäller, och ett test med gränsfall.
3. **Datum är `YYYY-MM-DD`-strängar** i domänlagret, tolkade i `Europe/Stockholm`. Ingen `new Date()` eller `Date.now()` i `src/domain/` — klockan injiceras som beroende så att tester är deterministiska.
4. **Debet = kredit.** Ett verifikat som inte balanserar kan inte bokföras. Valideringen ligger i domänen, inte i formuläret.
5. **En bokförd kontering är oföränderlig.** Ingen kod får ändra belopp, konton, serie eller nummer på ett bokfört verifikat, och inget bokfört verifikat får raderas. Fel i konteringen rättas med en annullering som pekar på originalet. (Bokföringslagen 5 kap. 5 §: en rättelse genom särskild rättelsepost ska gå att få kännedom om vid granskning.)

   **Beskrivning, datum och projekt på en rad får rättas.** 5 kap. 8 § tillåter det uttryckligen — "Om en verifikation rättas, skall det anges när rättelsen har skett och vem som har gjort den" — så en rättelse skrivs som en egen händelse (`verifikat.rattat`), originalvärdet blir kvar på verifikatet, och loggposten bär när och vem. Ett datum får inte lämna räkenskapsåret eller korsa en inlämnad momsdeklaration, åt något håll. Ett projekt på en rad rättas med radens nummer, vad den hade och vad den har nu; det flyttar inget belopp och inget konto (beslut AA).

   Regeln var tidigare skriven som "bokförda verifikat är oföränderliga" med 5 kap. 5 § som källa. Den paragrafen säger inte det: den tillåter rättelse och ställer villkor för den. Övertolkningen upptäcktes 2026-09-17.
6. **Verifikationsnummer är en obruten serie** per verifikatserie och räkenskapsår, tilldelad vid bokföring, aldrig återanvänd, aldrig omnumrerad.
7. **Ingen nätverkstrafik i drift.** Inga CDN, ingen telemetri, inga externa API:er, inga webbtypsnitt från nätet. Allt paketeras med appen. Undantag kräver ett beslut i `docs/UTVECKLINGSPLAN.md`.
8. **Ingen destruktiv datamigrering utan verifierad backup.** Schemamigrationer tar en säkerhetskopia först och ska gå att avbryta utan dataförlust.
9. **Regler har källhänvisning.** All logik som härrör ur lag, allmänt råd eller Skatteverkets föreskrift har en kommentar med källan:
   ```ts
   // BFNAR 2006:1 punkt 6.32: om avskrivningsunderlaget är högst ett halvt
   // prisbasbelopp får hela underlaget skrivas av på en gång.
   ```
10. **Automatik föreslår, användaren bokför.** OCR, konteringsmallar och bankimport fyller i ett formulär som användaren granskar och godkänner. Ingenting bokförs utan ett aktivt val.
11. **Inga tysta fel.** Ett fel i en beräkning ska synas i gränssnittet, inte loggas och sväljas.

## Arkitektur

```
src/domain/     ren TypeScript: bokföring, moms, avskrivningar, rapporter
src/data/       Dexie/IndexedDB, repositories, schemamigrationer
src/features/   UI per funktionsområde (verifikat, moms, fakturor, ...)
src/ui/         delade komponenter och layout
src/platform/   kamera, delning, WebAuthn, fil-I/O, notiser — tunna, mockbara omslag
src/agent/      kommandoradsenhet för kvittoassistenten, körs i Node på en egen server (beslut N)
```

Beroenderiktning: `features` → `domain`, `features` → `data`, `data` → `domain`. `agent` är en andra ingång bredvid `features` och får använda `domain`, `data` och `platform`, men aldrig tvärtom.

**`src/domain/` får inte importera från något annat lager**, inte från React, Dexie eller webbläsar-API:er. Den ska gå att köra i Node utan DOM. Detta är gränsen som gör bokföringslogiken testbar och långlivad — bevaka den.

Plattformsberoenden isoleras i `src/platform/` bakom egna gränssnitt, så att iOS-specifika begränsningar kan hanteras på ett ställe och testerna kan köras utan enhet.

## Tester

- **Domänlogik kräver test.** Ny beräkning utan test committas inte.
- **Invarianter testas med property-based-tester** (fast-check): summan av alla konteringar i ett verifikat är alltid noll; balansräkningen balanserar för varje genererad bokföringshistorik; ett SIE-export/import-varv ger identisk data.
- **Filformat testas mot golden files.** SIE, SRU och eSKD har inspelade referensfiler i `src/domain/**/__fixtures__/`. Ändras en fil ska diffen förklaras i commit-meddelandet.
- **Rapporter testas mot exempelbokföringar** med handräknat facit.
- **UI-tester** (Playwright) för de kritiska flödena: registrera utgift, registrera inkomst, skapa faktura, momsrapport, backup och återställning.
- **Varje buggfix börjar med ett test som faller.** Skriv testet, se det fallera, fixa sedan.

## Definition of done

Innan du committar:

- [ ] `npm run verify` är grönt (typkontroll, lint, tester)
- [ ] Ny domänlogik har tester, inklusive gränsfall (noll, negativa belopp, öresavrundning, årsskifte)
- [ ] Regelhärledd logik har källhänvisning i kommentar
- [ ] Inga belopp har passerat ett flyttal
- [ ] Gränssnittstexten är på svenska och begriplig för någon som inte kan bokföring
- [ ] Fungerar offline och på skärmbredd 375 px, med tumvänliga klickytor
- [ ] Utvecklingsplanen är uppdaterad om en punkt blev klar
- [ ] Ingen ny data lämnar enheten

## Kommandon

| Kommando | Gör |
|---|---|
| `npm run dev` | Utvecklingsserver |
| `npm run verify` | Typkontroll + lint + tester. Kör före varje commit |
| `npm test` | Enhetstester i watch-läge |
| `npm run test:e2e` | Playwright-tester mot ett produktionsbygge |
| `npm run build` | Produktionsbygge |
| `npm run preview` | Servera bygget lokalt, för test på telefon i samma nät |

Om miljön har en förinstallerad Chromium som inte matchar Playwrights pinnade version, peka på den i stället för att ladda ner en ny:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/sökväg/till/chrome npm run test:e2e
```

## Beroenden

- Tillåtna licenser: MIT, Apache-2.0, BSD, ISC, CC0, Unlicense. Copyleft (GPL/AGPL) endast för verktyg som inte länkas in i bygget.
- Föredra inget beroende framför ett litet, och ett litet framför ett stort. Ett beroende som gör en sak vi kan skriva på 50 rader skriver vi själva.
- Allt paketeras lokalt. Inget hämtas från CDN i drift.
- Nya beroenden motiveras i commit-meddelandet med storlek, licens och varför alternativen valdes bort.

## Fråga mig i stället för att gissa

Stanna och fråga när:

- tolkningen av en skatte- eller bokföringsregel inte är entydig i källorna — **gissa aldrig på regelverk**
- ett val låser datamodellen eller kräver migrering av befintlig bokföring
- något skulle skicka data utanför enheten
- något skulle ändra eller radera redan bokförd data
- en funktion visar sig omöjlig i en PWA på iOS och kräver ett annat angreppssätt
- ett nytt runtime-beroende är stort eller har oklar licens

Det är alltid billigare att fråga än att bygga en felaktig momsberäkning som upptäcks vid deklarationen.

## Att göra rätt när något är svårt

Om en beräkning är komplicerad: skriv först ett test med handräknat facit och en kommentar som visar uträkningen. Då blir det uppenbart både för dig och för granskaren om koden gör rätt sak.

Om regelverket har flera tillåtna metoder (t.ex. huvudregel och kompletteringsregel för avskrivning): implementera båda, gör valet till en inställning, och räkna ut båda så att användaren kan se skillnaden.
