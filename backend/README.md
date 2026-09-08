# Backend pagamenti — Villa a Colico

Piccolo server Node.js/Express che gestisce le prenotazioni e i pagamenti reali con carta tramite **Stripe Checkout**. Sostituisce la parte "bonifico/PayPal/contanti" con un pagamento con carta vero, gestito da Stripe (che si occupa di sicurezza, dati della carta, ecc. — questo server non tocca mai i numeri di carta).

## Cosa serve prima di iniziare

1. Un account Stripe (gratuito): https://dashboard.stripe.com/register — richiede i dati della tua attività per poter incassare davvero.
2. Node.js 18+ installato, oppure un servizio di hosting che lo fornisce (vedi sotto).

## Installazione in locale

```bash
cd villa-colico-backend
npm install
cp .env.example .env
```

Apri `.env` e inserisci:
- `STRIPE_SECRET_KEY`: da Dashboard Stripe → Sviluppatori → Chiavi API (usa quella "test" per le prove).
- `FRONTEND_URL`: l'indirizzo del tuo sito con la pagina di prenotazione.
- `ADMIN_KEY`: una stringa lunga a tua scelta, ti serve per vedere/gestire le prenotazioni da amministratore.
- `STRIPE_WEBHOOK_SECRET`: lo ottieni al passo successivo.

Avvia il server:
```bash
npm start
```

## Collegare il webhook Stripe

Il webhook è ciò che dice al tuo server "il pagamento è andato a buon fine", indipendentemente dal fatto che l'ospite chiuda il browser prima di tornare al sito.

- **In locale, per fare prove**: installa la Stripe CLI (`stripe login`, poi `stripe listen --forward-to localhost:3000/webhook`). La CLI ti mostra un `whsec_...` da mettere in `.env`.
- **In produzione**: Dashboard Stripe → Sviluppatori → Webhook → Aggiungi endpoint → URL `https://tuo-backend.com/webhook`, evento da ascoltare: `checkout.session.completed`. Copia il "Signing secret" mostrato e mettilo in `STRIPE_WEBHOOK_SECRET` sul server di produzione.

## Dove ospitare questo backend

Un sito statico (come `index.html` che ti ho già dato) non può far girare questo server: serve un host che esegua Node.js in modo continuativo. Opzioni semplici con piano gratuito o quasi:
- **Render.com** — collega la repo, "New Web Service", imposta le variabili d'ambiente, fatto.
- **Railway.app** — simile a Render.
- **Fly.io** — un po' più tecnico ma molto economico.

Qualunque scegli, imposta lì le stesse variabili di `.env` (mai caricare il file `.env` reale su GitHub).

## Come collegarlo al sito (index.html)

Nel form di prenotazione, al posto di salvare solo localmente, chiama questo backend in due passi:

```js
// 1. crea la prenotazione (stato "in_attesa")
const r = await fetch('https://tuo-backend.com/api/reservations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ guestName, email, phone, checkIn, checkOut, guests, nights, total, notes })
});
const reservation = await r.json();

// 2. crea la sessione di pagamento e reindirizza l'ospite a Stripe
const c = await fetch('https://tuo-backend.com/api/create-checkout-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reservationId: reservation.id })
});
const { url } = await c.json();
window.location = url; // apre la pagina di pagamento Stripe
```

Dopo il pagamento, Stripe riporta l'ospite su `FRONTEND_URL/?pagamento=ok&id=...`; il webhook, nel frattempo, ha già segnato la prenotazione come `pagata` nel backend — puoi leggerla con `GET /api/reservations/:id` per mostrare una conferma.

## Endpoint disponibili

| Metodo | Percorso | Autenticazione | Cosa fa |
|---|---|---|---|
| POST | `/api/reservations` | nessuna | Crea una prenotazione in stato "in_attesa" |
| POST | `/api/create-checkout-session` | nessuna | Crea il link di pagamento Stripe per una prenotazione |
| GET | `/api/reservations/:id` | nessuna | Stato di una singola prenotazione (per la pagina di conferma) |
| GET | `/api/admin/reservations` | header `x-admin-key` | Elenco completo, per il tuo pannello di gestione |
| PATCH | `/api/admin/reservations/:id` | header `x-admin-key` | Cambia stato (es. `confermata`, `annullata`) |
| DELETE | `/api/admin/reservations/:id` | header `x-admin-key` | Elimina una prenotazione |

## Email automatiche

Il server invia automaticamente tre email (all'ospite, e una notifica a te se imposti `OWNER_EMAIL`):
1. **Richiesta ricevuta** — appena viene creata la prenotazione.
2. **Pagamento confermato** — quando il webhook Stripe conferma il pagamento.
3. **Rimborso effettuato** — quando fai un rimborso dal pannello admin.

Per attivarle: crea un account gratuito su https://resend.com, prendi la API key da lì e mettila in `RESEND_API_KEY`. Se lasci quella variabile vuota, il server funziona comunque — salta solo l'invio delle email senza generare errori. Nota: con l'indirizzo di prova `onboarding@resend.dev` puoi mandare email solo al tuo stesso indirizzo registrato su Resend; per mandarle davvero agli ospiti devi verificare un tuo dominio su Resend e usarlo in `EMAIL_FROM`.

## Rimborsi

`POST /api/admin/reservations/:id/refund` (con header `x-admin-key`) rimborsa automaticamente tramite Stripe l'importo pagato per quella prenotazione, aggiorna lo stato a `rimborsata` e invia l'email di conferma rimborso all'ospite. Funziona solo per prenotazioni pagate tramite questo sistema (serve il `payment_intent` salvato dal webhook).

## Limiti di questa versione

- I dati sono salvati in un file JSON (`data/reservations.json`), adatto al volume di prenotazioni di una singola villa. Se in futuro ti serve di più, si può passare a un vero database (es. PostgreSQL) senza cambiare gli endpoint.
- I rimborsi sono sempre per l'intero importo pagato; un rimborso parziale richiederebbe una piccola modifica.
- Il pannello di gestione nel sito (`index.html`) non ha ancora un pulsante "rimborsa" o "vedi email inviate" — usa per ora l'endpoint sopra (es. con curl o Postman), oppure dimmi se vuoi che aggiunga il pulsante nell'interfaccia.
