import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { LoyaltyController } from '../controllers/loyalty.controller';
import { requireCustomerAuth } from '../middlewares/customerAuth.middleware';
import { requireAdminAuth } from '../middlewares/auth.middleware';
import { adminRateLimiter } from '../middlewares/rateLimiter';

export const loyaltyRouter = Router();

// Strict Rate Limiter for Voucher Validation (15 requests per 15 min per IP)
const voucherValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many voucher validation requests. Please wait a few minutes.' },
});

// ==================== PUBLIC ENDPOINTS ====================
loyaltyRouter.get('/public/loyalty', LoyaltyController.getPublicLoyaltySettings);

// ==================== CUSTOMER ENDPOINTS ====================
// Voucher code validation (session optional, but authenticated user checked if present)
loyaltyRouter.post(
  '/vouchers/validate',
  voucherValidateLimiter,
  requireCustomerAuth,
  LoyaltyController.validateVoucher
);

loyaltyRouter.get(
  ['/account/loyalty', '/loyalty/account'],
  requireCustomerAuth,
  LoyaltyController.getCustomerLoyalty
);

loyaltyRouter.get(
  ['/account/vouchers', '/loyalty/vouchers'],
  requireCustomerAuth,
  LoyaltyController.getCustomerVouchers
);

loyaltyRouter.get(
  ['/account/loyalty/history', '/loyalty/ledger'],
  requireCustomerAuth,
  LoyaltyController.getCustomerHistory
);

loyaltyRouter.post(
  '/account/loyalty/link',
  requireCustomerAuth,
  LoyaltyController.customerLinkPastAccount
);

// ==================== ADMIN ENDPOINTS ====================
// All admin loyalty and voucher routes are protected by admin auth & rate limiter
export const adminLoyaltyRouter = Router();
adminLoyaltyRouter.use(adminRateLimiter);
adminLoyaltyRouter.use(requireAdminAuth);

// Overview & Metrics
adminLoyaltyRouter.get('/overview', LoyaltyController.getOverviewMetrics);
adminLoyaltyRouter.get('/review-queue', LoyaltyController.getReviewQueue);
adminLoyaltyRouter.get('/audit', LoyaltyController.getAuditLogs);
adminLoyaltyRouter.get('/notifications', LoyaltyController.getNotificationQueue);

// Program Settings & Backfill
adminLoyaltyRouter.get('/settings', LoyaltyController.getAdminSettings);
adminLoyaltyRouter.put('/settings', LoyaltyController.updateAdminSettings);
adminLoyaltyRouter.post('/backfill', LoyaltyController.backfillDeliveredSales);

// Vouchers Management
adminLoyaltyRouter.get('/vouchers', LoyaltyController.getVouchers);
adminLoyaltyRouter.post('/vouchers', LoyaltyController.createVoucher);
adminLoyaltyRouter.post('/vouchers/bulk', LoyaltyController.bulkGenerateVouchers);
adminLoyaltyRouter.patch('/vouchers/:id/status', LoyaltyController.updateVoucherStatus);
adminLoyaltyRouter.patch('/vouchers/:id/extend', LoyaltyController.extendVoucherExpiry);
adminLoyaltyRouter.patch('/vouchers/:id/limit', LoyaltyController.increaseUsageLimit);

// Customers & Accounts
adminLoyaltyRouter.get('/customers', LoyaltyController.getCustomers);
adminLoyaltyRouter.get('/customers/:id', LoyaltyController.getCustomerDetail);
adminLoyaltyRouter.post('/customers/:id/link', LoyaltyController.linkCustomer);
adminLoyaltyRouter.post('/customers/:id/unlink', LoyaltyController.unlinkCustomer);
adminLoyaltyRouter.post('/customers/:id/adjust', LoyaltyController.manualAdjustment);
adminLoyaltyRouter.post('/customers/:id/rebuild', LoyaltyController.rebuildBalance);
adminLoyaltyRouter.post('/import', LoyaltyController.importPurchases);

// Redemptions
adminLoyaltyRouter.get('/redemptions', LoyaltyController.getRedemptions);
adminLoyaltyRouter.post('/redemptions/:id/release', LoyaltyController.releaseRedemption);

// Convenience Aliases & Extra Action Handlers
adminLoyaltyRouter.get('/accounts', LoyaltyController.getCustomers);
adminLoyaltyRouter.get('/audit-logs', LoyaltyController.getAuditLogs);
adminLoyaltyRouter.post('/adjust', LoyaltyController.manualAdjustment);
adminLoyaltyRouter.post('/accounts/:id/rebuild', LoyaltyController.rebuildBalance);
adminLoyaltyRouter.post('/review-queue/:id/resolve', LoyaltyController.resolveReviewItem);
adminLoyaltyRouter.post('/vouchers/:id/void', (req, res) => {
  req.body.status = 'voided';
  req.body.reason = req.body.voidReason || req.body.reason;
  return LoyaltyController.updateVoucherStatus(req, res);
});
adminLoyaltyRouter.patch('/vouchers/:id', (req, res) => {
  if (req.body.status) return LoyaltyController.updateVoucherStatus(req, res);
  if (req.body.expiresAt) return LoyaltyController.extendVoucherExpiry(req, res);
  if (req.body.usageLimitTotal) return LoyaltyController.increaseUsageLimit(req, res);
  return LoyaltyController.updateVoucherStatus(req, res);
});

