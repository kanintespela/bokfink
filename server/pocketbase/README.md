# Konteras synkserver

Kontera synkar mellan telefon och dator genom att byta krypterade
händelseloggar över en PocketBase-instans. Servern är en brevlåda: den lagrar
kuvert, lämnar tillbaka dem i ankomstordning och kan aldrig läsa bokföringen.

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
```

Skapa en administratör och starta instansen en första gång:

```sh
/opt/kontera-pocketbase/pocketbase superuser create DIN@EPOST hemligt-losenord \
  --dir=/opt/kontera-pocketbase/pb_data
/opt/kontera-pocketbase/pocketbase serve --http=127.0.0.1:8091 \
  --dir=/opt/kontera-pocketbase/pb_data
```

Kör sedan `./skapa-collections.sh http://127.0.0.1:8091 DIN@EPOST hemligt-losenord`
i en annan terminal. Skriptet lägger upp collection `handelser` med ett unikt
index på `op_id` — det är det indexet som gör synken idempotent — collection
`filer` med ett unikt index på `sha256`, och appens användare. Användarens inloggning
gäller i 30 dagar och förnyas vid varje synk, så det är hur länge en enhet får
ligga oanvänd innan den måste loggas in igen.

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
skrivs in i appen. `serve` är tailnet-only till skillnad från `funnel`, så
ingenting exponeras mot internet.

## Vad servern ser

En rad per händelse:

| Fält | Innehåll |
|---|---|
| `op_id` | Händelsens UUIDv7. Unikt index — en dubblett avvisas i stället för att skapa en kopia |
| `device` | Vilken enhet som skrev den |
| `payload` | Händelsen, krypterad med AES-GCM. Servern har ingen nyckel |
| `created` | Serverns egen tidsstämpel, som är markören för inkrementell hämtning |

Och en rad per underlag:

| Fält | Innehåll |
|---|---|
| `sha256` | Filens innehållsadress. Unikt index — samma fil skickas aldrig två gånger |
| `data` | Filen, krypterad med AES-GCM och med nonce först. Servern har ingen nyckel |
| `created` | Serverns egen tidsstämpel |

Underlagen ligger i en egen collection eftersom de är olika saker: en händelse
är liten, spelas om och hämtas i ordning, medan en fil är megabyte som hämtas
en gång. Appen begär bara de adresser den saknar, och hashar det den får innan
det sparas — adressen är ett löfte om innehållet, och en kopia som inte håller
det är inget underlag (bokföringslagen 7 kap. 1 §).

Ingen domänlogik ligger på servern. Inga hooks räknar moms, validerar
verifikat eller delar ut verifikationsnummer — det är det som gör att den kan
bytas mot en dummare filhink utan att en enda regel går förlorad.

## Säkerhetskopiering

PocketBase har inbyggd säkerhetskopiering i adminvyn. Den skyddar servern, inte
bokföringen: enheterna äger bokföringen och servern är en brevlåda. Det som
skyddar bokföringen är appens egen krypterade säkerhetskopia och arkivpaketet.
