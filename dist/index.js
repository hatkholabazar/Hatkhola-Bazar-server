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
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const admin_routes_1 = require("./routes/admin.routes");
const customerOrder_routes_1 = require("./routes/customerOrder.routes");
const loyalty_routes_1 = require("./routes/loyalty.routes");
const admin_controller_1 = require("./controllers/admin.controller");
const shipment_service_1 = require("./services/shipment.service");
const loyalty_service_1 = require("./services/loyalty.service");
const Product_model_1 = require("./models/Product.model");
const Settings_model_1 = require("./models/Settings.model");
const preorder_service_1 = require("./services/preorder.service");
const node_cron_1 = __importDefault(require("node-cron"));
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
app.use((0, cookie_parser_1.default)());
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
app.use('/api/admin/loyalty', loyalty_routes_1.adminLoyaltyRouter);
// Customer & Public API (Orders, Account Orders, Public Locations, Loyalty, Vouchers)
app.use('/api', customerOrder_routes_1.customerOrderRouter);
app.use('/api', loyalty_routes_1.loyaltyRouter);
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
                preOrder: mode === 'pre_order' && p.preOrder
                    ? {
                        expectedDate: p.preOrder.expectedDate,
                        expectedNote: p.preOrder.expectedNote,
                        depositRequired: Boolean(p.preOrder.depositRequired),
                        depositAmount: p.preOrder.depositAmount,
                        depositPercent: p.preOrder.depositPercent,
                        cancellationPolicyText: p.preOrder.cancellationPolicyText,
                    }
                    : undefined,
                sellingOptions: (p.sellingOptions || []).map((o) => ({
                    label: o.label,
                    qtyG: o.qtyG,
                    sellingPrice: o.sellingPrice,
                })),
                isSeasonal: p.isSeasonal,
                description: p.description,
                tagline: p.tagline,
                badge: p.badge,
                origin: p.origin,
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
        // Ensure all existing and newly connected users have default role "user"
        const rawDb = mongoose_1.default.connection.db;
        if (rawDb) {
            await rawDb.collection('user').updateMany({ $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] }, { $set: { role: 'user' } });
        }
    }
    catch (err) {
        console.warn('Initial seeding note:', err.message);
    }
}
// 404 Catch-All for unknown API endpoints
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'API endpoint not found' });
});
// Centralized Express Error Handling Middleware
app.use((err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'An unexpected internal server error occurred.'
        : err.message || 'Internal Server Error';
    if (process.env.NODE_ENV !== 'production') {
        console.error('Express Error:', err);
    }
    res.status(statusCode).json({
        success: false,
        error: message,
    });
});
// Connect to MongoDB Atlas & Start Server
async function startServer() {
    const uri = process.env.MONGODB_URI;
    if (uri) {
        try {
            await mongoose_1.default.connect(uri);
            console.log('Connected to MongoDB Atlas via Mongoose.');
            await seedInitialData();
        }
        catch (err) {
            console.warn('MongoDB connection notice:', err.message);
        }
    }
    if (process.env.NODE_ENV !== 'test') {
        shipment_service_1.ShipmentService.initBackgroundSync();
        // Hourly background job for maturing loyalty hold entries
        if (process.env.LOYALTY_JOB_ENABLED !== 'false') {
            node_cron_1.default.schedule('0 * * * *', async () => {
                try {
                    const maturedRes = await loyalty_service_1.LoyaltyService.processMaturedHoldEntries();
                    if (maturedRes.processedCount > 0) {
                        console.log(`[Loyalty Cron] Matured ${maturedRes.processedCount} loyalty hold ledger entries (${maturedRes.vouchersIssued} vouchers issued)`);
                    }
                }
                catch (err) {
                    console.error('[Loyalty Cron] Error processing matured entries:', err.message);
                }
            });
            console.log('[Loyalty Cron] Hourly maturity sync job scheduled');
        }
        const server = app.listen(port, () => {
            console.log(`Hatkhola-Bazar backend listening on port ${port}`);
        });
        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`Received ${signal}. Shutting down gracefully...`);
            server.close(async () => {
                try {
                    await mongoose_1.default.connection.close();
                    console.log('MongoDB connection closed.');
                    process.exit(0);
                }
                catch {
                    process.exit(1);
                }
            });
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
    return app;
}
if (process.env.NODE_ENV !== 'test') {
    startServer();
}
exports.default = app;
