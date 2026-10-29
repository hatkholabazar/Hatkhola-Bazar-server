"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedInitialData = seedInitialData;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const admin_routes_1 = require("./routes/admin.routes");
const admin_controller_1 = require("./controllers/admin.controller");
const shipment_service_1 = require("./services/shipment.service");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const Product_model_1 = require("./models/Product.model");
const Settings_model_1 = require("./models/Settings.model");
const preorder_service_1 = require("./services/preorder.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 5000;
app.use((0, cors_1.default)({
    origin: [
        process.env.CLIENT_URL,
        'http://localhost:3000',
        'http://localhost:3001',
    ].filter(Boolean),
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
// Health Check
app.get('/', (req, res) => {
    res.send('Hatkhola-Bazar Backend API is running!');
});
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Hatkhola-Bazar Backend is running',
        database: mongoose_1.default.connection.readyState === 1 ? 'connected' : 'disconnected',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});
// Admin API
app.use('/api/admin', admin_routes_1.adminRouter);
// Pathao Webhook Receiver (Public endpoint for Pathao dispatch updates)
app.post('/api/webhooks/pathao', admin_controller_1.AdminController.handlePathaoWebhook);
// Public Order Tracking (Strict rate limited: 10 requests / 15 min per IP)
const publicTrackingLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many tracking requests. Please try again in 15 minutes.' },
});
app.post('/api/public/track', publicTrackingLimiter, admin_controller_1.AdminController.trackOrderPublic);
// Public Products API (Safe sanitized fields only, with caching headers)
app.get('/api/products', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=120');
        const products = await Product_model_1.Product.find({ isActive: true }).sort({ createdAt: 1 });
        const safeProducts = await Promise.all(products.map(async (p) => {
            let mode = p.availabilityMode || 'in_stock';
            // Auto-check if pre-order closed or cap reached
            if (mode === 'pre_order') {
                if (p.preOrder?.closesAt && new Date() > new Date(p.preOrder.closesAt)) {
                    mode = 'out_of_stock';
                }
                else if (p.preOrder?.maxQtyG && p.preOrder.maxQtyG > 0) {
                    const openG = await preorder_service_1.PreOrderService.getOpenPreOrderGrams(p._id);
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
                sellingOptions: (p.sellingOptions || []).map((o) => ({
                    label: o.label,
                    qtyG: o.qtyG,
                    sellingPrice: o.sellingPrice,
                })),
                isSeasonal: p.isSeasonal,
                description: p.description,
                benefits: p.benefits,
                image: p.image,
            };
        }));
        return res.json({ success: true, products: safeProducts });
    }
    catch (err) {
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
        if (mongoose_1.default.connection.readyState === 1 && mongoose_1.default.connection.db) {
            await mongoose_1.default.connection.db.collection('orders').insertOne({
                ...order,
                createdAt: order.createdAt ? new Date(order.createdAt) : new Date(),
                receivedAt: new Date(),
            });
        }
        res.json({
            success: true,
            orderId: order.orderId,
            dbSynced: mongoose_1.default.connection.readyState === 1,
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// Seed default products and settings if empty
async function seedInitialData() {
    try {
        const existingProducts = await Product_model_1.Product.countDocuments();
        if (existingProducts === 0) {
            await Product_model_1.Product.create([
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
        const existingSettings = await Settings_model_1.Settings.countDocuments();
        if (existingSettings === 0) {
            await Settings_model_1.Settings.create({
                packagingCostPerOrder: 25,
                defaultMarginPercent: 25,
                defaultLowStockThresholdG: 5000,
                currencyLabel: '৳',
            });
        }
    }
    catch (err) {
        console.warn('Initial seeding note:', err.message);
    }
}
// Connect to MongoDB Atlas
async function startServer() {
    const uri = process.env.MONGODB_URI;
    if (uri) {
        try {
            await mongoose_1.default.connect(uri);
            console.log(' Connected to MongoDB Atlas via Mongoose!');
            await seedInitialData();
        }
        catch (err) {
            console.warn('⚠️ MongoDB connection notice:', err.message);
        }
    }
    if (process.env.NODE_ENV !== 'test') {
        shipment_service_1.ShipmentService.initBackgroundSync();
        app.listen(port, () => {
            console.log(` Hatkhola-Bazar backend listening on port ${port}`);
        });
    }
    return app;
}
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
exports.default = app;
