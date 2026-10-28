# Hatkhola-Bazar: Backend Future Plan & CRUD Architecture

This document records the exact architecture and CRUD implementation plan based on your preferred single-file format (`index.js`) and MongoDB native driver patterns.

---

## 1. Core Architecture Pattern

- **Single-File Structure**: All server configuration, database connections, helper functions, and API endpoints reside cleanly in `backend/index.js`.
- **Driver**: MongoDB Native Driver (`mongodb` package) with `MongoClient`, `ServerApiVersion.v1`, and `ObjectId` (no heavy ORM/ODM like Mongoose).
- **Deployment**: Serverless-ready on Vercel via `vercel.json` and deployable anywhere with `node index.js`.
- **Payment Processing**: Stripe integration (`require('stripe')(process.env.STRIPE_SECRET_KEY)`).

### Target File Tree
```
backend/
├── .env
├── .env.example
├── .gitignore
├── FUTURE_PLAN.md
├── index.js
├── package.json
└── vercel.json
```

---

## 2. Planned Collections for Hatkhola-Bazar

```js
const db = client.db("hatkhola-bazar-db");

const productsCollection = db.collection("products");
const categoriesCollection = db.collection("categories");
const ordersCollection = db.collection("orders");
const usersCollection = db.collection("user");
const ratingsCollection = db.collection("ratings");
const paymentsCollection = db.collection("payments");
const sessionsCollection = db.collection("session");
```

---

## 3. Database Connection Template

```js
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function connectDB() {
  try {
    await client.connect();
    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB Connection Failed:", err);
  }
}
connectDB();
```

---

## 4. Session & Auth Resolution (`resolveSessionUser`)

Extracts the session token from either the `Authorization: Bearer <token>` header or `better-auth.session_token` cookie, then verifies it against the `session` and `user` collections:

```js
async function resolveSessionUser(req) {
  let token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    const cookies = req.headers.cookie || '';
    const sessionCookieMatch = cookies.match(/better-auth\.session_token=([^;]+)/);
    if (sessionCookieMatch) {
      token = sessionCookieMatch[1];
    }
  }
  if (!token) return null;

  const sessionDoc = await sessionsCollection.findOne({ token });
  if (!sessionDoc) return null;

  const userDoc = await usersCollection.findOne({ _id: sessionDoc.userId });
  if (!userDoc || userDoc.isBlocked) return null;

  return userDoc;
}
```

---

## 5. CRUD Operations Plan

### A. Products Collection (`productsCollection`)

#### 1. Create Product (`POST /api/products`)
```js
app.post('/api/products', async (req, res) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const newProduct = {
      ...req.body,
      vendorId: user._id,
      vendorEmail: user.email,
      rating: 0,
      createdAt: new Date(),
    };
    const result = await productsCollection.insertOne(newProduct);
    res.status(201).json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 2. Read Products with Filter & Search (`GET /api/products`)
```js
app.get('/api/products', async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (category) {
      query.category = category;
    }
    if (search) {
      query.title = { $regex: new RegExp(search.trim(), 'i') };
    }

    const products = await productsCollection
      .find(query)
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .toArray();

    const total = await productsCollection.countDocuments(query);
    res.json({ products, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 3. Read Single Product by ID (`GET /api/products/:id`)
```js
app.get('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 4. Update Product (`PUT/PATCH /api/products/:id`)
```js
app.patch('/api/products/:id', async (req, res) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const updateDoc = {
      $set: {
        ...req.body,
        updatedAt: new Date(),
      }
    };
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

#### 5. Delete Product (`DELETE /api/products/:id`)
```js
app.delete('/api/products/:id', async (req, res) => {
  try {
    const user = await resolveSessionUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

### B. Rating Stats & Synchronization Pattern

Calculates average ratings from the `ratingsCollection` and synchronizes the aggregate value directly onto the target entity:

```js
async function getProductRatingStats(productId) {
  if (!productId) return { average: 0, count: 0 };
  const ratings = await ratingsCollection
    .find({ productId: productId.toString() })
    .toArray();

  if (!ratings.length) return { average: 0, count: 0 };
  const sum = ratings.reduce((acc, r) => acc + Number(r.stars || 0), 0);
  return {
    average: parseFloat((sum / ratings.length).toFixed(1)),
    count: ratings.length,
  };
}

async function syncProductRating(productId) {
  if (!productId) return { average: 0, count: 0 };
  const stats = await getProductRatingStats(productId);
  await productsCollection.updateOne(
    { _id: new ObjectId(productId) },
    { $set: { rating: stats.average, ratingCount: stats.count } }
  );
  return stats;
}
```

---

### C. Orders & Stripe Payment Intent (`POST /api/create-payment-intent`)

```js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = "bdt" } = req.body;
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // convert to smallest unit
      currency,
      payment_method_types: ['card'],
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 6. Implementation Checklist (When Ready)

1. [ ] Install `mongodb` and `stripe` in `backend` (`npm install mongodb stripe`).
2. [ ] Add `MONGODB_URI` and `STRIPE_SECRET_KEY` in `backend/.env`.
3. [ ] Uncomment the `MongoClient` initialization and `connectDB()` inside `backend/index.js`.
4. [ ] Paste the collection handles and `resolveSessionUser` helper.
5. [ ] Wire the CRUD routes directly into `backend/index.js`.

