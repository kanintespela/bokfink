# Konteras synkserver

Kontera synkar mellan telefon och dator genom att byta händelseloggar över en
PocketBase-instans. Servern är en brevlåda: den lagrar händelser och lämnar
tillbaka dem i ankomstordning, utan att veta något om bokföring.

Med en lösenfras i appen krypteras allt innan det skickas, och servern kan
inte läsa bokföringen. Utan lösenfras, som är standard sedan
[beslut X](../../docs/UTVECKLINGSPLAN.md#9-öppna-beslut), kan den som kommer åt
servern läsa den.

Enligt [öppet beslut F](../../docs/UTVECKLINGSPLAN.md#9-öppna-beslut) körs en
**egen instans**, skild från andra tjänster på samma server, med eget schema
och egen säkerhetskopiering. Skälet är inte teknik utan spårbarhet: räkenskapsinformation
ska gå att lämna ut för sig den dag Skatteverket ber om den, och det är svårare
att förklara om den ligger blandad med ett annat projekts data.

## Vad som behövs

- PocketBase-binären, till exempel i `/opt/pocketbase`
- En egen datakatalog, en egen port och en egen tjänst
- Servern **inom EU**, och platsen anmäld till Skatteverket (bokföringslagen
  7 kap. om förvaring av räkenskapsinformation)

## Sätt upp

Kommandona nedan körs på servern. De skapar en instans på port 8091 som bara
lyssnar på loopback — den nås utifrån genom `tailscale serve`, aldrig direkt.

```sh
sudo mkdir -p /opt/kontera-pocketbase
sudo chown pi:pi /opt/kontera-pocketbase
cp /opt/pocketbase/pocketbase /opt/kontera-pocketbase/
cp -r pb_migrations /opt/kontera-pocketbase/
```

`pb_migrations/` är serverns schema. PocketBase kör det själv varje gång den
startar och hoppar över det som redan är gjort, så samlingarna behöver aldrig
skapas för hand. Där finns collection `handelser` med ett unikt index på
`op_id` — det är det indexet som gör synken idempotent — och collection
`filer` med ett unikt index på `sha256`. Användarens inloggning gäller i 30
dagar och förnyas vid varje synk, så det är hur länge en enhet får ligga
oanvänd innan den måste loggas in igen.

Skapa en administratör och starta instansen en första gång:

```sh
/opt/kontera-pocketbase/pocketbase superuser create DIN@EPOST hemligt-losenord \
  --dir=/opt/kontera-pocketbase/pb_data
/opt/kontera-pocketbase/pocketbase serve --http=127.0.0.1:8091 \
  --dir=/opt/kontera-pocketbase/pb_data \
  --migrationsDir=/opt/kontera-pocketbase/pb_migrations
```

Kör sedan `./skapa-anvandare.sh http://127.0.0.1:8091 DIN@EPOST hemligt-losenord`
i en annan terminal. Det skapar användaren som appen loggar in som.

## Som tjänst

`kontera-pocketbase.service` i den här katalogen är en systemd-enhet. Den
installeras med:

```sh
sudo cp kontera-pocketbase.service /etc/systemd/system/
sudo systemctl enable --now kontera-pocketbase
```

Och nås från telefonen genom tailnetet:

```sh
sudo tailscale serve --bg --https=8444 127.0.0.1:8091
```

Adressen blir då `https://<maskin>.<tailnet>.ts.net:8444`, som är den som
skrivs in i appen. Öppnas appen från samma maskin på port 8443, som i
[`server/app/`](../app/README.md), står adressen redan ifylld. `serve` är tailnet-only till skillnad från `funnel`, så
ingenting exponeras mot internet.

## Vad servern ser

En rad per händelse:

| Fält | Innehåll |
|---|---|
| `op_id` | Händelsens UUIDv7. Unikt index — en dubblett avvisas i stället för att skapa en kopia |
| `device` | Vilken enhet som skrev den |
| `payload` | Händelsen som JSON, eller krypterad med AES-GCM om enheten har en lösenfras. Servern har aldrig nyckeln |
| `created` | Serverns egen tidsstämpel, som är markören för inkrementell hämtning |

Och en rad per underlag:

| Fält | Innehåll |
|---|---|
| `sha256` | Filens innehållsadress. Unikt index — samma fil skickas aldrig två gånger |
| `data` | Filen som den är, eller krypterad med AES-GCM och med nonce först om enheten har en lösenfras |
| `created` | Serverns egen tidsstämpel |

Underlagen ligger i en egen collection eftersom de är olika saker: en händelse
är liten, spelas om och hämtas i ordning, medan en fil är megabyte som hämtas
en gång. Appen begär bara de adresser den saknar, och hashar det den får innan
det sparas — adressen är ett löfte om innehållet, och en kopia som inte håller
det är inget underlag (bokföringslagen 7 kap. 1 §).

Ingen domänlogik ligger på servern. Inga hooks räknar moms, validerar
verifikat eller delar ut verifikationsnummer — det är det som gör att den kan
bytas mot en dummare filhink utan att en enda regel går förlorad.

## Efter en omstart

Ingenting behöver göras. Tjänsten är aktiverad och startar med maskinen,
`tailscale serve --bg` minns sin inställning, och appen försöker själv igen
medan den är öppen: efter 15 sekunder, efter en minut och sedan var femte
minut tills servern svarar. Det som bokförts under tiden ligger i kön på
telefonen och går iväg vid första lyckade runda.

## Uppdatera schemat

När `pb_migrations/` har ändrats i repot:

```sh
cp pb_migrations/*.js /opt/kontera-pocketbase/pb_migrations/
sudo systemctl restart kontera-pocketbase
```

PocketBase kör de nya filerna när den startar. Kontrollera med
`journalctl -u kontera-pocketbase -n 20` att de kom med.

Det är det här appen ber om när den säger att servern inte tar emot så stora
händelser. Det första skriptet satte gränsen för en händelse till `0`, vilket
PocketBase läser som standardgränsen 5 000 tecken och inte som obegränsat.
Migreringen `…_payload_utan_tak.js` höjer den till 10 MB.

## Gå över till synk utan lösenfras

Det som redan ligger på servern är krypterat, och posterna där går inte att
ändra. En enhet utan lösenfras kan inte läsa dem, så servern töms och en enhet
som har hela bokföringen skickar den på nytt, okrypterad.

1. På en enhet med hela bokföringen och lösenfrasen, till exempel datorn:
   öppna **Synk**, tryck **Synka nu** och kontrollera att *Väntar på att
   skickas* säger **Ingenting**.
2. Ta en säkerhetskopia i appen.
3. Ta bort `losenfras` ur `~/.config/kontera/agent.json` om kvittoassistenten
   används.
4. Töm servern i adminvyn (`https://<maskin>.<tailnet>.ts.net:8444/_/`): för
   samlingarna `handelser` och `filer`, öppna samlingens inställningar och välj
   **Truncate**. Användarna rörs inte.
5. På samma enhet som i steg 1: **Ta bort lösenfrasen** under *Kryptering*,
   **Logga ut från servern** och logga in igen. Utloggningen köar hela loggen,
   så nästa runda skickar allt, okrypterat, med underlagen.
6. På de andra enheterna: **Ta bort lösenfrasen**. De hämtar det som kommer och
   hoppar över det de redan har.

Hoppas steg 4 över blir det en blandning på servern. Det som skickas efteråt
är läsbart för alla, men det gamla krypterade kräver fortfarande lösenfrasen,
och en ny enhet utan den får ett besked om det i stället för bokföringen.

## Säkerhetskopiering

PocketBase har inbyggd säkerhetskopiering i adminvyn. Den skyddar servern, inte
bokföringen: enheterna äger bokföringen och servern är en brevlåda. Det som
skyddar bokföringen är appens egen krypterade säkerhetskopia och arkivpaketet.

## Uppdatera PocketBase

Instansen har en egen kopia av programfilen i `/opt/kontera-pocketbase/`. Den
uppdateras alltså inte när programfilen i `/opt/pocketbase` byts, och tvärtom.
Kontrollera vilken version som körs:

```sh
/opt/kontera-pocketbase/pocketbase --version
```

Så uppdateras den:

1. Välj en dag långt från en momsdeklaration (se riskhanteringen i
   [utvecklingsplanen](../../docs/UTVECKLINGSPLAN.md)).
2. Ta en säkerhetskopia i adminvyn, eller stoppa tjänsten och kopiera
   `pb_data/`.
3. Prova den nya versionen mot en **kopia** av `pb_data/` på en annan port,
   och synka en testenhet mot den.
4. Stoppa tjänsten, byt programfilen och starta igen:
   `sudo systemctl restart kontera-pocketbase`.

Läs releaseanteckningarna före varje uppdatering. Version v0.40 byter
JSON-hanteringen och är enligt utvecklaren inte helt bakåtkompatibel.

### PocketBase flyttar från GitHub

Utvecklaren har meddelat att PocketBase flyttar från GitHub till en egen
plattform på `ganigeorgiev.com/pocketbase/pocketbase`
([meddelandet](https://github.com/pocketbase/pocketbase/discussions/7841),
2026-09-12, läst 2026-10-24).

**Läget 2026-10-24:** flytten har inte skett än. GitHub-repot är inte
arkiverat, och v0.40.6 släpptes där 2026-10-23. Adressformatet för
nedladdningar på den nya plattformen är inte publicerat.

Det här ändras:

- **Nya versioner** finns bara på den nya plattformen. Ingen spegel hålls
  på GitHub.
- **Gamla versioner** ligger kvar på GitHub, och länkarna dit fortsätter
  fungera.
- **Bevakningen flyttas inte.** Den som följer PocketBase på GitHub får
  ingen varning om säkerhetsluckor efter flytten. Bevakningen måste göras om
  på den nya plattformen.

Appen påverkas inte. Den använder PocketBases webb-API direkt, inte
JavaScript-biblioteket från npm, och ingenting i repot hämtar programfilen.

Så ser du om flytten har skett:

```sh
gh api repos/pocketbase/pocketbase -q .archived   # true = flyttat
```

När den har skett:

- [ ] Bevaka PocketBase på den nya plattformen.
- [ ] Fyll i adresserna nedan när utvecklaren har publicerat dem.
- [ ] Uppdatera *Läget* ovan.

| Vad | Adress |
|---|---|
| Projektsida | `https://ganigeorgiev.com/pocketbase/pocketbase` ⚠️ verifiera |
| Nedladdning av en version | ⚠️ [adressformat] |
| Kontrollsummor | ⚠️ [adress] |
| Releaselista i JSON eller RSS | ⚠️ [adress, om sådan finns] |
