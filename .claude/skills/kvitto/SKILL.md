---
name: kvitto
description: Använd när ägaren skickar en bild eller PDF på ett kvitto eller en faktura och vill ha det bokfört i Kontera. Föreslår kontering ur bokföringen, och efter ett uttryckligt ja skickas ett utkast med underlaget till appen via synken. Bokför aldrig själv – ägaren trycker Bokför i appen.
---

# Kvitto till utkast i Kontera

Ägaren skickar ett foto eller en PDF i Claude-appen. Du föreslår hur det ska
bokföras, och när ägaren svarat ja skickar du ett **utkast** med underlaget
kopplat. Utkastet dyker upp under fliken Kvitton i appen, där ägaren granskar och
trycker Bokför. Verktyget kan inte bokföra, och det är avsiktligt (hård regel
10 i `CLAUDE.md`).

Svara kort, som i resten av projektet: förslaget, eventuella frågor, klart.

## 1. Hitta filen

Bifogade filer hamnar på disk i full upplösning:

```bash
ls -t ~/.claude/uploads/*/* | head -5
```

Läs den senaste med Read-verktyget. Är det flera kvitton i samma meddelande
blir det ett utkast per kvitto.

## 2. Läs bokföringen

Kör från repots rot. Det tar ett par sekunder, eftersom hela loggen hämtas
från synkservern varje gång.

```bash
npm run -s agent -- lage
npm run -s agent -- sok lantmannen
```

`lage` visar räkenskapsår och låsningar, svaren i appens frågor om vad som
hänt (med konto, moms och betalsätt enligt BAS K1), väntande utkast, de 40
senaste verifikaten och alla aktiva konton.

**Utgå från frågornas svar**, inte från hur det bokfördes förr. Sedan
2026-09-13 bokförs nya verifikat enligt BAS K1 (beslut R), så äldre verifikat
har ofta andra konton – 4010 i stället för 4000, 2640 i stället för 2641,
2013 för egna pengar i stället för 2017. `sok` är fortfarande bra för att se
vad en leverantör brukar sälja och vilken momssats kvittot har.

## 3. Föreslå

Skriv förslaget så att det går att svara ja på från telefonen:

> **Lantmännen 2026-09-04, 500,00 kr**
> 4000 Varor – debet 400,00
> 2641 Debiterad ingående moms – debet 100,00
> 2017 Egna insättningar – kredit 500,00 (betalt privat)
>
> Skicka som utkast?

Regler när du föreslår:

- **Belopp och moms tas från kvittot.** Står momsen specificerad, använd den i
  stället för att räkna 20 % av totalen. Flera momssatser på samma kvitto
  blir flera kostnadsrader och flera momsbelopp.
- **Betalsätt:** 2017 (egna pengar) är det vanligaste vid inköp, 1930 är
  företagskontot. Pengar in på ett privat konto är ett eget uttag, 2013. Syns det inte på kvittot vilket kort som användes: fråga.
- **Bara konton som finns i `lage`.** Behövs ett nytt konto, be ägaren lägga
  upp det i appen först.
- **Gissa aldrig på regelverket.** Fråga i stället vid representation,
  inköp från utlandet eller EU (omvänd skattskyldighet), privat andel,
  bilkostnader, gåvor, och inventarier som kan vara anläggningstillgångar.
- Utkastet får inte hamna i en momslåst period eller ett avslutat år –
  verktyget vägrar, men säg det hellre i förslaget.

## 4. Skicka efter ja

Bara efter ett uttryckligt ja på just det förslaget. Skriv förslaget som JSON i
scratchpad-katalogen:

```json
{
  "datum": "2026-09-04",
  "beskrivning": "Foder, Lantmännen",
  "konteringar": [
    { "konto": "4000", "belopp": "400,00" },
    { "konto": "2641", "belopp": "100,00" },
    { "konto": "2017", "belopp": "-500,00" }
  ],
  "underlag": ["/home/pi/.claude/uploads/.../photo.jpeg"]
}
```

Belopp är **strängar** i kronor, positivt för debet och negativt för kredit.
Tal avvisas, eftersom JSON-tal är flyttal (hård regel 1).

```bash
npm run -s agent -- utkast --prova /sökväg/till/forslag.json
npm run -s agent -- utkast /sökväg/till/forslag.json
```

`--prova` kontrollerar allt och skickar ingenting. Visar den en varning om ett
bokfört verifikat med samma datum och belopp: fråga innan du skickar. Svara
sedan med en rad om att utkastet ligger under fliken Kvitton.

Bilder konverteras till JPEG med längsta sida 2000 px, precis som appens
kamera gör, och platsinformation i EXIF tas bort. PDF:er skickas oförändrade.

## Om något blir fel

- **Fel i ett utkast som redan skickats:** be ägaren trycka *Ta bort
  förslaget* i appen. Kvittot hamnar då bland kvitton som väntar. Skicka sedan
  ett nytt förslag med samma fil – verktyget vägrar skicka ett kvitto som
  redan hör till ett utkast eller verifikat.
- **"Hittar ingen inställningsfil":** se nedan.
- **"Fel e-postadress eller lösenord":** appen och verktyget loggar in mot
  `users`, inte mot `_superusers`, även om e-postadressen kan vara densamma.
- **Utkastet syns inte i appen:** telefonen måste ha synkat, och appen måste
  vara uppdaterad till en version med utkastskärmen (uppdateringsbannern).

## Inställningsfilen

`~/.config/kontera/agent.json`, skriven av ägaren själv. Skriv aldrig in
lösenord eller lösenfras åt ägaren – ge kommandot och låt ägaren fylla i.

```json
{
  "url": "http://127.0.0.1:8091",
  "epost": "samma konto som appen loggar in med",
  "losenord": "...",
  "losenfras": "samma lösenfras som i appen, eller utelämnad"
}
```

`url` ska vara Bokfinks egen synkserver, på samma maskin `http://127.0.0.1:8091`.
Maskinen kör fler PocketBase-instanser, och fram till 2026-10-28 pekade filen
på en annan av dem, där bara en gammal kopia av bokföringen fanns.

`losenfras` ska bara finnas om appen synkar med lösenfras. Utan den skickas
utkasten okrypterade, som från en enhet utan lösenfras. Står den kvar när
appen synkar utan lösenfras skickas utkasten krypterade, och en telefon utan
lösenfras kan då inte läsa dem.

Filen måste ha rättigheterna 600, annars vägrar verktyget att läsa den:

```bash
chmod 600 ~/.config/kontera/agent.json
```

Den som kommer åt maskinen kan läsa bokföringen, med eller utan lösenfras i
filen: den ligger på samma maskin som synkservern. Det är ett medvetet
beslut, se beslut N och X i `docs/UTVECKLINGSPLAN.md`.
