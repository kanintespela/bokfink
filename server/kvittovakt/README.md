# Kvittovakten

Kvitton som fotas i Bokfink blir utkast av sig själva. En timer på servern
letar varannan minut efter kvitton som inte hör till något verifikat eller
utkast, låter Claude läsa dem genom ägarens egen
[Hermes](https://github.com/NousResearch/hermes-agent) och lägger ett utkast,
kopplat till kvittot, under fliken Kvitton i appen. Ägaren granskar och
trycker Bokför. Vakten bokför aldrig något själv (hård regel 10).

Beslutet att kvitton skickas till Anthropic utan ett tryck per kvitto är
[beslut Y](../../docs/UTVECKLINGSPLAN.md#9-öppna-beslut).

## Så går det till

1. Vakten går igenom varje bok på synkservern, synkar den och hittar kvitton
   utan verifikat eller utkast, tillagda från startdagen i inställningarna.
   Ett kvitto hör till den bok som var öppen när det fotades, och läses som
   den bokens: en förenings kvitton med föreningens frågor och konton. Vilket
   slags bok det är, redovisningsmetoden och om boken är momsregistrerad läser
   vakten ur bokens beskrivning på servern ([beslut
   AE](../../docs/UTVECKLINGSPLAN.md#9-öppna-beslut)).
2. **Första frågan**, med bilden: leverantör, organisationsnummer, datum,
   betalt belopp, belopp exklusive moms och moms per momssats, avrundning.
   En PDF skickas som bild av de två första sidorna.
3. Bokfinks kod kontrollerar avläsningen: netto + moms + avrundning ska bli
   det betalda beloppet på öret, momsen ska vara 25, 12 eller 6 % av sitt
   netto och avrundningen under en krona.
4. **Andra frågan**, utan bild: avläsningen, kontoplanen och tidigare
   bokningar av samma leverantör (känd på organisationsnumret) eller samma
   slags köp. Svaret är en kontering.
5. Konteringen granskas som alla förslag från kvittoassistenten: kontona ska
   finnas och vara aktiva, verifikatet balansera, perioden vara öppen,
   datumet inte ligga framåt, och en rad ska vara exakt det betalda beloppet.
6. Utkastet sparas och kopplas till kvittot, och Hermes skickar ett
   meddelande med konteringen och motiveringen.

Hermes körs en fråga i taget, utan sitt minne och utan andra verktyg än att
titta på bilden. Ett kvitto är text som någon annan skrivit, och den som
läser det ska inte kunna köra kommandon.

Ett kvitto som inte går att läsa försöks två gånger. Sedan lämnas det åt
ägaren, med skälet i ett meddelande. Vad som har försökts sparas i
`~/.local/state/bokfink/kvittovakt.json`.

## Sätt upp

Kräver kvittoassistentens inställningsfil `~/.config/kontera/agent.json`
(se `.claude/skills/kvitto/SKILL.md`), med `url` till Bokfinks synkserver,
`http://127.0.0.1:8091` - inte någon annan PocketBase på samma maskin. Hermes
ska vara inloggad mot Anthropic, och ImageMagick och `pdftoppm`
(poppler-utils) installerade.

Vaktens egna inställningar, utan hemligheter, i
`~/.config/kontera/kvittovakt.json`:

```json
{
  "fran": "2026-10-28",
  "maxPerKorning": 3,
  "maxPerDygn": 20,
  "avisering": "discord:#bokforing",
  "foretag": "Anna Exempelsson",
  "bocker": {
    "01a18e57-0000-7000-8000-000000000001": {
      "foretag": "Exempelbygdens bygdegårdsförening",
      "fran": "2026-11-17"
    },
    "01a195e5-0000-7000-8000-000000000002": { "vakta": false }
  }
}
```

| Fält | Betyder |
|---|---|
| `fran` | Bara kvitton som lagts till från och med den dagen |
| `maxPerKorning` | Högst så många kvitton per körning, för alla böcker tillsammans (standard 3) |
| `maxPerDygn` | Högst så många försök per dygn, för alla böcker tillsammans (standard 20) |
| `avisering` | Vart Hermes skickar besked, som `hermes send --list` visar dem. Utelämnat: inga meddelanden. Med fler än en bok börjar varje besked med bokens namn |
| `foretag` | Firmans eller ägarens namn så som det står på fakturor till firman. Utan det kan assistenten inte skilja en leverantörs faktura från en firman skrivit. Gäller en enskild firmas bok som inte har ett eget under `bocker`; en förening kallas aldrig ägarens namn |
| `bocker` | Inställningar för enstaka böcker, efter bokens identitet. Den står längst ner under Mer, Böcker i appen när boken är öppen. En bok som inte nämns läses ändå |
| `bocker.<id>.foretag` | Bokens namn så som det står på fakturor till den, till exempel föreningens |
| `bocker.<id>.fran` | Egen startdag för den boken. Bra för en bok som läggs till senare, så att gamla okopplade kvitton i den inte läses |
| `bocker.<id>.vakta` | `false` lämnar boken utan vakt, till exempel en bok för att prova saker i |

Vakten läser inte en bok

- som inte har en beskrivning på servern än. Den skickas när boken öppnas i
  appen med synken på.
- som är låst med en annan lösenfras än den i `agent.json`.
- som är en momsregistrerad förening. Dess moms måste fördelas, och det är
  inte utrett, så dess kvitton bokförs för hand.

Ägaren får besked en gång när en bok hoppas över, och igen om skälet ändras.

Fälten `profil`, `redovisningsmetod` och `momsregistrerad` som äldre filer
har läses inte längre. Det boken själv säger gäller. Fältet `bok` i
`agent.json` styr inte vakten.

Bygg vakten till en fristående fil, prova, och slå på timern:

```sh
npm run agent -- las-nya --prova     # visar förslagen, skickar ingenting
mkdir -p ~/kontera-drift/bin
cp dist-agent/kontera-agent.mjs ~/kontera-drift/bin/
cp server/kvittovakt/bokfink-kvittovakt.* ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bokfink-kvittovakt.timer
```

Filen i `~/kontera-drift/bin` uppdateras inte av sig själv. Ändras
`src/agent/`, bygg och kopiera den igen.

## I vardagen

```sh
journalctl --user-unit bokfink-kvittovakt -n 40   # vad vakten har gjort
systemctl --user start bokfink-kvittovakt         # leta efter kvitton nu
systemctl --user stop bokfink-kvittovakt.timer    # pausa
```

Ett kvitto som vakten gett upp om läses igen om dess rad tas bort ur
`~/.local/state/bokfink/kvittovakt.json`.
