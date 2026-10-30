"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.customerOrderRouter = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const customerOrder_controller_1 = require("../controllers/customerOrder.controller");
const customerAuth_middleware_1 = require("../middlewares/customerAuth.middleware");
const cloudinary_service_1 = require("../services/cloudinary.service");
exports.customerOrderRouter = (0, express_1.Router)();
// Order creation rate limiter (15 requests per 15 min per IP)
const orderCreationLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many order requests. Please try again in a few minutes.' },
});
// Location lookups rate limiter (100 requests per 15 min per IP)
const locationLookupLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many location requests. Please try again shortly.' },
});
// Customer order submission
exports.customerOrderRouter.post('/orders', orderCreationLimiter, customerAuth_middleware_1.requireCustomerAuth, customerOrder_controller_1.CustomerOrderController.createOrder);
// Customer order history
exports.customerOrderRouter.get('/account/orders', customerAuth_middleware_1.requireCustomerAuth, customerOrder_controller_1.CustomerOrderController.getMyOrders);
// Public Pathao location cascades
exports.customerOrderRouter.get('/public/locations/cities', locationLookupLimiter, customerOrder_controller_1.CustomerOrderController.getPublicCities);
exports.customerOrderRouter.get('/public/locations/cities/:cityId/zones', locationLookupLimiter, customerOrder_controller_1.CustomerOrderController.getPublicZones);
exports.customerOrderRouter.get('/public/locations/zones/:zoneId/areas', locationLookupLimiter, customerOrder_controller_1.CustomerOrderController.getPublicAreas);
// Customer image upload signature (for refund proofs)
const uploadSignLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many upload requests. Please try again shortly.' },
});
exports.customerOrderRouter.post('/uploads/sign', uploadSignLimiter, (req, res) => {
    try {
        const { kind = 'refund' } = req.body;
        const signData = cloudinary_service_1.CloudinaryService.getUploadSignature(kind);
        return res.json({ success: true, ...signData });
    }
    catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});
