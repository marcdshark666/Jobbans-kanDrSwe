# Läkarjobb Sweeper

En webapp som samlar jobb för:

- underläkare
- BT-läkare / bastjänstgöringsläkare
- legitimerad läkare
- specialister / specialistläkare

Appen hämtar jobb från flera källor och visar dem i separata kategorier. Den innehåller även:

- snabbmall för `Stockholm`
- snabbmall för `Hela Sverige`
- auto-refresh var 30:e minut
- manuell knapp för att hämta om jobb direkt
- markering av dubbletter
- bokmärken / favoriter som sparas i webbläsaren
- statusflöde för `Sökt`, `Intervju` och `Avböjt`

## Källor i första versionen

- Capio
- Meliva
- Kry
- Praktikertjänst
- Region Stockholm
- Stockholms läns sjukvårdsområde
- Södersjukhuset
- Arbetsförmedlingen
- Internetmedicin Jobb
- Vakanser.se
- Varbi
- LinkedIn

Observera att publika jobbsidor ändrar HTML då och då. Om en källa ändrar struktur kan just den parsern behöva finjusteras senare.

## Starta lokalt

1. Installera beroenden:

```powershell
npm install
```

2. Starta servern:

```powershell
npm start
```

3. Öppna:

```text
http://localhost:3000
```

## Projektstruktur

- `server.js` serverar sidan och kör uppdateringar var 30:e minut
- `src/lib/job-sources.js` hämtar och filtrerar jobb från källorna
- `src/lib/job-utils.js` innehåller kategorisering, ortmatchning och dubblettlogik
- `public/` innehåller gränssnittet

## GitHub

Om du vill koppla detta till ditt repo:

```powershell
git init
git branch -M main
git remote add origin https://github.com/marcdshark666/Jobbans-kanDrSwe.git
git add .
git commit -m "Build doctor job aggregation website"
git push -u origin main
```

## Viktig notering

Den här lösningen är byggd som en Node-app, inte som en ren GitHub Pages-sida. Det är medvetet, eftersom manuell refresh och server-side hämtning från många källor fungerar bäst med en backend.
