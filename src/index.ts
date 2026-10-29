import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { adminRouter } from './routes/admin.routes';
import { AdminController } from './controllers/admin.controller';
import { ShipmentService } from './services/shipment.service';
import rateLimit from 'express-rate-limit';
import { Product } from './models/Product.model';
import { Settings } from './models/Settings.model';
import { PreOrderService } from './services/preorder.service';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: [
      process.env.CLIENT_URL,
      'http://localhost:3000',
      'http://localhost:3001',
    ].filter(Boolean) as string[],
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));

// Health Check
app.get('/', (req, res) => {
  res.send('Hatkhola-Bazar Backend API is running!');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Hatkhola-Bazar Backend is running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Admin API
app.use('/api/admin', adminRouter);

// Pathao Webhook Receiver (Public endpoint for Pathao dispatch updates)
app.post('/api/webhooks/pathao', AdminController.handlePathaoWebhook);

// Public Order Tracking (Strict rate limited: 10 requests / 15 min per IP)
const publicTrackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tracking requests. Please try again in 15 minutes.' },
});

app.post('/api/public/track', publicTrackingLimiter, AdminController.trackOrderPublic);

// Public Products API (Safe sanitized fields only, with caching headers)
app.get('/api/products', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
    const products = await Product.find({ isActive: true }).sort({ createdAt: 1 });

    const safeProducts = await Promise.all(
      products.map(async (p) => {
        let mode = p.availabilityMode || 'in_stock';

        // Auto-check if pre-order closed or cap reached
        if (mode === 'pre_order') {
          if (p.preOrder?.closesAt && new Date() > new Date(p.preOrder.closesAt)) {
            mode = 'out_of_stock';
          } else if (p.preOrder?.maxQtyG && p.preOrder.maxQtyG > 0) {
            const openG = await PreOrderService.getOpenPreOrderGrams(p._id);
            if (openG >= p.preOrder.maxQtyG) {
              mode = 'out_of_stock';
            }
          }
        }

        return {
          id: p._id.toString(),
          code: p.code,
          slug: p.slug,
          name: p.name,
          availabilityMode: mode,
          preOrder: mode === 'pre_order' && p.preOrder ? {
            expectedDate: p.preOrder.expectedDate,
            expectedNote: p.preOrder.expectedNote,
            depositRequired: Boolean(p.preOrder.depositRequired),
            depositAmount: p.preOrder.depositAmount,
            depositPercent: p.preOrder.depositPercent,
            cancellationPolicyText: p.preOrder.cancellationPolicyText,
          } : undefined,
          sellingOptions: (p.sellingOptions || []).map((o: any) => ({
            label: o.label,
            qtyG: o.qtyG,
            sellingPrice: o.sellingPrice,
          })),
          isSeasonal: p.isSeasonal,
          description: p.description,
          benefits: p.benefits,
          image: p.image,
        };
      })
    );

    return res.json({ success: true, products: safeProducts });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch public products' });
  }
});

// Existing Orders Route (preserves consumer checkout API compatibility)
app.post('/api/orders', async (req, res) => {
  try {
    const { order } = req.body;
    if (!order || !order.orderId) {
      return res.status(400).json({ error: 'Order details required' });
    }

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.collection('orders').insertOne({
        ...order,
        createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
        receivedAt: new Date(),
      });
    }

    res.json({
      success: true,
      orderId: order.orderId,
      dbSynced: mongoose.connection.readyState === 1,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Seed default products and settings if empty
export async function seedInitialData() {
  try {
    const existingProducts = await Product.countDocuments();
    if (existingProducts === 0) {
      await Product.create([
        {
          code: 'GHEE',
          slug: 'danadar-ghee',
          name: 'Danadar Ghee (দানাদার ঘি)',
          baseUnit: 'g',
          sellingOptions: [
            { label: '1 kg Glass Jar', qtyG: 1000, sellingPrice: 1400 },
            { label: '500 g Glass Jar', qtyG: 500, sellingPrice: 750 },
            { label: '250 g Trial Jar', qtyG: 250, sellingPrice: 400 },
          ],
          isSeasonal: false,
          isActive: true,
          lowStockThresholdG: 5000,
          marginPercent: 25,
        },
        {
          code: 'GUR',
          slug: 'khejur-gur',
          name: 'Khejur Patali Gur (খেজুরের পাটালি গুড়)',
          baseUnit: 'g',
          sellingOptions: [
            { label: '1 kg Traditional Block', qtyG: 1000, sellingPrice: 450 },
            { label: '2 kg Family Pack', qtyG: 2000, sellingPrice: 880 },
            { label: '5 kg Saver Pack', qtyG: 5000, sellingPrice: 2150 },
          ],
          isSeasonal: true,
          isActive: true,
          lowStockThresholdG: 10000,
          marginPercent: 30,
        },
      ]);
    }

    const existingSettings = await Settings.countDocuments();
    if (existingSettings === 0) {
      await Settings.create({
        packagingCostPerOrder: 25,
        defaultMarginPercent: 25,
        defaultLowStockThresholdG: 5000,
        currencyLabel: '৳',
      });
    }
  } catch (err: any) {
    console.warn('Initial seeding note:', err.message);
  }
}

// Connect to MongoDB Atlas
export async function startServer() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri);
      console.log(' Connected to MongoDB Atlas via Mongoose!');
      await seedInitialData();
    } catch (err: any) {
      console.warn('⚠️ MongoDB connection notice:', err.message);
    }
  }

  if (process.env.NODE_ENV !== 'test') {
    ShipmentService.initBackgroundSync();
    app.listen(port, () => {
      console.log(` Hatkhola-Bazar backend listening on port ${port}`);
    });
  }

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export default app;

