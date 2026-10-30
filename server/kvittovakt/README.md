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

1. Vakten synkar och hittar kvitton utan verifikat eller utkast, tillagda
   från startdagen i inställningarna.
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
  "redovisningsmetod": "kontantmetoden"
}
```

| Fält | Betyder |
|---|---|
| `fran` | Bara kvitton som lagts till från och med den dagen |
| `maxPerKorning` | Högst så många kvitton per körning (standard 3) |
| `maxPerDygn` | Högst så många försök per dygn (standard 20) |
| `avisering` | Vart Hermes skickar besked, som `hermes send --list` visar dem. Utelämnat: inga meddelanden |
| `foretag` | Firmans eller ägarens namn så som det står på fakturor till firman. Utan det kan assistenten inte skilja en leverantörs faktura från en firman skrivit |
| `redovisningsmetod` | `kontantmetoden` (standard) eller `faktureringsmetoden`. Med kontantmetoden dateras en faktura med dagen den fotades, som antas vara betalningsdagen, och kundfordringar och leverantörsskulder används inte |
| `profil` | `enskild_firma` (standard) eller `forening`. Vilken sorts bok vakten är kopplad till. Profilen ligger i bokens egna inställningar, som synkloggen inte för med sig, så vakten kan inte läsa den själv och får veta den här. En förening får föreningens frågor och konton, och ingen momsrad |
| `momsregistrerad` | Bara för en förening: `false` (standard). `true` stöds inte ännu, och vakten vägrar starta, eftersom en momsregistrerad förenings moms måste fördelas och det inte är utrett. En enskild firma har alltid moms |

En vakt hör till en bok och ett synkkonto, så en förening som synkar mot sitt
eget konto får sin egen `kvittovakt.json` med `"profil": "forening"`. Två
böcker får inte synka mot samma konto.

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
