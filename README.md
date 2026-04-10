# 🏥 LäkarJobb — Sveriges Läkarjobb-portal

En komplett jobbportal för läkare i Sverige. Hämtar annonser automatiskt var 30:e minut från 12+ jobbkällor och visar dem kategoriserade per läkartyp.

## 🌐 Se sidan live
**https://marcdshark666.github.io/Jobbans-kanDrSwe/**

---

## ✨ Funktioner

| Funktion | Beskrivning |
|---|---|
| **4 läkarkategorier** | Underläkare, BT-läkare, Legitimerad läk., Specialistläkare |
| **Regionfilter** | Stockholm / Hela Sverige |
| **Källfilter** | Välj vilka jobbkällor att visa |
| **Manuell refresh** | Knapp för att hämta nya jobb direkt |
| **Auto-refresh** | Uppdateras automatiskt var 30:e minut |
| **Bokmärken ⭐** | Spara favoriter lokalt i webbläsaren |
| **Sökt 📨** | Markera annonser du sökt |
| **Intervju 🎯** | Markera annonser du fått intervju för |
| **Avböjt ❌** | Markera annonser du fått avslag från |
| **Dubblettvarning** | Visar om en annons redan publicerats på annan källa |
| **Sökfunktion** | Sök via titel, plats eller källa |
| **Grid/Lista-vy** | Välj hur jobben visas |

## 📰 Jobbkällor

- **Jobtech/Platsbanken** (Arbetsförmedlingens öppna API)
- **Capio**
- **Meliva**
- **Kry**
- **Praktikertjänst**
- **Region Stockholm**
- **Södersjukhuset**
- **Arbetsförmedlingen**
- **Internetmedicin**
- **Vakanser.se**
- **Varbi.se**
- **LinkedIn**
- **SLSO** (Stockholms Läns Sjukvårdsområde)

## 🚀 Kör lokalt

```bash
# Klona repot
git clone https://github.com/marcdshark666/Jobbans-kanDrSwe.git
cd Jobbans-kanDrSwe

# Installera
npm install

# Bygg initial cache (hämtar jobb från alla källor)
node scripts/build-cache.js

# Starta servern
npm start
# Öppna http://localhost:3000
```

## 📁 Projektstruktur

```
├── public/
│   ├── index.html       # Huvud-HTML
│   ├── styles.css       # Futuristisk CSS
│   └── app.js           # Frontend-logik
├── scripts/
│   └── build-cache.js   # Jobbinsamlare (alla källorna)
├── data/
│   └── jobs-cache.json  # Genererad jobbcache
├── .github/
│   └── workflows/
│       ├── deploy-pages.yml    # Publicerar till GitHub Pages
│       └── refresh-cache.yml  # Uppdaterar cache var 30:e min
├── server.js            # Express backend (för lokal körning)
└── package.json
```

## 📋 GitHub Actions

Två automatiska flöden:
1. **Deploy Pages** — Publicerar sidan när du pushar till `main`
2. **Refresh Cache** — Hämtar nya jobb var 30:e minut (kräver att GitHub Pages är konfigurerat med Actions-source)

## ⚙️ GitHub Pages-inställningar

1. Gå till **Settings → Pages**
2. Välj **Source: GitHub Actions**
3. Spara

---

*Skapad 2026 — LäkarJobb Portal*
