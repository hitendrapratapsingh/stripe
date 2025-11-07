require("dotenv").config();
const express = require("express");
const Stripe = require("stripe");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

/* ======================================
 ✅ STEP 1: Create or Retrieve a Customer
====================================== */
app.post("/create-customer", async (req, res) => {
  try {
    const { email, name } = req.body;

    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
      return res.json({ success: true, customer: existing.data[0] });
    }

    const customer = await stripe.customers.create({ email, name });
    res.json({ success: true, customer });
  } catch (err) {
    console.error("❌ Error creating customer:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 2: Create Checkout Session
====================================== */
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { customerId, priceId, successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error("❌ Error creating checkout session:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 3: Webhook Listener
====================================== */
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error("⚠️ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
      case "checkout.session.completed":
        console.log("✅ Checkout Session Completed:", event.data.object.id);
        break;
      case "customer.subscription.created":
        console.log("🎉 Subscription Created:", event.data.object.id);
        break;
      case "customer.subscription.updated":
        console.log("🔄 Subscription Updated:", event.data.object.id);
        break;
      case "customer.subscription.deleted":
        console.log("🚫 Subscription Canceled:", event.data.object.id);
        break;
      case "invoice.payment_succeeded":
        console.log("💰 Payment Succeeded for:", event.data.object.customer);
        break;
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  }
);

/* ======================================
 ✅ STEP 4: Get All Subscriptions for a Customer
====================================== */
app.get("/subscription/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      expand: ["data.default_payment_method"],
    });

    res.json({ success: true, subscriptions });
  } catch (err) {
    console.error("❌ Error fetching subscription details:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 5: Upgrade / Downgrade Subscription
====================================== */
app.post("/subscription/update", async (req, res) => {
  try {
    const { subscriptionId, newPriceId } = req.body;

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    const updated = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      proration_behavior: "create_prorations", // auto adjust billing
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId,
        },
      ],
    });

    res.json({ success: true, updated });
  } catch (err) {
    console.error("❌ Error updating subscription:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 6: Cancel Subscription (Immediately)
====================================== */
app.delete("/subscription/:id", async (req, res) => {
  try {
    const subscriptionId = req.params.id;
    const canceled = await stripe.subscriptions.del(subscriptionId);
    res.json({ success: true, canceled });
  } catch (err) {
    console.error("❌ Error canceling subscription:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 7: Cancel at End of Billing Period
====================================== */
app.post("/subscription/cancel-later", async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const canceled = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
    res.json({ success: true, canceled });
  } catch (err) {
    console.error("❌ Error scheduling cancellation:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ STEP 8: Resume Canceled Subscription
====================================== */
app.post("/subscription/resume", async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const resumed = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
    });
    res.json({ success: true, resumed });
  } catch (err) {
    console.error("❌ Error resuming subscription:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ======================================
 ✅ START SERVER
====================================== */
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
