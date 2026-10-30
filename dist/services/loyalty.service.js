"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoyaltyService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const LoyaltySettings_model_1 = require("../models/LoyaltySettings.model");
const LoyaltyAccount_model_1 = require("../models/LoyaltyAccount.model");
const LoyaltyLedger_model_1 = require("../models/LoyaltyLedger.model");
const Voucher_model_1 = require("../models/Voucher.model");
const AuditLog_model_1 = require("../models/AuditLog.model");
const NotificationQueue_model_1 = require("../models/NotificationQueue.model");
const Sale_model_1 = require("../models/Sale.model");
const PreOrder_model_1 = require("../models/PreOrder.model");
const voucher_service_1 = require("./voucher.service");
const shipment_service_1 = require("./shipment.service");
class LoyaltyService {
    /**
     * Retrieves active Loyalty Program Settings (creates default if missing)
     */
    static async getSettings() {
        let settings = await LoyaltySettings_model_1.LoyaltySettings.findOne();
        if (!settings) {
            settings = await LoyaltySettings_model_1.LoyaltySettings.create({
                loyaltyEnabled: true,
                targetAmount: 4000,
                rewardAmount: 250,
                minOrderToRedeem: 2000,
                voucherExpiryDays: 90,
                holdDays: 3,
                carryOver: true,
                maxDiscountPercentOfOrder: 15,
                countDeliveryAndCodFees: false,
                includedProducts: [],
                maxActiveLoyaltyVouchersPerCustomer: 3,
                onReturnAfterIssue: 'flag_only',
                autoLinkByPhone: false,
                welcomeProgressAmount: 0,
                updatedBy: 'system',
            });
        }
        return settings;
    }
    /**
     * Updates Loyalty Program Settings with audit trail logging
     */
    static async updateSettings(newValues, adminEmail) {
        const current = await this.getSettings();
        const oldState = current.toObject();
        // Validate logic constraints
        const target = newValues.targetAmount ?? current.targetAmount;
        const reward = newValues.rewardAmount ?? current.rewardAmount;
        const minOrder = newValues.minOrderToRedeem ?? current.minOrderToRedeem;
        if (reward >= target) {
            throw new Error('Reward amount must be less than the target spending amount.');
        }
        if (minOrder < reward) {
            throw new Error('Minimum order to redeem must be greater than or equal to reward amount.');
        }
        Object.assign(current, newValues, { updatedBy: adminEmail });
        await current.save();
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_settings',
            entityId: current._id,
            action: 'update_settings',
            actor: adminEmail,
            fromState: oldState,
            toState: current.toObject(),
            metadata: { changedFields: Object.keys(newValues) },
        });
        return current;
    }
    /**
     * Gets or initializes a customer loyalty account by normalized phone number
     */
    static async getOrCreateAccount(phone, name, userId, session) {
        const cleanPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(phone);
        if (!cleanPhone || cleanPhone.length < 10) {
            throw new Error('Valid Bangladeshi phone number is required.');
        }
        let account = await LoyaltyAccount_model_1.LoyaltyAccount.findOne({ phone: cleanPhone }).session(session || null);
        if (!account) {
            const settings = await this.getSettings();
            const initialWelcome = settings.welcomeProgressAmount || 0;
            const [created] = await LoyaltyAccount_model_1.LoyaltyAccount.create([
                {
                    phone: cleanPhone,
                    userId: userId || null,
                    name: name?.trim() || 'Valued Customer',
                    progressBalance: initialWelcome,
                    pendingAmount: 0,
                    lifetimeEligibleSpend: 0,
                    vouchersIssuedCount: 0,
                    issueSeq: 0,
                },
            ], { session });
            account = created;
            if (initialWelcome > 0) {
                await LoyaltyLedger_model_1.LoyaltyLedger.create([
                    {
                        accountId: account._id,
                        type: 'welcome',
                        amount: initialWelcome,
                        reason: 'Welcome bonus progress',
                        createdBy: 'system',
                    },
                ], { session });
            }
        }
        else {
            // Auto-link by phone if enabled and account has no linked user
            const settings = await this.getSettings();
            if (settings.autoLinkByPhone && !account.userId && userId) {
                account.userId = userId;
                if (name && (!account.name || account.name === 'Valued Customer')) {
                    account.name = name.trim();
                }
                await account.save({ session });
            }
        }
        return account;
    }
    /**
     * Links a loyalty account to an authenticated user ID (audited)
     */
    static async linkAccountToUser(accountId, userId, adminEmail) {
        const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(accountId);
        if (!account) {
            throw new Error('Loyalty account not found.');
        }
        const previousUserId = account.userId;
        account.userId = userId;
        await account.save();
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_account',
            entityId: account._id,
            action: 'link_user',
            actor: adminEmail,
            fromState: { userId: previousUserId },
            toState: { userId },
            metadata: { phone: account.phone },
        });
        return account;
    }
    /**
     * Unlinks a loyalty account from a user ID (audited)
     */
    static async unlinkAccount(accountId, adminEmail) {
        const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(accountId);
        if (!account) {
            throw new Error('Loyalty account not found.');
        }
        const previousUserId = account.userId;
        account.userId = null;
        await account.save();
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_account',
            entityId: account._id,
            action: 'unlink_user',
            actor: adminEmail,
            fromState: { userId: previousUserId },
            toState: { userId: null },
            metadata: { phone: account.phone },
        });
        return account;
    }
    /**
     * Triggers when an order (Sale or PreOrder fulfilled) is delivered to customer.
     * Calculates eligible product spend and appends earn_pending ledger entry with maturity date.
     */
    static async recordOrderDelivery(order, orderType, session) {
        const settings = await this.getSettings();
        if (!settings.loyaltyEnabled) {
            return { earned: false, pendingAmount: 0, message: 'Loyalty program currently disabled' };
        }
        const phone = order.customerPhone || order.recipientPhone;
        if (!phone) {
            return { earned: false, pendingAmount: 0, message: 'Order has no customer phone number' };
        }
        const orderId = order._id.toString();
        const orderNo = order.orderNo || order.preOrderNo || orderId;
        // 1. Check if delivery has already earned (Idempotency)
        const existingEarn = await LoyaltyLedger_model_1.LoyaltyLedger.findOne({
            orderId,
            type: { $in: ['earn_pending', 'earn_eligible'] },
        }).session(session || null);
        if (existingEarn) {
            return { earned: false, pendingAmount: 0, message: 'Order delivery already credited' };
        }
        // 2. Calculate actual spend on goods (after discount allocation)
        let eligibleSpend = 0;
        const items = order.items || [];
        for (const it of items) {
            const codeOrSlug = it.productCode || it.product?.toString() || '';
            // Check included products filter
            if (settings.includedProducts && settings.includedProducts.length > 0) {
                const isIncluded = settings.includedProducts.some((p) => p === codeOrSlug || p === it.productName);
                if (!isIncluded)
                    continue;
            }
            const itemTotal = it.sellingPrice || it.quotedPrice || 0;
            const discount = it.discountAllocated || 0;
            const netPaid = Math.max(0, itemTotal - discount);
            eligibleSpend += netPaid;
        }
        // Add delivery & COD fees only if explicitly enabled in settings
        if (settings.countDeliveryAndCodFees) {
            const courierFee = order.courierCharge || 0;
            eligibleSpend += courierFee;
        }
        eligibleSpend = Math.floor(eligibleSpend);
        if (eligibleSpend <= 0) {
            return { earned: false, pendingAmount: 0, message: 'No eligible product spend on order' };
        }
        // 3. Mark deliveredAt on order if not set
        if (!order.deliveredAt) {
            order.deliveredAt = new Date();
            await order.save({ session });
        }
        // 4. Redeem any voucher used on this order
        await voucher_service_1.VoucherService.redeemVoucher(orderId, session);
        // 5. Get or create customer loyalty account
        const account = await this.getOrCreateAccount(phone, order.customerName, order.userId, session);
        // 6. Calculate hold maturity date: now + holdDays
        const holdDays = settings.holdDays || 0;
        const eligibleAt = new Date(Date.now() + holdDays * 24 * 60 * 60 * 1000);
        // 7. Insert append-only earn_pending ledger record
        await LoyaltyLedger_model_1.LoyaltyLedger.create([
            {
                accountId: account._id,
                type: 'earn_pending',
                amount: eligibleSpend,
                orderType,
                orderId,
                orderNo,
                eligibleAt,
                reason: `Delivered order spend (Hold: ${holdDays} days)`,
                createdBy: 'system',
            },
        ], { session });
        // 8. Update cached pending amount
        account.pendingAmount = (account.pendingAmount || 0) + eligibleSpend;
        await account.save({ session });
        // 9. If holdDays is 0, immediately mature and check for vouchers
        if (holdDays === 0) {
            await this.processMaturedHoldEntries();
        }
        return {
            earned: true,
            pendingAmount: eligibleSpend,
            message: `Credited ৳${eligibleSpend.toLocaleString()} pending progress`,
        };
    }
    /**
     * Records eligible product spend for a customer order immediately.
     * Strictly counts product price (excluding delivery cost).
     */
    static async recordOrderSpend(order, orderType, session) {
        const settings = await this.getSettings();
        if (!settings.loyaltyEnabled) {
            return { earned: false, creditedAmount: 0, message: 'Loyalty program currently disabled' };
        }
        const rawPhone = order.customerPhone || order.recipientPhone || order.customer?.phone;
        if (!rawPhone) {
            return { earned: false, creditedAmount: 0, message: 'Order has no customer phone number' };
        }
        const cleanPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(rawPhone);
        const orderId = order._id ? order._id.toString() : (order.orderId || order.id);
        const orderNo = order.orderNo || order.preOrderNo || order.orderId || orderId;
        const idempotencyKey = order.idempotencyKey;
        const queryIds = [orderId, orderNo];
        if (idempotencyKey)
            queryIds.push(idempotencyKey);
        // Check if order spend has already been credited (idempotency)
        const existingEarn = await LoyaltyLedger_model_1.LoyaltyLedger.findOne({
            $or: [
                { orderId: { $in: queryIds } },
                { orderNo: { $in: queryIds } },
            ],
            type: { $in: ['earn_pending', 'earn_eligible'] },
        }).session(session || null);
        if (existingEarn) {
            return { earned: false, creditedAmount: 0, message: 'Order spend already credited' };
        }
        // Calculate actual spend on products only (subtotal minus discounts, strictly excluding delivery)
        let eligibleSpend = 0;
        const items = order.items || [];
        for (const it of items) {
            const itemPrice = it.sellingPrice ||
                it.lineTotal ||
                it.quotedPrice ||
                ((it.price || 0) * (it.quantity || 1)) ||
                0;
            const discount = it.discountAllocated || 0;
            const netPaid = Math.max(0, itemPrice - discount);
            eligibleSpend += netPaid;
        }
        // Fallback to order subtotal if items array was empty or had 0 prices
        if (eligibleSpend === 0 && order.subtotal && order.subtotal > 0) {
            const discount = order.discountTotal || 0;
            eligibleSpend = Math.max(0, order.subtotal - discount);
        }
        eligibleSpend = Math.floor(eligibleSpend);
        if (eligibleSpend <= 0) {
            return { earned: false, creditedAmount: 0, message: 'No eligible product spend on order' };
        }
        // Get or create customer loyalty account
        const customerName = order.customerName || order.recipientName || order.customer?.name;
        const userId = order.userId;
        const account = await this.getOrCreateAccount(cleanPhone, customerName, userId, session);
        // Insert append-only earn_eligible ledger record
        await LoyaltyLedger_model_1.LoyaltyLedger.create([
            {
                accountId: account._id,
                type: 'earn_eligible',
                amount: eligibleSpend,
                orderType,
                orderId,
                orderNo,
                eligibleAt: new Date(),
                reason: `Product purchase spend for order ${orderNo} (excluding delivery fee)`,
                createdBy: 'system',
            },
        ], { session });
        // Update account balances immediately
        account.progressBalance = (account.progressBalance || 0) + eligibleSpend;
        account.lifetimeEligibleSpend = (account.lifetimeEligibleSpend || 0) + eligibleSpend;
        if (userId && !account.userId) {
            account.userId = userId;
        }
        await account.save({ session });
        // Check if milestone is reached and issue voucher
        try {
            if (session) {
                await this.checkAndIssueVouchers(account, session);
            }
            else {
                const localSession = await mongoose_1.default.startSession();
                localSession.startTransaction();
                try {
                    const sessAccount = await LoyaltyAccount_model_1.LoyaltyAccount.findById(account._id).session(localSession);
                    if (sessAccount) {
                        await this.checkAndIssueVouchers(sessAccount, localSession);
                    }
                    await localSession.commitTransaction();
                }
                catch {
                    await localSession.abortTransaction();
                }
                finally {
                    localSession.endSession();
                }
            }
        }
        catch {
            // Voucher issuing error should not fail spend recording
        }
        return {
            earned: true,
            creditedAmount: eligibleSpend,
            message: `Credited ৳${eligibleSpend.toLocaleString()} towards rewards`,
        };
    }
    /**
     * Syncs all uncredited orders for a customer (by phone or userId).
     * Ensures any past orders immediately count toward user sales/vouchers.
     */
    static async syncCustomerOrdersSpend(account, phone, userId) {
        const cleanPhone = phone ? shipment_service_1.ShipmentService.normalizePhoneNumber(phone) : account.phone;
        let totalCredited = 0;
        // Load existing ledgers to avoid duplicate processing
        const creditedKeys = new Set();
        const existingLedgers = await LoyaltyLedger_model_1.LoyaltyLedger.find({
            accountId: account._id,
            type: { $in: ['earn_pending', 'earn_eligible'] },
        });
        for (const l of existingLedgers) {
            if (l.orderId)
                creditedKeys.add(l.orderId.toString());
            if (l.orderNo)
                creditedKeys.add(l.orderNo.toString());
        }
        // 1. Sync from Mongo 'orders' collection first (primary customer order record)
        const db = mongoose_1.default.connection.db;
        if (db) {
            const orderFilter = [];
            if (cleanPhone)
                orderFilter.push({ 'customer.phone': cleanPhone });
            if (userId)
                orderFilter.push({ userId });
            if (orderFilter.length > 0) {
                const orders = await db.collection('orders').find({ $or: orderFilter }).toArray();
                for (const ord of orders) {
                    const ordId = (ord.orderId || ord._id?.toString() || '').toString();
                    if (creditedKeys.has(ordId) || (ord.idempotencyKey && creditedKeys.has(ord.idempotencyKey))) {
                        continue;
                    }
                    const res = await this.recordOrderSpend(ord, ord.orderType || 'sale');
                    if (res.earned) {
                        totalCredited += res.creditedAmount;
                        creditedKeys.add(ordId);
                        if (ord.idempotencyKey)
                            creditedKeys.add(ord.idempotencyKey);
                        if (ord._id)
                            creditedKeys.add(ord._id.toString());
                    }
                }
            }
        }
        // 2. Sync from Sale collection (for sales not already recorded from orders)
        const saleFilter = [];
        if (cleanPhone) {
            saleFilter.push({ customerPhone: cleanPhone }, { recipientPhone: cleanPhone });
        }
        if (userId)
            saleFilter.push({ userId });
        if (saleFilter.length > 0) {
            const sales = await Sale_model_1.Sale.find({ $or: saleFilter });
            for (const s of sales) {
                const sId = s._id.toString();
                const sNo = s.orderNo || sId;
                const sIdemp = s.idempotencyKey;
                if (creditedKeys.has(sId) || creditedKeys.has(sNo) || (sIdemp && creditedKeys.has(sIdemp))) {
                    continue;
                }
                // If this sale has an idempotencyKey that matches an online order from 'orders' collection, skip
                if (db && sIdemp) {
                    const matchOrder = await db.collection('orders').findOne({ idempotencyKey: sIdemp });
                    if (matchOrder) {
                        creditedKeys.add(sId);
                        creditedKeys.add(sNo);
                        creditedKeys.add(sIdemp);
                        continue;
                    }
                }
                const res = await this.recordOrderSpend(s, 'sale');
                if (res.earned) {
                    totalCredited += res.creditedAmount;
                    creditedKeys.add(sId);
                    creditedKeys.add(sNo);
                    if (sIdemp)
                        creditedKeys.add(sIdemp);
                }
            }
        }
        // 3. Sync from PreOrder collection
        const preOrderFilter = [];
        if (cleanPhone) {
            preOrderFilter.push({ customerPhone: cleanPhone }, { recipientPhone: cleanPhone });
        }
        if (userId)
            preOrderFilter.push({ userId });
        if (preOrderFilter.length > 0) {
            const preOrders = await PreOrder_model_1.PreOrder.find({ $or: preOrderFilter });
            for (const po of preOrders) {
                const poId = po._id.toString();
                const poNo = po.preOrderNo || poId;
                const poIdemp = po.idempotencyKey;
                if (creditedKeys.has(poId) || creditedKeys.has(poNo) || (poIdemp && creditedKeys.has(poIdemp))) {
                    continue;
                }
                const res = await this.recordOrderSpend(po, 'preorder');
                if (res.earned) {
                    totalCredited += res.creditedAmount;
                    creditedKeys.add(poId);
                    creditedKeys.add(poNo);
                    if (poIdemp)
                        creditedKeys.add(poIdemp);
                }
            }
        }
        return totalCredited;
    }
    /**
     * Processes all pending ledger entries that have passed their holdDays maturity date.
     * Runs lazily or on hourly cron.
     */
    static async processMaturedHoldEntries() {
        const now = new Date();
        const maturedEntries = await LoyaltyLedger_model_1.LoyaltyLedger.find({
            type: 'earn_pending',
            eligibleAt: { $lte: now },
        });
        if (maturedEntries.length === 0) {
            return { processedCount: 0, vouchersIssued: 0 };
        }
        let processedCount = 0;
        let vouchersIssued = 0;
        for (const entry of maturedEntries) {
            const session = await mongoose_1.default.startSession();
            session.startTransaction();
            try {
                const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(entry.accountId).session(session);
                if (!account) {
                    await session.abortTransaction();
                    session.endSession();
                    continue;
                }
                // 1. Transition ledger entry to earn_eligible
                entry.type = 'earn_eligible';
                await entry.save({ session });
                // 2. Adjust account balances
                account.pendingAmount = Math.max(0, (account.pendingAmount || 0) - entry.amount);
                account.progressBalance = (account.progressBalance || 0) + entry.amount;
                account.lifetimeEligibleSpend = (account.lifetimeEligibleSpend || 0) + entry.amount;
                await account.save({ session });
                // 3. Check and issue vouchers if threshold reached
                const issued = await this.checkAndIssueVouchers(account, session);
                vouchersIssued += issued;
                await session.commitTransaction();
                session.endSession();
                processedCount++;
            }
            catch (err) {
                await session.abortTransaction();
                session.endSession();
            }
        }
        return { processedCount, vouchersIssued };
    }
    /**
     * Checks if an account's progressBalance satisfies targetAmount and issues vouchers.
     * Strictly transactional with atomic issueSeq sequence numbering to prevent duplicate issuance.
     */
    static async checkAndIssueVouchers(account, session) {
        const settings = await this.getSettings();
        if (!settings.loyaltyEnabled)
            return 0;
        const target = settings.targetAmount;
        const reward = settings.rewardAmount;
        const minOrder = settings.minOrderToRedeem;
        const expiryDays = settings.voucherExpiryDays;
        const maxActive = settings.maxActiveLoyaltyVouchersPerCustomer || 3;
        let issuedCount = 0;
        // Check active vouchers count for this customer
        const activeCount = await Voucher_model_1.Voucher.countDocuments({
            assignedPhone: account.phone,
            status: 'active',
            expiresAt: { $gt: new Date() },
        }).session(session);
        let currentActive = activeCount;
        while (account.progressBalance >= target) {
            if (currentActive >= maxActive) {
                // Customer reached active voucher cap; hold balance for future cycle
                break;
            }
            // 1. Increment sequence counter
            account.issueSeq += 1;
            account.progressBalance -= target;
            account.vouchersIssuedCount += 1;
            // 2. Generate unique voucher code
            const code = voucher_service_1.VoucherService.generateVoucherCode('HB');
            const now = new Date();
            const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
            // 3. Create loyalty voucher
            await Voucher_model_1.Voucher.create([
                {
                    code,
                    source: 'loyalty',
                    discountType: 'fixed',
                    value: reward,
                    minOrderAmount: minOrder,
                    startsAt: now,
                    expiresAt,
                    usageLimitTotal: 1,
                    usageLimitPerCustomer: 1,
                    usedCount: 0,
                    reservedCount: 0,
                    assignedPhone: account.phone,
                    assignedUserId: account.userId || null,
                    applicableProducts: settings.includedProducts || [],
                    excludedProducts: [],
                    ignoreCap: false,
                    stackable: false,
                    status: 'active',
                    note: `Earned via Loyalty Progress (৳${target.toLocaleString()} delivered spend achieved)`,
                    createdBy: 'system',
                    snapshot: {
                        targetAmount: target,
                        rewardAmount: reward,
                        minOrderToRedeem: minOrder,
                        voucherExpiryDays: expiryDays,
                        issuedAt: now.toISOString(),
                    },
                },
            ], { session });
            // 4. Record voucher_issue in ledger
            await LoyaltyLedger_model_1.LoyaltyLedger.create([
                {
                    accountId: account._id,
                    type: 'voucher_issue',
                    amount: -target,
                    reason: `Issued ৳${reward} loyalty voucher (${code})`,
                    createdBy: 'system',
                },
            ], { session });
            // 5. Enqueue Bengali notification
            const dateStr = expiresAt.toLocaleDateString('en-GB');
            const issueMessage = `অভিনন্দন! হাটখোলা বাজারে ৳${target} কেনাকাটা সম্পূর্ণ করায় আপনি পেয়েছেন ৳${reward} এর একটি ভাউচার (কোড: ${code})। ন্যূনতম ৳${minOrder} এর অর্ডারে এটি ব্যবহার করতে পারবেন। মেয়াদ ${dateStr} পর্যন্ত।`;
            await NotificationQueue_model_1.NotificationQueue.create([
                {
                    phone: account.phone,
                    type: 'voucher_issued',
                    channel: 'sms',
                    message: issueMessage,
                    metadata: {
                        voucherCode: code,
                        voucherAmount: reward,
                        targetAmount: target,
                        expiresAt,
                    },
                    status: 'queued',
                },
            ], { session });
            issuedCount++;
            currentActive++;
            // If carry-over is disabled, reset remainder to 0 after first voucher
            if (!settings.carryOver) {
                account.progressBalance = 0;
                break;
            }
        }
        await account.save({ session });
        return issuedCount;
    }
    /**
     * Handles order return or cancellation after delivery.
     * Writes a reversal ledger entry, deducts from progressBalance (may go negative),
     * and handles voucher revocation per onReturnAfterIssue policy.
     */
    static async handleOrderReversal(orderId, orderType, reason = 'Order returned / reversed', adminEmail = 'admin') {
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            const orderIdStr = orderId.toString();
            // 1. Find the original delivery earning entry
            const earnEntry = await LoyaltyLedger_model_1.LoyaltyLedger.findOne({
                orderId: orderIdStr,
                type: { $in: ['earn_pending', 'earn_eligible'] },
            }).session(session);
            if (!earnEntry) {
                await session.abortTransaction();
                session.endSession();
                return { reversed: false, amountReversed: 0, message: 'No earned progress found for order' };
            }
            // Check if already reversed
            const existingReversal = await LoyaltyLedger_model_1.LoyaltyLedger.findOne({
                orderId: orderIdStr,
                type: 'reversal',
            }).session(session);
            if (existingReversal) {
                await session.abortTransaction();
                session.endSession();
                return { reversed: false, amountReversed: 0, message: 'Order has already been reversed' };
            }
            const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(earnEntry.accountId).session(session);
            if (!account) {
                await session.abortTransaction();
                session.endSession();
                return { reversed: false, amountReversed: 0, message: 'Loyalty account not found' };
            }
            const reversalAmount = earnEntry.amount;
            // 2. Append reversal ledger entry
            await LoyaltyLedger_model_1.LoyaltyLedger.create([
                {
                    accountId: account._id,
                    type: 'reversal',
                    amount: -reversalAmount,
                    orderType,
                    orderId: orderIdStr,
                    orderNo: earnEntry.orderNo,
                    reason: `Reversal: ${reason}`,
                    createdBy: adminEmail,
                },
            ], { session });
            // 3. Deduct from account balance
            if (earnEntry.type === 'earn_pending') {
                account.pendingAmount = Math.max(0, (account.pendingAmount || 0) - reversalAmount);
            }
            else {
                // May go negative; customer must earn it back
                account.progressBalance = (account.progressBalance || 0) - reversalAmount;
                account.lifetimeEligibleSpend = Math.max(0, (account.lifetimeEligibleSpend || 0) - reversalAmount);
            }
            await account.save({ session });
            // 4. Reverse any voucher used on this order
            await voucher_service_1.VoucherService.reverseVoucher(orderIdStr, reason, session);
            // 5. Evaluate onReturnAfterIssue policy
            const settings = await this.getSettings();
            // Check if this order contributed to a voucher
            const vouchersIssued = await Voucher_model_1.Voucher.find({
                assignedPhone: account.phone,
                source: 'loyalty',
                createdAt: { $gte: earnEntry.createdAt },
            }).session(session);
            for (const v of vouchersIssued) {
                if (settings.onReturnAfterIssue === 'revoke_if_unused' && v.usedCount === 0 && v.status === 'active') {
                    v.status = 'voided';
                    v.voidReason = `Auto-revoked due to return on order #${earnEntry.orderNo || orderIdStr}`;
                    await v.save({ session });
                }
                else {
                    // flag_only
                    v.status = 'review';
                    v.note = `${v.note || ''} [FLAGGED: Associated order #${earnEntry.orderNo || orderIdStr} was returned]`;
                    await v.save({ session });
                }
            }
            await session.commitTransaction();
            session.endSession();
            return {
                reversed: true,
                amountReversed: reversalAmount,
                message: `Reversed ৳${reversalAmount.toLocaleString()} progress successfully`,
            };
        }
        catch (err) {
            await session.abortTransaction();
            session.endSession();
            throw err;
        }
    }
    /**
     * Rebuilds a customer loyalty account derived strictly from their append-only ledger.
     */
    static async rebuildAccountFromLedger(accountId, adminEmail) {
        const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(accountId);
        if (!account) {
            throw new Error('Loyalty account not found.');
        }
        const ledgerEntries = await LoyaltyLedger_model_1.LoyaltyLedger.find({ accountId: account._id }).sort({ createdAt: 1 });
        let progressBalance = 0;
        let pendingAmount = 0;
        let lifetimeEligibleSpend = 0;
        let vouchersIssuedCount = 0;
        const now = new Date();
        for (const entry of ledgerEntries) {
            switch (entry.type) {
                case 'earn_pending':
                    if (entry.eligibleAt && new Date(entry.eligibleAt) <= now) {
                        progressBalance += entry.amount;
                        lifetimeEligibleSpend += entry.amount;
                    }
                    else {
                        pendingAmount += entry.amount;
                    }
                    break;
                case 'earn_eligible':
                case 'welcome':
                case 'import':
                case 'manual_credit':
                    progressBalance += entry.amount;
                    lifetimeEligibleSpend += Math.max(0, entry.amount);
                    break;
                case 'reversal':
                case 'manual_debit':
                    progressBalance += entry.amount; // entry.amount is negative
                    break;
                case 'voucher_issue':
                    vouchersIssuedCount += 1;
                    break;
            }
        }
        const oldState = {
            progressBalance: account.progressBalance,
            pendingAmount: account.pendingAmount,
            lifetimeEligibleSpend: account.lifetimeEligibleSpend,
        };
        account.progressBalance = progressBalance;
        account.pendingAmount = Math.max(0, pendingAmount);
        account.lifetimeEligibleSpend = Math.max(0, lifetimeEligibleSpend);
        account.vouchersIssuedCount = vouchersIssuedCount;
        await account.save();
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_account',
            entityId: account._id,
            action: 'rebuild_balance',
            actor: adminEmail,
            fromState: oldState,
            toState: { progressBalance, pendingAmount, lifetimeEligibleSpend },
            metadata: { totalLedgerEntries: ledgerEntries.length },
        });
        return account;
    }
    /**
     * Manual credit or debit adjustment to customer progress
     */
    static async manualAdjustment(accountId, amount, // positive for credit, negative for debit
    reason, adminEmail) {
        if (!reason || reason.trim().length < 5) {
            throw new Error('A detailed reason is required for manual adjustments (minimum 5 characters).');
        }
        const account = await LoyaltyAccount_model_1.LoyaltyAccount.findById(accountId);
        if (!account) {
            throw new Error('Loyalty account not found.');
        }
        const type = amount >= 0 ? 'manual_credit' : 'manual_debit';
        const session = await mongoose_1.default.startSession();
        session.startTransaction();
        try {
            // 1. Record in append-only ledger
            await LoyaltyLedger_model_1.LoyaltyLedger.create([
                {
                    accountId: account._id,
                    type,
                    amount,
                    reason: `Manual adjustment by ${adminEmail}: ${reason.trim()}`,
                    createdBy: adminEmail,
                },
            ], { session });
            // 2. Adjust account balance
            account.progressBalance += amount;
            if (amount > 0) {
                account.lifetimeEligibleSpend += amount;
                // Check if eligible for vouchers
                await this.checkAndIssueVouchers(account, session);
            }
            await account.save({ session });
            // 3. Audit log
            await AuditLog_model_1.AuditLog.create([
                {
                    entityType: 'loyalty_account',
                    entityId: account._id,
                    action: 'manual_adjustment',
                    actor: adminEmail,
                    metadata: { amount, reason: reason.trim(), type },
                },
            ], { session });
            await session.commitTransaction();
            session.endSession();
            return account;
        }
        catch (err) {
            await session.abortTransaction();
            session.endSession();
            throw err;
        }
    }
    /**
     * Imports past purchases from CSV.
     * Dry-run provides validation preview; execution is idempotent using batchHash.
     */
    static async importPastPurchases(rows, batchHash, adminEmail, dryRun = true) {
        // 1. Verify idempotency
        const existingImport = await AuditLog_model_1.AuditLog.findOne({
            entityType: 'loyalty_account',
            action: 'import_purchases',
            'metadata.batchHash': batchHash,
        });
        if (existingImport) {
            throw new Error('This import batch has already been processed (duplicate batch hash).');
        }
        const errors = [];
        const preview = [];
        let validCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            const normPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(r.phone);
            const amount = Math.floor(Number(r.amount));
            if (!normPhone || normPhone.length < 10) {
                errors.push({ row: i + 1, phone: r.phone, error: 'Invalid phone number format' });
                continue;
            }
            if (isNaN(amount) || amount <= 0) {
                errors.push({ row: i + 1, phone: r.phone, error: 'Amount must be a positive integer' });
                continue;
            }
            preview.push({
                phone: normPhone,
                name: r.name || 'Customer',
                amount,
                status: 'Valid',
            });
            validCount++;
        }
        if (dryRun) {
            return {
                dryRun: true,
                totalRows: rows.length,
                validRows: validCount,
                invalidRows: errors.length,
                errors,
                preview: preview.slice(0, 50), // Sample 50
            };
        }
        // Execution
        for (const p of preview) {
            const session = await mongoose_1.default.startSession();
            session.startTransaction();
            try {
                const account = await this.getOrCreateAccount(p.phone, p.name, null, session);
                // Past purchases are eligible immediately
                await LoyaltyLedger_model_1.LoyaltyLedger.create([
                    {
                        accountId: account._id,
                        type: 'import',
                        amount: p.amount,
                        reason: `Batch import: ${batchHash.slice(0, 8)}`,
                        createdBy: adminEmail,
                    },
                ], { session });
                account.progressBalance += p.amount;
                account.lifetimeEligibleSpend += p.amount;
                await account.save({ session });
                await this.checkAndIssueVouchers(account, session);
                await session.commitTransaction();
                session.endSession();
            }
            catch {
                await session.abortTransaction();
                session.endSession();
            }
        }
        // Record audit entry
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_account',
            entityId: batchHash,
            action: 'import_purchases',
            actor: adminEmail,
            metadata: {
                batchHash,
                totalRows: rows.length,
                importedCount: validCount,
            },
        });
        return {
            dryRun: false,
            totalRows: rows.length,
            validRows: validCount,
            invalidRows: errors.length,
            errors,
            preview: preview.slice(0, 50),
        };
    }
    /**
     * Enqueues a notification if customer spend is within 10% of target progress.
     */
    static async checkApproachingThresholdNotification(account, session) {
        const settings = await this.getSettings();
        if (!settings.loyaltyEnabled)
            return;
        const target = settings.targetAmount;
        const remaining = target - account.progressBalance;
        const tenPercent = target * 0.10;
        if (remaining > 0 && remaining <= tenPercent) {
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const recent = await NotificationQueue_model_1.NotificationQueue.findOne({
                phone: account.phone,
                type: 'spend_threshold_approaching',
                createdAt: { $gte: sevenDaysAgo },
            }).session(session || null);
            if (!recent) {
                const reward = settings.rewardAmount;
                const message = `আর মাত্র ৳${remaining} কেনাকাটা করলেই পাচ্ছেন ৳${reward} এর বিশেষ ভাউচার!`;
                await NotificationQueue_model_1.NotificationQueue.create([
                    {
                        phone: account.phone,
                        type: 'spend_threshold_approaching',
                        channel: 'sms',
                        message,
                        metadata: {
                            targetAmount: target,
                            remainingAmount: remaining,
                            voucherAmount: reward,
                        },
                        status: 'queued',
                    },
                ], session ? { session } : undefined);
            }
        }
    }
    /**
     * Retroactive Sales Backfill: Reads delivered sales since program start date and awards progress.
     */
    static async backfillDeliveredSales(adminEmail) {
        const settings = await this.getSettings();
        if (!settings.loyaltyEnabled) {
            throw new Error('Loyalty program is currently disabled in settings.');
        }
        const startDate = settings.programStartDate ? new Date(settings.programStartDate) : new Date(0);
        const sales = await Sale_model_1.Sale.find({
            status: 'delivered',
            soldAt: { $gte: startDate },
            customerPhone: { $exists: true, $ne: '' },
        }).sort({ soldAt: 1 });
        let processedSales = 0;
        let newlyEarnedTaka = 0;
        let vouchersIssued = 0;
        for (const sale of sales) {
            const phone = shipment_service_1.ShipmentService.normalizePhoneNumber(sale.customerPhone);
            if (!phone)
                continue;
            const existing = await LoyaltyLedger_model_1.LoyaltyLedger.findOne({
                orderId: sale._id.toString(),
                type: { $in: ['earn_pending', 'earn_eligible', 'import'] },
            });
            if (existing)
                continue;
            const session = await mongoose_1.default.startSession();
            session.startTransaction();
            try {
                const netSpend = Math.max(0, Math.floor(sale.totalAmount || 0));
                if (netSpend <= 0) {
                    await session.abortTransaction();
                    session.endSession();
                    continue;
                }
                const account = await this.getOrCreateAccount(phone, sale.customerName, null, session);
                await LoyaltyLedger_model_1.LoyaltyLedger.create([
                    {
                        accountId: account._id,
                        type: 'import',
                        amount: netSpend,
                        orderType: 'sale',
                        orderId: sale._id.toString(),
                        orderNo: sale.orderNo || `SALE-${sale._id}`,
                        reason: `Backfill delivered sale since program start date (${startDate.toISOString().slice(0, 10)})`,
                        createdBy: adminEmail,
                    },
                ], { session });
                account.progressBalance = (account.progressBalance || 0) + netSpend;
                account.lifetimeEligibleSpend = (account.lifetimeEligibleSpend || 0) + netSpend;
                await account.save({ session });
                const issued = await this.checkAndIssueVouchers(account, session);
                await this.checkApproachingThresholdNotification(account, session);
                await session.commitTransaction();
                session.endSession();
                processedSales++;
                newlyEarnedTaka += netSpend;
                vouchersIssued += issued;
            }
            catch (err) {
                await session.abortTransaction();
                session.endSession();
            }
        }
        await AuditLog_model_1.AuditLog.create({
            entityType: 'loyalty_settings',
            entityId: settings._id,
            action: 'backfill_sales',
            actor: adminEmail,
            metadata: {
                processedSales,
                newlyEarnedTaka,
                vouchersIssued,
                startDate: startDate.toISOString(),
            },
        });
        return { processedSales, newlyEarnedTaka, vouchersIssued };
    }
}
exports.LoyaltyService = LoyaltyService;
