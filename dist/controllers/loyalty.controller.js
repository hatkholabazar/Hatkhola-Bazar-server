"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoyaltyController = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const loyalty_service_1 = require("../services/loyalty.service");
const voucher_service_1 = require("../services/voucher.service");
const Voucher_model_1 = require("../models/Voucher.model");
const VoucherRedemption_model_1 = require("../models/VoucherRedemption.model");
const LoyaltyAccount_model_1 = require("../models/LoyaltyAccount.model");
const LoyaltyLedger_model_1 = require("../models/LoyaltyLedger.model");
const AuditLog_model_1 = require("../models/AuditLog.model");
const NotificationQueue_model_1 = require("../models/NotificationQueue.model");
const shipment_service_1 = require("../services/shipment.service");
const loyalty_validator_1 = require("../validators/loyalty.validator");
class LoyaltyController {
    // ==================== PUBLIC API ====================
    /**
     * Public read-only loyalty program parameters
     * Cached for 60 seconds
     */
    static async getPublicLoyaltySettings(req, res) {
        try {
            res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
            const settings = await loyalty_service_1.LoyaltyService.getSettings();
            return res.json({
                success: true,
                loyalty: {
                    enabled: settings.loyaltyEnabled,
                    targetAmount: settings.targetAmount,
                    rewardAmount: settings.rewardAmount,
                    minOrderToRedeem: settings.minOrderToRedeem,
                    voucherExpiryDays: settings.voucherExpiryDays,
                },
                settings: {
                    loyaltyEnabled: settings.loyaltyEnabled,
                    targetAmount: settings.targetAmount,
                    rewardAmount: settings.rewardAmount,
                    minOrderToRedeem: settings.minOrderToRedeem,
                    voucherExpiryDays: settings.voucherExpiryDays,
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    // ==================== CUSTOMER API ====================
    /**
     * Customer / Checkout: Validate voucher against cart items
     * Rate limited: 15 / 15m per IP
     */
    static async validateVoucher(req, res) {
        try {
            const parsed = loyalty_validator_1.ValidateVoucherInputSchema.parse(req.body);
            const user = req.user;
            const phone = parsed.phone || (user?.phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(user.phone) : undefined);
            const userId = user?.id || user?._id?.toString() || undefined;
            const evalItems = parsed.items.map((it) => ({
                productId: it.productId,
                productCode: it.productCode,
                productName: it.productName || 'Cart Item',
                price: it.price,
                quantity: it.quantity,
            }));
            const evaluation = await voucher_service_1.VoucherService.evaluateVoucher(parsed.code, evalItems, phone, userId);
            return res.json({
                success: true,
                evaluation,
            });
        }
        catch (err) {
            if (err.name === 'ZodError') {
                return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
            }
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Customer: Get progress balance, hold amount, and program snapshot
     */
    static async getCustomerLoyalty(req, res) {
        try {
            const user = req.user;
            const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
            let resolvedPhone = phoneParam || (user?.phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(user.phone) : undefined);
            const db = mongoose_1.default.connection.db;
            // If user is authenticated but phone is not in query/session, look up their phone from orders or account
            if (!resolvedPhone && user && db) {
                const queryOr = [];
                if (user.id) {
                    queryOr.push({ userId: user.id });
                    try {
                        queryOr.push({ userId: new mongoose_1.default.Types.ObjectId(user.id) });
                    }
                    catch { }
                }
                if (user.email) {
                    queryOr.push({ 'customer.email': user.email });
                }
                if (queryOr.length > 0) {
                    const latestOrder = await db.collection('orders').findOne({ $or: queryOr }, { sort: { createdAt: -1 } });
                    if (latestOrder?.customer?.phone) {
                        resolvedPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
                    }
                }
            }
            if (!resolvedPhone && user?.id) {
                const accByUserId = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ userId: user.id });
                if (accByUserId?.phone) {
                    resolvedPhone = accByUserId.phone;
                }
            }
            if (!resolvedPhone && !user?.id) {
                return res.status(400).json({ success: false, error: 'Customer phone or session required' });
            }
            let account = null;
            let unlinkedPastPurchases = false;
            const settings = await loyalty_service_1.LoyaltyService.getSettings();
            if (resolvedPhone) {
                const existing = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: resolvedPhone });
                if (existing) {
                    if (user?.id && !existing.userId) {
                        existing.userId = user.id;
                        await existing.save();
                    }
                    account = existing;
                }
                else {
                    account = await loyalty_service_1.LoyaltyService.getOrCreateAccount(resolvedPhone, user?.name || user?.fullName, user?.id);
                }
            }
            else if (user?.id) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ userId: user.id });
            }
            // Automatically sync uncredited customer orders (counting product price only, excluding delivery cost)
            if (account) {
                await loyalty_service_1.LoyaltyService.syncCustomerOrdersSpend(account, resolvedPhone, user?.id);
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(account._id);
            }
            return res.json({
                success: true,
                account,
                unlinkedPastPurchases,
                settings: {
                    loyaltyEnabled: settings.loyaltyEnabled,
                    targetAmount: settings.targetAmount,
                    rewardAmount: settings.rewardAmount,
                    minOrderToRedeem: settings.minOrderToRedeem,
                    voucherExpiryDays: settings.voucherExpiryDays,
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Customer: Get wallet vouchers (active, used, expired)
     */
    static async getCustomerVouchers(req, res) {
        try {
            const user = req.user;
            const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
            const status = req.query.status ? String(req.query.status) : undefined;
            let resolvedPhone = phoneParam || (user?.phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(user.phone) : undefined);
            if (!resolvedPhone && user && mongoose_1.default.connection.db) {
                const queryOr = [];
                if (user.id) {
                    queryOr.push({ userId: user.id });
                    try {
                        queryOr.push({ userId: new mongoose_1.default.Types.ObjectId(user.id) });
                    }
                    catch { }
                }
                if (user.email) {
                    queryOr.push({ 'customer.email': user.email });
                }
                if (queryOr.length > 0) {
                    const latestOrder = await mongoose_1.default.connection.db.collection('orders').findOne({ $or: queryOr }, { sort: { createdAt: -1 } });
                    if (latestOrder?.customer?.phone) {
                        resolvedPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
                    }
                }
            }
            if (!resolvedPhone && user?.id) {
                const accByUserId = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ userId: user.id });
                if (accByUserId?.phone) {
                    resolvedPhone = accByUserId.phone;
                }
            }
            const filter = {};
            if (resolvedPhone) {
                filter.$or = [{ assignedPhone: resolvedPhone }, { assignedUserId: user?.id }];
            }
            else if (user?.id) {
                filter.assignedUserId = user.id;
            }
            const allVouchers = await Voucher_model_1.Voucher.find(filter).sort({ createdAt: -1 });
            const now = new Date();
            // Synchronize expiration status for vouchers that have reached usage capacity or expired by date
            for (const v of allVouchers) {
                let dirty = false;
                const isDateExpired = Boolean(v.expiresAt && now > new Date(v.expiresAt));
                const isCapacityUsed = Boolean(v.usageLimitTotal !== null &&
                    v.usageLimitTotal !== undefined &&
                    v.usedCount + v.reservedCount >= v.usageLimitTotal);
                if (v.status === 'active' && (isDateExpired || isCapacityUsed)) {
                    v.status = 'expired';
                    dirty = true;
                }
                if (dirty) {
                    await v.save();
                }
            }
            let returnVouchers = allVouchers;
            if (status && status !== 'all') {
                if (status === 'active') {
                    returnVouchers = allVouchers.filter((v) => v.status === 'active' &&
                        (!v.expiresAt || new Date(v.expiresAt) > now) &&
                        (v.usageLimitTotal === null ||
                            v.usageLimitTotal === undefined ||
                            v.usedCount + v.reservedCount < v.usageLimitTotal));
                }
                else if (status === 'expired' || status === 'used') {
                    returnVouchers = allVouchers.filter((v) => v.status === 'expired' ||
                        v.status === 'redeemed' ||
                        v.status === 'voided' ||
                        (v.expiresAt && new Date(v.expiresAt) <= now) ||
                        (v.usageLimitTotal !== null &&
                            v.usageLimitTotal !== undefined &&
                            v.usedCount + v.reservedCount >= v.usageLimitTotal));
                }
                else {
                    returnVouchers = allVouchers.filter((v) => v.status === status);
                }
            }
            return res.json({
                success: true,
                vouchers: returnVouchers,
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Customer: Get ledger history entries
     */
    static async getCustomerHistory(req, res) {
        try {
            const user = req.user;
            const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
            let resolvedPhone = phoneParam || (user?.phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(user.phone) : undefined);
            if (!resolvedPhone && user && mongoose_1.default.connection.db) {
                const queryOr = [];
                if (user.id) {
                    queryOr.push({ userId: user.id });
                    try {
                        queryOr.push({ userId: new mongoose_1.default.Types.ObjectId(user.id) });
                    }
                    catch { }
                }
                if (user.email) {
                    queryOr.push({ 'customer.email': user.email });
                }
                if (queryOr.length > 0) {
                    const latestOrder = await mongoose_1.default.connection.db.collection('orders').findOne({ $or: queryOr }, { sort: { createdAt: -1 } });
                    if (latestOrder?.customer?.phone) {
                        resolvedPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
                    }
                }
            }
            if (!resolvedPhone && user?.id) {
                const accByUserId = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ userId: user.id });
                if (accByUserId?.phone) {
                    resolvedPhone = accByUserId.phone;
                }
            }
            let account = null;
            if (resolvedPhone) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: resolvedPhone });
            }
            else if (user?.id) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ userId: user.id });
            }
            if (!account) {
                return res.json({ success: true, entries: [] });
            }
            const entries = await LoyaltyLedger_model_1.LoyaltyLedger.find({ accountId: account._id })
                .sort({ createdAt: -1 })
                .limit(50);
            return res.json({
                success: true,
                entries,
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    // ==================== ADMIN API ====================
    /**
     * Admin: Read current loyalty program settings
     */
    static async getAdminSettings(req, res) {
        try {
            const settings = await loyalty_service_1.LoyaltyService.getSettings();
            return res.json({ success: true, settings });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Update loyalty program settings with audit log
     */
    static async updateAdminSettings(req, res) {
        try {
            const parsed = loyalty_validator_1.UpdateLoyaltySettingsSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const { programStartDate, ...rest } = parsed;
            const payload = { ...rest };
            if (programStartDate) {
                payload.programStartDate = new Date(programStartDate);
            }
            else if (programStartDate === null) {
                payload.programStartDate = undefined;
            }
            const updated = await loyalty_service_1.LoyaltyService.updateSettings(payload, adminEmail);
            return res.json({ success: true, settings: updated });
        }
        catch (err) {
            if (err.name === 'ZodError') {
                return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
            }
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: List vouchers with search, status, and source filters
     */
    static async getVouchers(req, res) {
        try {
            const { search, status, source, type, page = 1, limit = 50 } = req.query;
            const filter = {};
            if (status && status !== 'all')
                filter.status = status;
            if (source && source !== 'all')
                filter.source = source;
            if (type && type !== 'all')
                filter.discountType = type;
            if (search && typeof search === 'string' && search.trim()) {
                const q = search.trim();
                filter.$or = [
                    { code: { $regex: q, $options: 'i' } },
                    { assignedPhone: { $regex: q, $options: 'i' } },
                    { note: { $regex: q, $options: 'i' } },
                ];
            }
            const skip = (Number(page) - 1) * Number(limit);
            const total = await Voucher_model_1.Voucher.countDocuments(filter);
            const vouchers = await Voucher_model_1.Voucher.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit));
            return res.json({
                success: true,
                vouchers,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Create custom single voucher
     */
    static async createVoucher(req, res) {
        try {
            const parsed = loyalty_validator_1.CreateVoucherSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const code = parsed.code
                ? parsed.code.trim().toUpperCase()
                : voucher_service_1.VoucherService.generateVoucherCode('HB');
            const existing = await Voucher_model_1.Voucher.findOne({ code });
            if (existing) {
                return res.status(400).json({ success: false, error: 'A voucher with this code already exists' });
            }
            const voucher = await Voucher_model_1.Voucher.create({
                code,
                source: parsed.source,
                discountType: parsed.discountType,
                value: parsed.value,
                maxDiscountAmount: parsed.maxDiscountAmount,
                minOrderAmount: parsed.minOrderAmount,
                startsAt: parsed.startsAt || new Date(),
                expiresAt: parsed.expiresAt,
                usageLimitTotal: parsed.usageLimitTotal,
                usageLimitPerCustomer: parsed.usageLimitPerCustomer,
                assignedPhone: parsed.assignedPhone ? shipment_service_1.ShipmentService.normalizePhoneNumber(parsed.assignedPhone) : null,
                assignedUserId: parsed.assignedUserId || null,
                applicableProducts: parsed.applicableProducts || [],
                excludedProducts: parsed.excludedProducts || [],
                ignoreCap: parsed.ignoreCap || false,
                stackable: false,
                status: 'active',
                note: parsed.note,
                createdBy: adminEmail,
            });
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: voucher._id,
                action: 'create',
                actor: adminEmail,
                toState: voucher.toObject(),
            });
            return res.status(201).json({ success: true, voucher });
        }
        catch (err) {
            if (err.name === 'ZodError') {
                return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
            }
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Bulk generate promotional vouchers
     */
    static async bulkGenerateVouchers(req, res) {
        try {
            const parsed = loyalty_validator_1.BulkGenerateVouchersSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const prefix = parsed.prefix || 'HB';
            const count = parsed.count;
            const codes = [];
            const vouchersToInsert = [];
            const now = new Date();
            const expiresAt = new Date(now.getTime() + parsed.expiryDays * 24 * 60 * 60 * 1000);
            while (vouchersToInsert.length < count) {
                const code = voucher_service_1.VoucherService.generateVoucherCode(prefix);
                if (!codes.includes(code)) {
                    codes.push(code);
                    vouchersToInsert.push({
                        code,
                        source: 'custom',
                        discountType: parsed.discountType,
                        value: parsed.value,
                        maxDiscountAmount: parsed.maxDiscountAmount,
                        minOrderAmount: parsed.minOrderAmount,
                        startsAt: now,
                        expiresAt,
                        usageLimitTotal: parsed.usageLimitTotal ?? 1,
                        usageLimitPerCustomer: 1,
                        usedCount: 0,
                        reservedCount: 0,
                        assignedPhone: null,
                        assignedUserId: null,
                        applicableProducts: [],
                        excludedProducts: [],
                        ignoreCap: false,
                        stackable: false,
                        status: 'active',
                        note: parsed.note || 'Bulk generated campaign',
                        createdBy: adminEmail,
                    });
                }
            }
            await Voucher_model_1.Voucher.insertMany(vouchersToInsert);
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: vouchersToInsert[0]._id || 'bulk',
                action: 'bulk_create',
                actor: adminEmail,
                toState: { count, prefix, value: parsed.value },
            });
            return res.status(201).json({
                success: true,
                count: vouchersToInsert.length,
                codes,
            });
        }
        catch (err) {
            if (err.name === 'ZodError') {
                return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
            }
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Update voucher status (pause, resume, void)
     */
    static async updateVoucherStatus(req, res) {
        try {
            const id = String(req.params.id);
            const { status, reason } = req.body;
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const voucher = await Voucher_model_1.Voucher.findById(id);
            if (!voucher) {
                return res.status(404).json({ success: false, error: 'Voucher not found' });
            }
            if (status === 'voided' && (!reason || reason.trim().length < 3)) {
                return res.status(400).json({ success: false, error: 'A void reason is required.' });
            }
            const oldStatus = voucher.status;
            voucher.status = status;
            if (reason)
                voucher.voidReason = reason.trim();
            await voucher.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: voucher._id,
                action: `status_${status}`,
                actor: adminEmail,
                fromState: { status: oldStatus },
                toState: { status, reason },
            });
            return res.json({ success: true, voucher });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Extend voucher expiration date (audited)
     */
    static async extendVoucherExpiry(req, res) {
        try {
            const id = String(req.params.id);
            const parsed = loyalty_validator_1.ExtendVoucherExpirySchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const voucher = await Voucher_model_1.Voucher.findById(id);
            if (!voucher) {
                return res.status(404).json({ success: false, error: 'Voucher not found' });
            }
            const oldExpiry = voucher.expiresAt;
            if (parsed.newExpiryDate) {
                voucher.expiresAt = new Date(parsed.newExpiryDate);
            }
            else if (parsed.daysToAdd) {
                const base = voucher.expiresAt > new Date() ? voucher.expiresAt : new Date();
                voucher.expiresAt = new Date(base.getTime() + parsed.daysToAdd * 86400000);
            }
            else {
                return res.status(400).json({ success: false, error: 'Either newExpiryDate or daysToAdd must be provided' });
            }
            await voucher.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: voucher._id,
                action: 'extend_expiry',
                actor: adminEmail,
                fromState: { expiresAt: oldExpiry },
                toState: { expiresAt: voucher.expiresAt, reason: parsed.reason },
            });
            return res.json({ success: true, voucher });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Increase voucher total usage limit (audited)
     */
    static async increaseUsageLimit(req, res) {
        try {
            const id = String(req.params.id);
            const parsed = loyalty_validator_1.IncreaseUsageLimitSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const voucher = await Voucher_model_1.Voucher.findById(id);
            if (!voucher) {
                return res.status(404).json({ success: false, error: 'Voucher not found' });
            }
            const oldLimit = voucher.usageLimitTotal;
            voucher.usageLimitTotal = parsed.newUsageLimit;
            await voucher.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: voucher._id,
                action: 'increase_limit',
                actor: adminEmail,
                fromState: { usageLimitTotal: oldLimit },
                toState: { usageLimitTotal: voucher.usageLimitTotal, reason: parsed.reason },
            });
            return res.json({ success: true, voucher });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: List customer loyalty accounts with progress bars
     */
    static async getCustomers(req, res) {
        try {
            const { search, page = 1, limit = 50 } = req.query;
            const filter = {};
            if (search && typeof search === 'string' && search.trim()) {
                const q = search.trim();
                filter.$or = [
                    { phone: { $regex: q, $options: 'i' } },
                    { name: { $regex: q, $options: 'i' } },
                ];
            }
            const skip = (Number(page) - 1) * Number(limit);
            const total = await LoyaltyAccount_model_1.LoyaltyAccount.countDocuments(filter);
            const accounts = await LoyaltyAccount_model_1.LoyaltyAccount.find(filter)
                .sort({ progressBalance: -1 })
                .skip(skip)
                .limit(Number(limit));
            return res.json({
                success: true,
                accounts,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Customer detail and ledger history
     */
    static async getCustomerDetail(req, res) {
        try {
            const id = String(req.params.id);
            let account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(id);
            if (!account) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: id });
            }
            if (!account) {
                return res.status(404).json({ success: false, error: 'Loyalty account not found' });
            }
            const ledger = await LoyaltyLedger_model_1.LoyaltyLedger.find({ accountId: account._id }).sort({ createdAt: -1 });
            const vouchers = await Voucher_model_1.Voucher.find({ assignedPhone: account.phone }).sort({ createdAt: -1 });
            return res.json({
                success: true,
                account,
                ledger,
                vouchers,
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Link phone account to registered user account
     */
    static async linkCustomer(req, res) {
        try {
            const id = String(req.params.id);
            const parsed = loyalty_validator_1.LinkCustomerSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            let account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(id);
            if (!account) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: id });
            }
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }
            const updated = await loyalty_service_1.LoyaltyService.linkAccountToUser(account.phone, parsed.userId, adminEmail);
            return res.json({ success: true, account: updated });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Unlink user account from phone account
     */
    static async unlinkCustomer(req, res) {
        try {
            const id = String(req.params.id);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            let account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(id);
            if (!account) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: id });
            }
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }
            account.userId = undefined;
            await account.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'loyalty_account',
                entityId: account._id,
                action: 'unlink_user',
                actor: adminEmail,
            });
            return res.json({ success: true, account });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Manual adjustment of progress balance
     */
    static async manualAdjustment(req, res) {
        try {
            const parsed = loyalty_validator_1.ManualAdjustmentSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const idOrPhone = parsed.phone || String(req.params.id);
            let account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: idOrPhone });
            if (!account && mongoose_1.Types.ObjectId.isValid(idOrPhone)) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(idOrPhone);
            }
            if (!account) {
                return res.status(404).json({ success: false, error: 'Loyalty account not found' });
            }
            const updated = await loyalty_service_1.LoyaltyService.manualAdjustment(account._id, parsed.amount, parsed.reason, adminEmail);
            return res.json({
                success: true,
                account: updated,
                newBalance: updated.progressBalance,
            });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Rebuild account balance from ledger source of truth
     */
    static async rebuildBalance(req, res) {
        try {
            const id = String(req.params.id || req.params.phone);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            let account = null;
            if (mongoose_1.Types.ObjectId.isValid(id)) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(id);
            }
            if (!account) {
                account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: id });
            }
            if (!account) {
                return res.status(404).json({ success: false, error: 'Account not found' });
            }
            const rebuilt = await loyalty_service_1.LoyaltyService.rebuildAccountFromLedger(account._id, adminEmail);
            return res.json({ success: true, account: rebuilt });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Import past purchases via CSV/array
     */
    static async importPurchases(req, res) {
        try {
            const parsed = loyalty_validator_1.ImportPurchasesSchema.parse(req.body);
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const batchHash = parsed.batchHash || `import-${Date.now()}`;
            const result = await loyalty_service_1.LoyaltyService.importPastPurchases(parsed.rows, batchHash, adminEmail, parsed.dryRun ?? false);
            return res.json({ success: true, ...result });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: List redemptions with search and pagination
     */
    static async getRedemptions(req, res) {
        try {
            const { voucherId, search, page = 1, limit = 50 } = req.query;
            const filter = {};
            if (voucherId)
                filter.voucherId = voucherId;
            if (search && typeof search === 'string' && search.trim()) {
                const q = search.trim();
                filter.$or = [
                    { code: { $regex: q, $options: 'i' } },
                    { phone: { $regex: q, $options: 'i' } },
                    { orderNo: { $regex: q, $options: 'i' } },
                ];
            }
            const skip = (Number(page) - 1) * Number(limit);
            const total = await VoucherRedemption_model_1.VoucherRedemption.countDocuments(filter);
            const redemptions = await VoucherRedemption_model_1.VoucherRedemption.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit));
            return res.json({
                success: true,
                redemptions,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Release a reserved redemption
     */
    static async releaseRedemption(req, res) {
        try {
            const id = String(req.params.id);
            const reason = req.body.reason || 'Admin manual release';
            const redemption = await VoucherRedemption_model_1.VoucherRedemption.findById(id);
            if (!redemption) {
                return res.status(404).json({ success: false, error: 'Redemption not found' });
            }
            await voucher_service_1.VoucherService.releaseVoucher(redemption.orderId, reason);
            const updated = await VoucherRedemption_model_1.VoucherRedemption.findById(id);
            return res.json({ success: true, redemption: updated });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Review queue for flagged vouchers and redemptions
     */
    static async getReviewQueue(req, res) {
        try {
            const flaggedVouchers = await Voucher_model_1.Voucher.find({ status: 'review' }).sort({ updatedAt: -1 });
            const reversedRedemptions = await VoucherRedemption_model_1.VoucherRedemption.find({ status: 'reversed' }).sort({
                updatedAt: -1,
            });
            return res.json({
                success: true,
                vouchers: flaggedVouchers,
                queue: {
                    vouchers: flaggedVouchers,
                    redemptions: reversedRedemptions,
                    totalCount: flaggedVouchers.length + reversedRedemptions.length,
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Resolve an item in the review queue
     */
    static async resolveReviewItem(req, res) {
        try {
            const id = String(req.params.id);
            const { action, voidReason } = req.body;
            const voucher = await Voucher_model_1.Voucher.findById(id);
            if (!voucher) {
                return res.status(404).json({ success: false, error: 'Voucher not found' });
            }
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const oldStatus = voucher.status;
            if (action === 'approve') {
                voucher.status = 'active';
            }
            else if (action === 'void') {
                voucher.status = 'voided';
                voucher.voidReason = voidReason || 'Voided via review queue resolution';
            }
            await voucher.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'voucher',
                entityId: voucher._id,
                action: `review_${action}`,
                actor: adminEmail,
                fromState: { status: oldStatus },
                toState: { status: voucher.status, voidReason: voucher.voidReason },
            });
            return res.json({ success: true, voucher });
        }
        catch (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Overview metrics for loyalty dashboard
     */
    static async getOverviewMetrics(req, res) {
        try {
            const now = new Date();
            const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            const settings = await loyalty_service_1.LoyaltyService.getSettings();
            const activeVouchersCount = await Voucher_model_1.Voucher.countDocuments({
                status: 'active',
                expiresAt: { $gt: now },
            });
            const expiring7DaysCount = await Voucher_model_1.Voucher.countDocuments({
                status: 'active',
                expiresAt: { $gt: now, $lte: in7Days },
            });
            const reviewQueueCount = (await Voucher_model_1.Voucher.countDocuments({ status: 'review' })) +
                (await VoucherRedemption_model_1.VoucherRedemption.countDocuments({ status: 'reversed' }));
            const totalLoyaltyAccounts = await LoyaltyAccount_model_1.LoyaltyAccount.countDocuments();
            const totalVouchersIssued = await Voucher_model_1.Voucher.countDocuments();
            const totalVouchersRedeemed = await VoucherRedemption_model_1.VoucherRedemption.countDocuments({ status: 'redeemed' });
            const redemptionsAgg = await VoucherRedemption_model_1.VoucherRedemption.aggregate([
                { $match: { status: 'redeemed' } },
                { $group: { _id: null, totalDiscount: { $sum: '$discountAmount' } } },
            ]);
            const totalDiscountGivenTaka = redemptionsAgg[0]?.totalDiscount || 0;
            const activeVouchers = await Voucher_model_1.Voucher.find({ status: 'active', expiresAt: { $gt: now } });
            const outstandingVoucherLiabilityTaka = activeVouchers.reduce((sum, v) => sum + (v.discountType === 'fixed' ? v.value : 0), 0);
            const expiredUnusedCount = await Voucher_model_1.Voucher.countDocuments({
                status: { $in: ['expired', 'active'] },
                expiresAt: { $lte: now },
                usedCount: 0,
            });
            const threshold80 = Math.floor(settings.targetAmount * 0.8);
            const customersClose = await LoyaltyAccount_model_1.LoyaltyAccount.find({
                progressBalance: { $gte: threshold80, $lt: settings.targetAmount },
            })
                .sort({ progressBalance: -1 })
                .limit(10);
            const expiringSoonList = await Voucher_model_1.Voucher.find({
                status: 'active',
                expiresAt: { $gt: now, $lte: in7Days },
            })
                .sort({ expiresAt: 1 })
                .limit(10);
            return res.json({
                success: true,
                metrics: {
                    totalLoyaltyAccounts,
                    activeLoyaltyVouchers: activeVouchersCount,
                    activeVouchersCount,
                    totalVouchersIssued,
                    totalVouchersRedeemed,
                    totalDiscountGivenTaka,
                    outstandingVoucherLiabilityTaka,
                    expiredUnusedCount,
                    expiring7DaysCount,
                    reviewQueueCount,
                    vouchersInReviewCount: reviewQueueCount,
                    targetAmount: settings.targetAmount,
                    rewardAmount: settings.rewardAmount,
                    customersClose,
                    expiringSoonList,
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Loyalty and voucher audit log
     */
    static async getAuditLogs(req, res) {
        try {
            const { page = 1, limit = 50, entityType } = req.query;
            const filter = {
                entityType: entityType || {
                    $in: ['loyalty_settings', 'loyalty_account', 'voucher', 'voucher_redemption'],
                },
            };
            const skip = (Number(page) - 1) * Number(limit);
            const total = await AuditLog_model_1.AuditLog.countDocuments(filter);
            const logs = await AuditLog_model_1.AuditLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit));
            return res.json({
                success: true,
                logs,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: Retroactive Sales Backfill
     */
    static async backfillDeliveredSales(req, res) {
        try {
            const adminEmail = req.adminEmail || req.user?.email || 'admin';
            const result = await loyalty_service_1.LoyaltyService.backfillDeliveredSales(adminEmail);
            return res.json({
                success: true,
                ...result,
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Admin: View SMS/WhatsApp notification queue
     */
    static async getNotificationQueue(req, res) {
        try {
            const { page = 1, limit = 50, status } = req.query;
            const filter = {};
            if (status)
                filter.status = status;
            const skip = (Number(page) - 1) * Number(limit);
            const total = await NotificationQueue_model_1.NotificationQueue.countDocuments(filter);
            const notifications = await NotificationQueue_model_1.NotificationQueue.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit));
            return res.json({
                success: true,
                notifications,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    totalPages: Math.ceil(total / Number(limit)),
                },
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    /**
     * Customer: Link unlinked past purchases by phone number
     */
    static async customerLinkPastAccount(req, res) {
        try {
            const user = req.user;
            if (!user?.id) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { phone } = req.body;
            const cleanPhone = phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(phone) : undefined;
            if (!cleanPhone) {
                return res.status(400).json({ success: false, error: 'Valid phone number required' });
            }
            const account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: cleanPhone });
            if (!account) {
                return res.status(404).json({ success: false, error: 'No account found for this phone number' });
            }
            account.userId = user.id;
            await account.save();
            await AuditLog_model_1.AuditLog.create({
                entityType: 'loyalty_account',
                entityId: account._id,
                action: 'customer_link_past_purchases',
                actor: user.email || cleanPhone,
                toState: { userId: user.id },
                metadata: { phone: cleanPhone },
            });
            return res.json({ success: true, account });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
}
exports.LoyaltyController = LoyaltyController;
