# Villa a Colico

Repo con due parti indipendenti, pensate per essere pubblicate come **due servizi separati su Railway dallo stesso repository GitHub**:

- `sito-web/` — il sito pubblico (pagina, calendario, form di prenotazione) con SEO di base già impostata
- `backend/` — il server Node.js che gestisce i pagamenti con carta (Stripe Checkout), le email automatiche e i rimborsi

## 1. Caricare il repo su GitHub

Dalla cartella di questo repo (dopo averlo scaricato ed estratto):

```bash
git init
git add .
git commit -m "Primo commit: sito e backend Villa a Colico"
```

Poi crea un repository vuoto su GitHub (github.com → New repository, senza README/licenza) e collegalo:

```bash
git remote add origin https://github.com/TUO-UTENTE/villa-colico.git
git branch -M main
git push -u origin main
```

Se usi la Github CLI puoi anche creare il repo direttamente da terminale:
```bash
gh repo create villa-colico --private --source=. --remote=origin --push
```

## 2. Pubblicare su Railway

Railway supporta i **monorepo**: dallo stesso repository puoi creare due servizi distinti, ciascuno con la propria "root directory". Non serve duplicare il repo.

### Servizio 1 — backend (pagamenti)
1. Railway → New Project → Deploy from GitHub repo → seleziona `villa-colico`
2. Nelle impostazioni del servizio, imposta **Root Directory**: `backend`
3. Railway rileva `package.json` ed esegue `npm start` in automatico
4. In **Variables**, aggiungi le variabili da `backend/.env.example` (in particolare `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL`, `ADMIN_KEY`, e se vuoi le email `RESEND_API_KEY`/`OWNER_EMAIL`)
5. Railway assegna un dominio tipo `villa-colico-backend-production.up.railway.app` — usalo come URL del backend

### Servizio 2 — sito pubblico
1. Nello stesso progetto Railway, Add Service → Deploy from GitHub repo → stesso repository `villa-colico`
2. Root Directory: `sito-web`
3. Railway rileva `package.json` ed esegue `npm start`
4. Railway assegna un altro dominio, es. `villa-colico-production.up.railway.app` — puoi poi collegare il tuo dominio personale da Settings → Domains

### Collegare i due servizi
Dopo il deploy di entrambi:
- nel servizio **backend**, imposta `FRONTEND_URL` con il dominio del sito pubblico (serve per i redirect dopo il pagamento Stripe)
- nel sito pubblico, apri il tab **Gestione** (richiede il PIN impostato, default `1234` — cambialo) e inserisci in "URL backend pagamenti" il dominio del servizio backend, per attivare il pulsante "Rimborsa"

## Struttura

```
villa-colico/
├── sito-web/           → servizio Railway "sito"
│   ├── index.html
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── server.js       → piccolo server statico (Railway esegue processi, non file nudi)
│   └── package.json
└── backend/             → servizio Railway "backend"
    ├── server.js
    ├── package.json
    ├── .env.example
    └── README.md        → dettagli su Stripe, webhook, email, rimborsi
```

## Prima di andare online

- In `sito-web/index.html`, sostituisci `SOSTITUISCI-CON-IL-TUO-DOMINIO.com` con il dominio reale, e i paragrafi segnaposto con testi veri
- Sostituisci i riquadri della galleria (attualmente grafici, senza foto) con fotografie reali della villa, senza filigrane di terzi
- Segui `backend/README.md` per Stripe, il webhook e le email automatiche
