const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const cors = require('cors');

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const PORT = process.env.PORT || 4242;

const receivedWebhooks = [];

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'webhooks.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // rotate when > 5 MB






// ensure logs directory exists
async function ensureLogDir() {
  try {
    await fsp.mkdir(LOG_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create log dir', err);
  }
}

// rotate: rename current file and gzip it with timestamp
async function rotateLogIfNeeded() {
  try {
    const stat = await fsp.stat(LOG_FILE).catch(() => null);
    if (!stat) return; // no file yet

    if (stat.size >= MAX_LOG_BYTES) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedName = path.join(LOG_DIR, `webhooks-${ts}.log`);
      await fsp.rename(LOG_FILE, rotatedName);
      // gzip rotated file
      const gzipPath = rotatedName + '.gz';
      await new Promise((resolve, reject) => {
        const inp = fs.createReadStream(rotatedName);
        const out = fs.createWriteStream(gzipPath);
        const gz = zlib.createGzip();
        inp.pipe(gz).pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
      });
      // remove the uncompressed rotated file after gzip
      await fsp.unlink(rotatedName).catch(() => {});
      console.log(`Rotated and compressed log to ${gzipPath}`);
    }
  } catch (err) {
    console.error('Error rotating log', err);
  }
}

// append event (JSON line)
async function appendWebhookLog(event) {
  try {
    await ensureLogDir();
    await rotateLogIfNeeded();
    const entry = {
      receivedAt: new Date().toISOString(),
      id: event.id || null,
      type: event.type || null,
      payload: event.data ? event.data.object : event, // full object
    };
    const line = JSON.stringify(entry) + '\n';
    await fsp.appendFile(LOG_FILE, line, 'utf8');
  } catch (err) {
    console.error('Failed to append webhook log', err);
  }
}



// --------------------
// ⚠️ Webhook route (MUST be before express.json)
// --------------------
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;

    try {
      if (webhookSecret && sig) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('✅ Verified event from Stripe:', event.type);
      } else {
        event = JSON.parse(req.body.toString());
        console.log('⚠️ No signature provided (manual/local test)');
      }
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Store webhook
    receivedWebhooks.push({
      id: event.id,
      type: event.type,
      created: new Date().toISOString(),
      data: event.data.object,
    });

    // async log (do not block response)
    appendWebhookLog(event).catch(err => {
      console.error('appendWebhookLog error', err);
    });

    // ✅ Keep only last 100 events
    if (receivedWebhooks.length > 100) {
      receivedWebhooks.splice(0, receivedWebhooks.length - 100);
    }

    // Handle event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('💰 Payment succeeded:', event.data.object.id);
        break;
      case 'payment_intent.payment_failed':
        console.log('❌ Payment failed:', event.data.object.last_payment_error?.message);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

// --------------------
// ✅ Normal API routes (AFTER webhook)
// --------------------
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ✅ Create PaymentIntent
app.post('/create-payment-intent', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: parseInt(amount, 10),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    console.error('Error creating payment intent:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ✅ View all received webhooks
app.get('/webhook', (req, res) => {
  res.json({ total: receivedWebhooks.length, events: receivedWebhooks });
});

// ✅ Stripe publishable key config route
app.get('/config', (req, res) => {
  res.send({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
});

// ✅ Start server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
