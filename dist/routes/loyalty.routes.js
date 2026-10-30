"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminLoyaltyRouter = exports.loyaltyRouter = void 0;
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const loyalty_controller_1 = require("../controllers/loyalty.controller");
const customerAuth_middleware_1 = require("../middlewares/customerAuth.middleware");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const rateLimiter_1 = require("../middlewares/rateLimiter");
exports.loyaltyRouter = (0, express_1.Router)();
// Strict Rate Limiter for Voucher Validation (15 requests per 15 min per IP)
const voucherValidateLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many voucher validation requests. Please wait a few minutes.' },
});
// ==================== PUBLIC ENDPOINTS ====================
exports.loyaltyRouter.get('/public/loyalty', loyalty_controller_1.LoyaltyController.getPublicLoyaltySettings);
// ==================== CUSTOMER ENDPOINTS ====================
// Voucher code validation (session optional, but authenticated user checked if present)
exports.loyaltyRouter.post('/vouchers/validate', voucherValidateLimiter, customerAuth_middleware_1.requireCustomerAuth, loyalty_controller_1.LoyaltyController.validateVoucher);
exports.loyaltyRouter.get(['/account/loyalty', '/loyalty/account'], customerAuth_middleware_1.requireCustomerAuth, loyalty_controller_1.LoyaltyController.getCustomerLoyalty);
exports.loyaltyRouter.get(['/account/vouchers', '/loyalty/vouchers'], customerAuth_middleware_1.requireCustomerAuth, loyalty_controller_1.LoyaltyController.getCustomerVouchers);
exports.loyaltyRouter.get(['/account/loyalty/history', '/loyalty/ledger'], customerAuth_middleware_1.requireCustomerAuth, loyalty_controller_1.LoyaltyController.getCustomerHistory);
exports.loyaltyRouter.post('/account/loyalty/link', customerAuth_middleware_1.requireCustomerAuth, loyalty_controller_1.LoyaltyController.customerLinkPastAccount);
// ==================== ADMIN ENDPOINTS ====================
// All admin loyalty and voucher routes are protected by admin auth & rate limiter
exports.adminLoyaltyRouter = (0, express_1.Router)();
exports.adminLoyaltyRouter.use(rateLimiter_1.adminRateLimiter);
exports.adminLoyaltyRouter.use(auth_middleware_1.requireAdminAuth);
// Overview & Metrics
exports.adminLoyaltyRouter.get('/overview', loyalty_controller_1.LoyaltyController.getOverviewMetrics);
exports.adminLoyaltyRouter.get('/review-queue', loyalty_controller_1.LoyaltyController.getReviewQueue);
exports.adminLoyaltyRouter.get('/audit', loyalty_controller_1.LoyaltyController.getAuditLogs);
exports.adminLoyaltyRouter.get('/notifications', loyalty_controller_1.LoyaltyController.getNotificationQueue);
// Program Settings & Backfill
exports.adminLoyaltyRouter.get('/settings', loyalty_controller_1.LoyaltyController.getAdminSettings);
exports.adminLoyaltyRouter.put('/settings', loyalty_controller_1.LoyaltyController.updateAdminSettings);
exports.adminLoyaltyRouter.post('/backfill', loyalty_controller_1.LoyaltyController.backfillDeliveredSales);
// Vouchers Management
exports.adminLoyaltyRouter.get('/vouchers', loyalty_controller_1.LoyaltyController.getVouchers);
exports.adminLoyaltyRouter.post('/vouchers', loyalty_controller_1.LoyaltyController.createVoucher);
exports.adminLoyaltyRouter.post('/vouchers/bulk', loyalty_controller_1.LoyaltyController.bulkGenerateVouchers);
exports.adminLoyaltyRouter.patch('/vouchers/:id/status', loyalty_controller_1.LoyaltyController.updateVoucherStatus);
exports.adminLoyaltyRouter.patch('/vouchers/:id/extend', loyalty_controller_1.LoyaltyController.extendVoucherExpiry);
exports.adminLoyaltyRouter.patch('/vouchers/:id/limit', loyalty_controller_1.LoyaltyController.increaseUsageLimit);
// Customers & Accounts
exports.adminLoyaltyRouter.get('/customers', loyalty_controller_1.LoyaltyController.getCustomers);
exports.adminLoyaltyRouter.get('/customers/:id', loyalty_controller_1.LoyaltyController.getCustomerDetail);
exports.adminLoyaltyRouter.post('/customers/:id/link', loyalty_controller_1.LoyaltyController.linkCustomer);
exports.adminLoyaltyRouter.post('/customers/:id/unlink', loyalty_controller_1.LoyaltyController.unlinkCustomer);
exports.adminLoyaltyRouter.post('/customers/:id/adjust', loyalty_controller_1.LoyaltyController.manualAdjustment);
exports.adminLoyaltyRouter.post('/customers/:id/rebuild', loyalty_controller_1.LoyaltyController.rebuildBalance);
exports.adminLoyaltyRouter.post('/import', loyalty_controller_1.LoyaltyController.importPurchases);
// Redemptions
exports.adminLoyaltyRouter.get('/redemptions', loyalty_controller_1.LoyaltyController.getRedemptions);
exports.adminLoyaltyRouter.post('/redemptions/:id/release', loyalty_controller_1.LoyaltyController.releaseRedemption);
// Convenience Aliases & Extra Action Handlers
exports.adminLoyaltyRouter.get('/accounts', loyalty_controller_1.LoyaltyController.getCustomers);
exports.adminLoyaltyRouter.get('/audit-logs', loyalty_controller_1.LoyaltyController.getAuditLogs);
exports.adminLoyaltyRouter.post('/adjust', loyalty_controller_1.LoyaltyController.manualAdjustment);
exports.adminLoyaltyRouter.post('/accounts/:id/rebuild', loyalty_controller_1.LoyaltyController.rebuildBalance);
exports.adminLoyaltyRouter.post('/review-queue/:id/resolve', loyalty_controller_1.LoyaltyController.resolveReviewItem);
exports.adminLoyaltyRouter.post('/vouchers/:id/void', (req, res) => {
    req.body.status = 'voided';
    req.body.reason = req.body.voidReason || req.body.reason;
    return loyalty_controller_1.LoyaltyController.updateVoucherStatus(req, res);
});
exports.adminLoyaltyRouter.patch('/vouchers/:id', (req, res) => {
    if (req.body.status)
        return loyalty_controller_1.LoyaltyController.updateVoucherStatus(req, res);
    if (req.body.expiresAt)
        return loyalty_controller_1.LoyaltyController.extendVoucherExpiry(req, res);
    if (req.body.usageLimitTotal)
        return loyalty_controller_1.LoyaltyController.increaseUsageLimit(req, res);
    return loyalty_controller_1.LoyaltyController.updateVoucherStatus(req, res);
});
