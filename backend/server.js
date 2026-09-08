require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'reservations.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// --- semplice "database" su file, con lock in memoria per evitare scritture concorrenti ---
let writing = Promise.resolve();
function readReservations() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return []; }
}
function writeReservations(list) {
  writing = writing.then(() => fs.promises.writeFile(DATA_FILE, JSON.stringify(list, null, 2)));
  return writing;
}

// --- CORS: consenti solo il dominio del tuo sito ---
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Il webhook Stripe richiede il body "raw" (non JSON parsato) per verificare la firma,
// quindi va dichiarato PRIMA di express.json().
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Firma webhook non valida:', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const reservationId = session.metadata && session.metadata.reservationId;
    if (reservationId) {
      const list = readReservations();
      const res_ = list.find((r) => r.id === reservationId);
      if (res_) {
        res_.status = 'pagata';
        res_.stripeSessionId = session.id;
        res_.stripePaymentIntentId = session.payment_intent;
        res_.paidAt = new Date().toISOString();
        writeReservations(list);
        sendPaymentConfirmedEmails(res_).catch((e) => console.error('Errore invio email pagamento:', e));
      }
    }
  }
  res.json({ received: true });
});

app.use(express.json());

// --- Invio email tramite Resend (https://resend.com) — nessuna dipendenza extra, usa fetch nativo di Node 18+ ---
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !to) return; // email non configurate: non blocca il resto del flusso
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Villa a Colico <onboarding@resend.dev>',
        to: [to],
        subject,
        html
      })
    });
    if (!r.ok) console.error('Resend ha risposto con errore:', r.status, await r.text());
  } catch (e) {
    console.error('Errore di rete inviando email:', e.message);
  }
}

function euroFmt(n) { return '€ ' + Number(n).toFixed(2).replace('.', ','); }

async function sendReservationReceivedEmails(reservation) {
  await sendEmail(
    reservation.email,
    'Richiesta di prenotazione ricevuta — Villa a Colico',
    '<p>Ciao ' + reservation.guestName + ',</p>' +
    '<p>Abbiamo ricevuto la tua richiesta di prenotazione dal <strong>' + reservation.checkIn + '</strong> al <strong>' + reservation.checkOut + '</strong> (' + reservation.guests + ' ospiti).</p>' +
    '<p>Totale: <strong>' + euroFmt(reservation.total) + '</strong>. Completa il pagamento dal link che ti abbiamo fornito per confermare la prenotazione.</p>'
  );
  if (process.env.OWNER_EMAIL) {
    await sendEmail(
      process.env.OWNER_EMAIL,
      'Nuova richiesta di prenotazione — ' + reservation.guestName,
      '<p>Nuova richiesta: ' + reservation.guestName + ' (' + reservation.email + ', ' + reservation.phone + ')</p>' +
      '<p>' + reservation.checkIn + ' → ' + reservation.checkOut + ' · ' + reservation.guests + ' ospiti · ' + euroFmt(reservation.total) + '</p>'
    );
  }
}

async function sendPaymentConfirmedEmails(reservation) {
  await sendEmail(
    reservation.email,
    'Pagamento confermato — Villa a Colico',
    '<p>Ciao ' + reservation.guestName + ',</p>' +
    '<p>Il pagamento di <strong>' + euroFmt(reservation.total) + '</strong> per il soggiorno dal <strong>' + reservation.checkIn + '</strong> al <strong>' + reservation.checkOut + '</strong> è andato a buon fine. La tua prenotazione è confermata.</p>' +
    '<p>Ti aspettiamo!</p>'
  );
  if (process.env.OWNER_EMAIL) {
    await sendEmail(
      process.env.OWNER_EMAIL,
      'Pagamento ricevuto — ' + reservation.guestName,
      '<p>' + reservation.guestName + ' ha pagato ' + euroFmt(reservation.total) + ' per il soggiorno ' + reservation.checkIn + ' → ' + reservation.checkOut + '.</p>'
    );
  }
}

async function sendRefundEmails(reservation) {
  await sendEmail(
    reservation.email,
    'Rimborso effettuato — Villa a Colico',
    '<p>Ciao ' + reservation.guestName + ',</p>' +
    '<p>Ti confermiamo il rimborso di <strong>' + euroFmt(reservation.total) + '</strong> per il soggiorno dal ' + reservation.checkIn + ' al ' + reservation.checkOut + '. L\'importo tornerà sul metodo di pagamento originale entro qualche giorno lavorativo.</p>'
  );
}

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  next();
}

// --- Salute del servizio ---
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Crea una richiesta di prenotazione (stato: in_attesa, senza pagamento) ---
app.post('/api/reservations', (req, res) => {
  const { guestName, email, phone, checkIn, checkOut, guests, nights, total, notes } = req.body || {};
  if (!guestName || !email || !checkIn || !checkOut || !total) {
    return res.status(400).json({ error: 'Dati mancanti' });
  }
  const list = readReservations();
  const reservation = {
    id: Date.now() + '-' + Math.floor(Math.random() * 1000),
    guestName, email, phone, checkIn, checkOut,
    guests: Number(guests) || 1,
    nights: Number(nights) || 0,
    total: Number(total),
    notes: notes || '',
    status: 'in_attesa',
    createdAt: new Date().toISOString()
  };
  list.push(reservation);
  writeReservations(list);
  sendReservationReceivedEmails(reservation).catch((e) => console.error('Errore invio email richiesta:', e));
  res.json(reservation);
});

// --- Crea una sessione di pagamento Stripe per una prenotazione esistente ---
app.post('/api/create-checkout-session', async (req, res) => {
  const { reservationId } = req.body || {};
  const list = readReservations();
  const reservation = list.find((r) => r.id === reservationId);
  if (!reservation) return res.status(404).json({ error: 'Prenotazione non trovata' });
  if (reservation.status === 'pagata') return res.status(400).json({ error: 'Prenotazione già pagata' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: reservation.email,
      line_items: [{
        price_data: {
          currency: process.env.CURRENCY || 'eur',
          product_data: {
            name: 'Soggiorno Villa a Colico',
            description: reservation.checkIn + ' → ' + reservation.checkOut + ' · ' + reservation.guests + ' ospiti'
          },
          unit_amount: Math.round(reservation.total * 100)
        },
        quantity: 1
      }],
      metadata: { reservationId: reservation.id },
      success_url: (process.env.FRONTEND_URL || '') + '/?pagamento=ok&id=' + reservation.id,
      cancel_url: (process.env.FRONTEND_URL || '') + '/?pagamento=annullato&id=' + reservation.id
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore nella creazione della sessione di pagamento' });
  }
});

// --- Stato di una prenotazione (per la pagina di conferma) ---
app.get('/api/reservations/:id', (req, res) => {
  const list = readReservations();
  const r = list.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Non trovata' });
  res.json(r);
});

// --- Elenco completo e gestione stato: solo con chiave admin ---
app.get('/api/admin/reservations', requireAdmin, (req, res) => {
  res.json(readReservations());
});

app.patch('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const list = readReservations();
  const r = list.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Non trovata' });
  if (req.body.status) r.status = req.body.status;
  writeReservations(list);
  res.json(r);
});

// --- Rimborso: restituisce l'importo tramite Stripe e aggiorna lo stato ---
app.post('/api/admin/reservations/:id/refund', requireAdmin, async (req, res) => {
  const list = readReservations();
  const r = list.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Non trovata' });
  if (!r.stripePaymentIntentId) return res.status(400).json({ error: 'Questa prenotazione non ha un pagamento Stripe da rimborsare' });
  if (r.status === 'rimborsata') return res.status(400).json({ error: 'Già rimborsata' });

  try {
    await stripe.refunds.create({ payment_intent: r.stripePaymentIntentId });
    r.status = 'rimborsata';
    r.refundedAt = new Date().toISOString();
    writeReservations(list);
    sendRefundEmails(r).catch((e) => console.error('Errore invio email rimborso:', e));
    res.json(r);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Errore durante il rimborso: ' + err.message });
  }
});

app.delete('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  let list = readReservations();
  list = list.filter((x) => x.id !== req.params.id);
  writeReservations(list);
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Backend Villa Colico in ascolto sulla porta ' + port));
