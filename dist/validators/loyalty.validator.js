"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoidVoucherSchema = exports.IncreaseUsageLimitSchema = exports.ExtendVoucherExpirySchema = exports.ImportPurchasesSchema = exports.LinkCustomerSchema = exports.ManualAdjustmentSchema = exports.BulkGenerateVouchersSchema = exports.CreateVoucherSchema = exports.UpdateLoyaltySettingsSchema = exports.ValidateVoucherInputSchema = void 0;
const zod_1 = require("zod");
exports.ValidateVoucherInputSchema = zod_1.z.object({
    code: zod_1.z.string().min(1, 'Voucher code is required').trim().max(30),
    items: zod_1.z
        .array(zod_1.z.object({
        productId: zod_1.z.string().min(1),
        productSlug: zod_1.z.string().optional(),
        productCode: zod_1.z.string().optional(),
        productName: zod_1.z.string().min(1),
        price: zod_1.z.number().int().min(0),
        quantity: zod_1.z.number().int().min(1),
    }))
        .min(1, 'Cart items are required'),
    phone: zod_1.z.string().optional(),
});
exports.UpdateLoyaltySettingsSchema = zod_1.z.object({
    loyaltyEnabled: zod_1.z.boolean().optional(),
    targetAmount: zod_1.z.number().int().min(100).optional(),
    rewardAmount: zod_1.z.number().int().min(10).optional(),
    minOrderToRedeem: zod_1.z.number().int().min(0).optional(),
    voucherExpiryDays: zod_1.z.number().int().min(1).max(365).optional(),
    holdDays: zod_1.z.number().int().min(0).max(90).optional(),
    carryOver: zod_1.z.boolean().optional(),
    maxDiscountPercentOfOrder: zod_1.z.number().int().min(1).max(100).optional(),
    countDeliveryAndCodFees: zod_1.z.boolean().optional(),
    includedProducts: zod_1.z.array(zod_1.z.string()).optional(),
    maxActiveLoyaltyVouchersPerCustomer: zod_1.z.number().int().min(1).max(20).optional(),
    onReturnAfterIssue: zod_1.z.enum(['flag_only', 'revoke_if_unused']).optional(),
    autoLinkByPhone: zod_1.z.boolean().optional(),
    programStartDate: zod_1.z.string().nullable().optional(),
    welcomeProgressAmount: zod_1.z.number().int().min(0).optional(),
});
exports.CreateVoucherSchema = zod_1.z.object({
    code: zod_1.z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9-]{4,20}$/, 'Code must be 4-20 alphanumeric characters or hyphens')
        .optional(),
    source: zod_1.z.enum(['loyalty', 'custom', 'manual', 'compensation']).default('custom'),
    discountType: zod_1.z.enum(['fixed', 'percent']),
    value: zod_1.z.number().int().min(1, 'Value must be at least 1'),
    maxDiscountAmount: zod_1.z.number().int().min(1).optional(),
    minOrderAmount: zod_1.z.number().int().min(0).default(0),
    startsAt: zod_1.z.string().datetime().optional(),
    expiresAt: zod_1.z.string().datetime(),
    usageLimitTotal: zod_1.z.number().int().min(1).nullable().optional(),
    usageLimitPerCustomer: zod_1.z.number().int().min(1).default(1),
    assignedPhone: zod_1.z.string().trim().nullable().optional(),
    assignedUserId: zod_1.z.string().trim().nullable().optional(),
    applicableProducts: zod_1.z.array(zod_1.z.string()).default([]),
    excludedProducts: zod_1.z.array(zod_1.z.string()).default([]),
    ignoreCap: zod_1.z.boolean().default(false),
    note: zod_1.z.string().trim().max(500).optional(),
});
exports.BulkGenerateVouchersSchema = zod_1.z.object({
    count: zod_1.z.number().int().min(1).max(500, 'Maximum 500 codes per bulk generation'),
    prefix: zod_1.z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{2,8}$/, 'Prefix must be 2-8 uppercase letters or numbers')
        .default('HB'),
    voucherRules: exports.CreateVoucherSchema.omit({ code: true }).optional(),
    discountType: zod_1.z.enum(['fixed', 'percent']).default('fixed'),
    value: zod_1.z.number().int().positive().default(100),
    maxDiscountAmount: zod_1.z.number().int().positive().optional(),
    minOrderAmount: zod_1.z.number().int().nonnegative().default(1000),
    expiryDays: zod_1.z.number().int().min(1).default(60),
    usageLimitTotal: zod_1.z.number().int().min(1).optional(),
    note: zod_1.z.string().trim().max(500).optional(),
});
exports.ManualAdjustmentSchema = zod_1.z.object({
    phone: zod_1.z.string().trim().optional(),
    amount: zod_1.z.number().int().refine((val) => val !== 0, 'Amount cannot be zero'),
    reason: zod_1.z.string().trim().min(5, 'Reason must be at least 5 characters'),
});
exports.LinkCustomerSchema = zod_1.z.object({
    userId: zod_1.z.string().trim().min(1, 'User ID is required'),
});
exports.ImportPurchasesSchema = zod_1.z.object({
    batchHash: zod_1.z.string().trim().optional(),
    dryRun: zod_1.z.boolean().default(false),
    rows: zod_1.z
        .array(zod_1.z.object({
        phone: zod_1.z.string().trim().min(10),
        amount: zod_1.z.number().int().min(1),
        name: zod_1.z.string().trim().optional(),
        date: zod_1.z.string().optional(),
        note: zod_1.z.string().trim().optional(),
        orderRef: zod_1.z.string().trim().optional(),
    }))
        .min(1, 'At least one row required'),
});
exports.ExtendVoucherExpirySchema = zod_1.z.object({
    daysToAdd: zod_1.z.number().int().min(1).max(365).optional(),
    newExpiryDate: zod_1.z.string().optional(),
    reason: zod_1.z.string().trim().min(3),
});
exports.IncreaseUsageLimitSchema = zod_1.z.object({
    newLimit: zod_1.z.number().int().min(1).optional(),
    newUsageLimit: zod_1.z.number().int().min(1).optional(),
    reason: zod_1.z.string().trim().min(3),
});
exports.VoidVoucherSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3, 'Void reason is required'),
});
