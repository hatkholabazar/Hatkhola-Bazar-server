const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      process.env.CLIENT_URL,
      'http://localhost:3000',
      'http://localhost:3001',
    ].filter(Boolean),
    credentials: true,
  })
);
app.use(express.json());

// MongoDB Client
let db;
const uri = process.env.MONGODB_URI;

if (uri) {
  const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  client
    .connect()
    .then(() => {
      db = client.db('hatkhola-bazar');
      console.log(' Connected to MongoDB Atlas (hatkhola-bazar)!');
    })
    .catch((err) => {
      console.warn('[Notice] MongoDB Atlas connection notice:', err.message);
    });
}

// Health check
app.get('/', (req, res) => {
  res.send('Hatkhola-Bazar Backend API is running!');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Hatkhola-Bazar backend is running',
    database: db ? 'connected' : 'connecting_or_offline',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Orders API
app.post('/api/orders', async (req, res) => {
  try {
    const { order, account } = req.body;
    if (!order || !order.orderId) {
      return res.status(400).json({ error: 'Order details required' });
    }

    if (db) {
      await db.collection('orders').insertOne({
        ...order,
        createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
        receivedAt: new Date(),
      });

      if (account && account.phone) {
        await db.collection('users').updateOne(
          { phone: account.phone },
          {
            $set: {
              name: account.name,
              phone: account.phone,
              address: account.address,
              password: account.password,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
              role: 'customer',
            },
          },
          { upsert: true }
        );
      }
    }

    res.json({
      success: true,
      orderId: order.orderId,
      dbSynced: Boolean(db),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone || !db) {
      return res.json({ orders: [] });
    }

    const orders = await db
      .collection('orders')
      .find({ 'customer.phone': phone })
      .sort({ createdAt: -1 })
      .toArray();

    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Refund API
app.post('/api/orders/:id/refund', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, notes, phone } = req.body;

    if (db) {
      await db.collection('orders').updateOne(
        { orderId: id },
        {
          $set: {
            status: 'Refund Requested',
            refundRequest: {
              reason,
              notes,
              phone,
              requestedAt: new Date(),
            },
          },
        }
      );
    }

    res.json({
      success: true,
      message: 'Refund request recorded',
      orderId: id,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Hatkhola-Bazar server running on port ${port}`);
});

module.exports = app;
