# Appen i drift

Ett exempel på drift på en egen liten server, här en Raspberry Pi bakom
Tailscale. Servern serverar det bygge som CI har testat, inte ett den gör
själv. Varje push till `main` byggs och testas på GitHub, och bygget sparas
som paketet `kontera-dist`. En timer på servern tittar var femte minut efter
den senaste körningen där **alla** jobb blev gröna, och lägger det bygget i
drift. Appen på telefonen ser den nya versionen nästa gång den kommer till
förgrunden.

```
push till main → CI: verify, e2e, bygge → paket kontera-dist
                                              ↓  (var 5:e minut)
        Server: uppdatera.sh → ~/kontera-drift/releases/<commit>
                                ~/kontera-drift/current → den senaste
        Server: servera.mjs  → 127.0.0.1:4173 → tailscale serve :8443
```

Ett rött bygge kommer aldrig ut: versionen som redan ligger i drift fortsätter
att serveras. Utvecklingsmappen rörs inte — man kan arbeta, köra `npm ci` och
byta branch där utan att appen påverkas.

## Filer

| Fil | Gör |
|---|---|
| `servera.mjs` | Liten statisk server utan beroenden. Lyssnar bara på loopback; Tailscale står för HTTPS |
| `uppdatera.sh` | Hämtar senaste gröna bygget med `gh` och byter `current` i ett steg. Behåller de tre senaste |
| `kontera-app.service` | Kör servern som användartjänst |
| `kontera-uppdatera.service`, `.timer` | Kör `uppdatera.sh` två minuter efter start och sedan var femte minut |

## Sätt upp

Kräver `gh` inloggad som en användare som kan läsa repot.

```sh
mkdir -p ~/kontera-drift/bin
cp servera.mjs uppdatera.sh ~/kontera-drift/bin/
cp kontera-app.service kontera-uppdatera.service kontera-uppdatera.timer \
  ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user start kontera-uppdatera.service    # första bygget
systemctl --user enable --now kontera-app.service kontera-uppdatera.timer
```

Och nås från telefonen genom tailnetet, på samma adress som tidigare:

```sh
sudo tailscale serve --bg --https=8443 http://localhost:4173
```

Adressen får inte bytas. Appens data ligger i webbläsaren per adress, och en
ny adress är en tom app.

Skripten körs från `~/kontera-drift/bin`, inte från repot. Ändras de här måste
de kopieras dit igen.

## I vardagen

```sh
journalctl --user-unit kontera-uppdatera -n 20    # vad timern har gjort
systemctl --user start kontera-uppdatera         # leta efter nytt bygge nu
readlink ~/kontera-drift/current                 # vilken commit som är i drift
```

Gå tillbaka en version: peka om `current` till en av de andra mapparna i
`releases/`. Timern lägger tillbaka den senaste gröna vid nästa varv, så det
som ska bort för gott ska revertas på `main`.
