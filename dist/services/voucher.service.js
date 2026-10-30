"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoucherService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const Voucher_model_1 = require("../models/Voucher.model");
const VoucherRedemption_model_1 = require("../models/VoucherRedemption.model");
const LoyaltySettings_model_1 = require("../models/LoyaltySettings.model");
const shipment_service_1 = require("./shipment.service");
const VOUCHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Ambiguous characters omitted (I, O, 1, 0)
class VoucherService {
    /**
     * Generates a cryptographic unguessable voucher code in the format HB-XXXX-XXXX
     */
    static generateVoucherCode(prefix = 'HB') {
        const cleanPrefix = prefix.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        let part1 = '';
        let part2 = '';
        for (let i = 0; i < 4; i++) {
            part1 += VOUCHER_ALPHABET[crypto_1.default.randomInt(0, VOUCHER_ALPHABET.length)];
            part2 += VOUCHER_ALPHABET[crypto_1.default.randomInt(0, VOUCHER_ALPHABET.length)];
        }
        return `${cleanPrefix}-${part1}-${part2}`;
    }
    /**
     * Masks voucher codes for privacy in logs (e.g. HB-****-8K2M)
     */
    static maskCode(code) {
        if (!code)
            return '';
        const clean = code.trim().toUpperCase();
        if (clean.length <= 4)
            return '****';
        const lastFour = clean.slice(-4);
        return `HB-****-${lastFour}`;
    }
    /**
     * Allocates discount across order items proportionally using the Largest-Remainder Method.
     * Guarantees every item's discount is an exact integer Taka and their sum exactly equals discountTotal.
     */
    static allocateDiscountLargestRemainder(items, totalDiscount) {
        if (items.length === 0 || totalDiscount <= 0) {
            return items.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                lineSubtotal: it.lineSubtotal,
                discountAmount: 0,
            }));
        }
        const totalEligible = items.reduce((sum, it) => sum + it.lineSubtotal, 0);
        if (totalEligible <= 0) {
            return items.map((it) => ({
                productId: it.productId,
                productName: it.productName,
                lineSubtotal: it.lineSubtotal,
                discountAmount: 0,
            }));
        }
        // Step 1: Compute exact quota and integer parts
        const quotas = items.map((it) => {
            const exact = (it.lineSubtotal / totalEligible) * totalDiscount;
            const integerPart = Math.floor(exact);
            const remainder = exact - integerPart;
            return {
                item: it,
                integerPart,
                remainder,
                allocated: integerPart,
            };
        });
        // Step 2: Calculate remaining Taka to distribute
        const allocatedSum = quotas.reduce((sum, q) => sum + q.allocated, 0);
        let remainderToDistribute = totalDiscount - allocatedSum;
        // Step 3: Sort by largest fractional remainder descending
        quotas.sort((a, b) => b.remainder - a.remainder);
        // Step 4: Distribute 1 Taka to highest remainders until target is exactly met
        for (let i = 0; i < quotas.length && remainderToDistribute > 0; i++) {
            quotas[i].allocated += 1;
            remainderToDistribute -= 1;
        }
        return quotas.map((q) => ({
            productId: q.item.productId,
            productName: q.item.productName,
            lineSubtotal: q.item.lineSubtotal,
            discountAmount: Math.min(q.item.lineSubtotal, q.allocated),
        }));
    }
    /**
     * Single shared evaluation engine for vouchers.
     * Used identically by customer checkout validation, order placement, and admin sales.
     */
    static async evaluateVoucher(voucherOrCode, items, phone, userId, now = new Date(), settingsOverride) {
        const rawCode = typeof voucherOrCode === 'string' ? voucherOrCode.trim().toUpperCase() : voucherOrCode.code;
        const voucher = typeof voucherOrCode === 'string'
            ? await Voucher_model_1.Voucher.findOne({ code: rawCode })
            : voucherOrCode;
        if (!voucher) {
            return {
                isValid: false,
                code: rawCode,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        // 1. Status Check (must be active or review)
        if (voucher.status !== 'active' && voucher.status !== 'review') {
            return {
                isValid: false,
                code: voucher.code,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        // 2. Date Validity Check
        if (voucher.startsAt && now < new Date(voucher.startsAt)) {
            return {
                isValid: false,
                code: voucher.code,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        if (voucher.expiresAt && now > new Date(voucher.expiresAt)) {
            return {
                isValid: false,
                code: voucher.code,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        // 3. Total Usage Limit Check
        if (voucher.usageLimitTotal !== null &&
            voucher.usageLimitTotal !== undefined &&
            voucher.usedCount + voucher.reservedCount >= voucher.usageLimitTotal) {
            return {
                isValid: false,
                code: voucher.code,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        // 4. Customer Identity & Phone Match
        const normalizedPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(phone);
        if (voucher.assignedPhone) {
            const assignedNorm = shipment_service_1.ShipmentService.normalizePhoneNumber(voucher.assignedPhone);
            if (!normalizedPhone || normalizedPhone !== assignedNorm) {
                return {
                    isValid: false,
                    code: voucher.code,
                    error: 'This voucher cannot be used.',
                    eligibleSubtotal: 0,
                    discountAmount: 0,
                    newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                    allocations: [],
                };
            }
        }
        if (voucher.assignedUserId && userId && voucher.assignedUserId !== userId) {
            return {
                isValid: false,
                code: voucher.code,
                error: 'This voucher cannot be used.',
                eligibleSubtotal: 0,
                discountAmount: 0,
                newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                allocations: [],
            };
        }
        // 5. Per-Customer Usage Check
        if (normalizedPhone && voucher.usageLimitPerCustomer) {
            const customerRedemptions = await VoucherRedemption_model_1.VoucherRedemption.countDocuments({
                voucherId: voucher._id,
                phone: normalizedPhone,
                status: { $in: ['reserved', 'redeemed'] },
            });
            if (customerRedemptions >= voucher.usageLimitPerCustomer) {
                return {
                    isValid: false,
                    code: voucher.code,
                    error: 'This voucher cannot be used.',
                    eligibleSubtotal: 0,
                    discountAmount: 0,
                    newTotal: items.reduce((s, it) => s + it.price * it.quantity, 0),
                    allocations: [],
                };
            }
        }
        // 6. Eligible Products Filter
        const eligibleLineItems = items
            .filter((it) => {
            const idOrSlug = it.productSlug || it.productId;
            const code = it.productCode || '';
            // If applicableProducts specified, must be included
            if (voucher.applicableProducts && voucher.applicableProducts.length > 0) {
                const match = voucher.applicableProducts.some((p) => p === idOrSlug || p === code || p === it.productId);
                if (!match)
                    return false;
            }
            // If excludedProducts specified, must not be excluded
            if (voucher.excludedProducts && voucher.excludedProducts.length > 0) {
                const isExcluded = voucher.excludedProducts.some((p) => p === idOrSlug || p === code || p === it.productId);
                if (isExcluded)
                    return false;
            }
            return true;
        })
            .map((it) => ({
            productId: it.productId,
            productName: it.productName,
            lineSubtotal: it.price * it.quantity,
        }));
        const eligibleSubtotal = eligibleLineItems.reduce((sum, it) => sum + it.lineSubtotal, 0);
        const overallSubtotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
        // 7. Minimum Order Amount Check
        if (voucher.minOrderAmount > 0 && eligibleSubtotal < voucher.minOrderAmount) {
            const diff = voucher.minOrderAmount - eligibleSubtotal;
            return {
                isValid: false,
                code: voucher.code,
                error: `Add ৳${diff.toLocaleString()} more of eligible items to use this voucher.`,
                eligibleSubtotal,
                discountAmount: 0,
                newTotal: overallSubtotal,
                allocations: [],
            };
        }
        // 8. Discount Calculation
        let calculatedDiscount = 0;
        if (voucher.discountType === 'fixed') {
            calculatedDiscount = Math.floor(voucher.value);
        }
        else {
            // Percent
            const percentVal = Math.floor((eligibleSubtotal * voucher.value) / 100);
            calculatedDiscount = voucher.maxDiscountAmount
                ? Math.min(percentVal, Math.floor(voucher.maxDiscountAmount))
                : percentVal;
        }
        // 9. Percentage Cap Enforcement (unless ignoreCap is true)
        if (!voucher.ignoreCap) {
            const settings = settingsOverride || (await LoyaltySettings_model_1.LoyaltySettings.findOne()) || { maxDiscountPercentOfOrder: 15 };
            const maxAllowed = Math.floor((eligibleSubtotal * (settings.maxDiscountPercentOfOrder || 15)) / 100);
            calculatedDiscount = Math.min(calculatedDiscount, maxAllowed);
        }
        // Discount cannot exceed eligible subtotal and cannot be negative
        calculatedDiscount = Math.max(0, Math.min(calculatedDiscount, eligibleSubtotal));
        // 10. Allocate proportionally to items
        const allocations = this.allocateDiscountLargestRemainder(eligibleLineItems, calculatedDiscount);
        return {
            isValid: true,
            code: voucher.code,
            voucher,
            eligibleSubtotal,
            discountAmount: calculatedDiscount,
            newTotal: Math.max(0, overallSubtotal - calculatedDiscount),
            allocations,
        };
    }
    /**
     * Atomically reserves a voucher inside an order transaction.
     */
    static async reserveVoucher(code, orderId, orderNo, orderType, phone, userId, items, session) {
        const cleanCode = (code || '').trim().toUpperCase();
        const cleanPhone = shipment_service_1.ShipmentService.normalizePhoneNumber(phone);
        // 1. Evaluate rules on server
        const evaluation = await this.evaluateVoucher(cleanCode, items, cleanPhone, userId || undefined);
        if (!evaluation.isValid || !evaluation.voucher) {
            throw new Error(evaluation.error || 'Voucher cannot be applied.');
        }
        const voucher = evaluation.voucher;
        // 2. Atomic conditional update to reserve capacity
        const updateFilter = {
            _id: voucher._id,
            status: { $in: ['active', 'review'] },
        };
        if (voucher.usageLimitTotal !== null && voucher.usageLimitTotal !== undefined) {
            updateFilter.$expr = {
                $lt: [{ $add: ['$usedCount', '$reservedCount'] }, voucher.usageLimitTotal],
            };
        }
        const updatedVoucher = await Voucher_model_1.Voucher.findOneAndUpdate(updateFilter, { $inc: { reservedCount: 1 } }, { new: true, session });
        if (!updatedVoucher) {
            throw new Error('This voucher has reached its maximum usage limit or is no longer active.');
        }
        // Single-use voucher expires immediately once committed to an order
        if (updatedVoucher.usageLimitTotal !== null &&
            updatedVoucher.usageLimitTotal !== undefined &&
            updatedVoucher.usedCount + updatedVoucher.reservedCount >= updatedVoucher.usageLimitTotal) {
            updatedVoucher.status = 'expired';
            await updatedVoucher.save({ session });
        }
        // 3. Create redemption record
        const [redemption] = await VoucherRedemption_model_1.VoucherRedemption.create([
            {
                voucherId: voucher._id,
                code: voucher.code,
                orderType,
                orderId,
                orderNo,
                phone: cleanPhone,
                userId,
                discountAmount: evaluation.discountAmount,
                eligibleSubtotal: evaluation.eligibleSubtotal,
                status: 'reserved',
                allocations: evaluation.allocations,
                statusHistory: [
                    {
                        status: 'reserved',
                        note: `Reserved during ${orderType} placement`,
                        updatedAt: new Date(),
                    },
                ],
            },
        ], { session });
        return redemption;
    }
    /**
     * Redeems a reserved voucher upon order delivery.
     */
    static async redeemVoucher(orderId, session) {
        const redemption = await VoucherRedemption_model_1.VoucherRedemption.findOne({ orderId }).session(session || null);
        if (!redemption || redemption.status === 'redeemed')
            return;
        if (redemption.status === 'reserved') {
            await Voucher_model_1.Voucher.findByIdAndUpdate(redemption.voucherId, {
                $inc: { reservedCount: -1, usedCount: 1 },
            }, { session });
        }
        else {
            await Voucher_model_1.Voucher.findByIdAndUpdate(redemption.voucherId, {
                $inc: { usedCount: 1 },
            }, { session });
        }
        redemption.status = 'redeemed';
        redemption.statusHistory.push({
            status: 'redeemed',
            note: 'Order successfully delivered to customer',
            updatedAt: new Date(),
        });
        await redemption.save({ session });
    }
    /**
     * Releases a reserved voucher upon order cancellation or void prior to delivery.
     */
    static async releaseVoucher(orderId, reason = 'Order cancelled before delivery', session) {
        const redemption = await VoucherRedemption_model_1.VoucherRedemption.findOne({ orderId }).session(session || null);
        if (!redemption || redemption.status !== 'reserved')
            return;
        await Voucher_model_1.Voucher.findByIdAndUpdate(redemption.voucherId, {
            $inc: { reservedCount: -1 },
        }, { session });
        redemption.status = 'released';
        redemption.statusHistory.push({
            status: 'released',
            note: reason,
            updatedAt: new Date(),
        });
        await redemption.save({ session });
    }
    /**
     * Reverses a redeemed voucher upon order return after delivery (flags for admin review).
     */
    static async reverseVoucher(orderId, reason = 'Order returned after delivery', session) {
        const redemption = await VoucherRedemption_model_1.VoucherRedemption.findOne({ orderId }).session(session || null);
        if (!redemption || redemption.status === 'reversed')
            return;
        redemption.status = 'reversed';
        redemption.statusHistory.push({
            status: 'reversed',
            note: reason,
            updatedAt: new Date(),
        });
        await redemption.save({ session });
        // Mark voucher for review so admin can inspect
        await Voucher_model_1.Voucher.findByIdAndUpdate(redemption.voucherId, { status: 'review' }, { session });
    }
}
exports.VoucherService = VoucherService;
