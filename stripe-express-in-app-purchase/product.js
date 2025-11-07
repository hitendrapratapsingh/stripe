// =========================
// Stripe Product Management APIs
// =========================

const express = require("express");
const Stripe = require("stripe");
const app = express();

app.use(express.json());

// Initialize Stripe
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// =========================
// 1️⃣ Create a Product (with Subscription Price)
// =========================
app.post("/create-product", async (req, res) => {
  try {
    const {
      name,
      description,
      amount,
      currency = "usd",
      interval,           // e.g. "month", "year"
      interval_count = 1, // e.g. every 1 month
      billing_period      // e.g. "Monthly Subscription"
    } = req.body;

    // 1️⃣ Create Product
    const product = await stripe.products.create({
      name,
      description,
      metadata: {
        billing_period: billing_period || `${interval_count} ${interval}(s)`,
      },
    });

    // 2️⃣ Create Subscription Price
    const price = await stripe.prices.create({
      unit_amount: parseInt(amount, 10),
      currency,
      recurring: {
        interval,
        interval_count,
      },
      product: product.id,
    });

    res.json({
      success: true,
      productId: product.id,
      priceId: price.id,
      message: "✅ Theatre subscription product created successfully",
    });
  } catch (err) {
    console.error("❌ Error creating product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// =========================
// 2️⃣ Update Product Details
// =========================
app.post("/api/products/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const allowed = ["name", "description", "images", "metadata", "active"];
    const updates = {};

    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    const product = await stripe.products.update(id, updates);
    res.json({ success: true, product });
  } catch (err) {
    console.error("❌ Error updating product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 3️⃣ Get Single Product
// =========================
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await stripe.products.retrieve(req.params.id);
    res.json({ success: true, product });
  } catch (err) {
    console.error("❌ Error fetching product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 4️⃣ List All Products (Pagination Supported)
// =========================
app.get("/api/products", async (req, res) => {
  try {
    const { limit = 10, starting_after, ending_before } = req.query;
    const products = await stripe.products.list({
      limit: parseInt(limit),
      starting_after,
      ending_before,
    });
    res.json({ success: true, products });
  } catch (err) {
    console.error("❌ Error listing products:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 5️⃣ Create Price for a Product (One-time or Recurring)
// =========================
app.post("/api/prices", async (req, res) => {
  try {
    const { product, unit_amount, currency = "usd", recurring } = req.body;

    const priceParams = {
      unit_amount: parseInt(unit_amount, 10),
      currency,
      product,
    };

    // Add recurring billing if provided
    if (recurring && recurring.interval) {
      priceParams.recurring = recurring;
    }

    const price = await stripe.prices.create(priceParams);
    res.json({ success: true, price });
  } catch (err) {
    console.error("❌ Error creating price:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 6️⃣ Update Price Metadata (Nickname / Metadata only)
// =========================
app.post("/api/prices/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const updates = {};

    if (req.body.metadata) updates.metadata = req.body.metadata;
    if (req.body.nickname) updates.nickname = req.body.nickname;

    const price = await stripe.prices.update(id, updates);
    res.json({ success: true, price });
  } catch (err) {
    console.error("❌ Error updating price:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =========================
// 7️⃣ List All Prices for a Given Product
// =========================
app.get("/api/products/:id/prices", async (req, res) => {
  try {
    const prices = await stripe.prices.list({
      product: req.params.id,
      limit: 50,
    });
    res.json({ success: true, prices });
  } catch (err) {
    console.error("❌ Error fetching prices:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
