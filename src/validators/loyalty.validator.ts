import { z } from 'zod';

export const ValidateVoucherInputSchema = z.object({
  code: z.string().min(1, 'Voucher code is required').trim().max(30),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        productSlug: z.string().optional(),
        productCode: z.string().optional(),
        productName: z.string().min(1),
        price: z.number().int().min(0),
        quantity: z.number().int().min(1),
      })
    )
    .min(1, 'Cart items are required'),
  phone: z.string().optional(),
});

export const UpdateLoyaltySettingsSchema = z.object({
  loyaltyEnabled: z.boolean().optional(),
  targetAmount: z.number().int().min(100).optional(),
  rewardAmount: z.number().int().min(10).optional(),
  minOrderToRedeem: z.number().int().min(0).optional(),
  voucherExpiryDays: z.number().int().min(1).max(365).optional(),
  holdDays: z.number().int().min(0).max(90).optional(),
  carryOver: z.boolean().optional(),
  maxDiscountPercentOfOrder: z.number().int().min(1).max(100).optional(),
  countDeliveryAndCodFees: z.boolean().optional(),
  includedProducts: z.array(z.string()).optional(),
  maxActiveLoyaltyVouchersPerCustomer: z.number().int().min(1).max(20).optional(),
  onReturnAfterIssue: z.enum(['flag_only', 'revoke_if_unused']).optional(),
  autoLinkByPhone: z.boolean().optional(),
  programStartDate: z.string().nullable().optional(),
  welcomeProgressAmount: z.number().int().min(0).optional(),
});

export const CreateVoucherSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,20}$/, 'Code must be 4-20 alphanumeric characters or hyphens')
    .optional(),
  source: z.enum(['loyalty', 'custom', 'manual', 'compensation']).default('custom'),
  discountType: z.enum(['fixed', 'percent']),
  value: z.number().int().min(1, 'Value must be at least 1'),
  maxDiscountAmount: z.number().int().min(1).optional(),
  minOrderAmount: z.number().int().min(0).default(0),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime(),
  usageLimitTotal: z.number().int().min(1).nullable().optional(),
  usageLimitPerCustomer: z.number().int().min(1).default(1),
  assignedPhone: z.string().trim().nullable().optional(),
  assignedUserId: z.string().trim().nullable().optional(),
  applicableProducts: z.array(z.string()).default([]),
  excludedProducts: z.array(z.string()).default([]),
  ignoreCap: z.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

export const BulkGenerateVouchersSchema = z.object({
  count: z.number().int().min(1).max(500, 'Maximum 500 codes per bulk generation'),
  prefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,8}$/, 'Prefix must be 2-8 uppercase letters or numbers')
    .default('HB'),
  voucherRules: CreateVoucherSchema.omit({ code: true }).optional(),
  discountType: z.enum(['fixed', 'percent']).default('fixed'),
  value: z.number().int().positive().default(100),
  maxDiscountAmount: z.number().int().positive().optional(),
  minOrderAmount: z.number().int().nonnegative().default(1000),
  expiryDays: z.number().int().min(1).default(60),
  usageLimitTotal: z.number().int().min(1).optional(),
  note: z.string().trim().max(500).optional(),
});

export const ManualAdjustmentSchema = z.object({
  phone: z.string().trim().optional(),
  amount: z.number().int().refine((val) => val !== 0, 'Amount cannot be zero'),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
});

export const LinkCustomerSchema = z.object({
  userId: z.string().trim().min(1, 'User ID is required'),
});

export const ImportPurchasesSchema = z.object({
  batchHash: z.string().trim().optional(),
  dryRun: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        phone: z.string().trim().min(10),
        amount: z.number().int().min(1),
        name: z.string().trim().optional(),
        date: z.string().optional(),
        note: z.string().trim().optional(),
        orderRef: z.string().trim().optional(),
      })
    )
    .min(1, 'At least one row required'),
});

export const ExtendVoucherExpirySchema = z.object({
  daysToAdd: z.number().int().min(1).max(365).optional(),
  newExpiryDate: z.string().optional(),
  reason: z.string().trim().min(3),
});

export const IncreaseUsageLimitSchema = z.object({
  newLimit: z.number().int().min(1).optional(),
  newUsageLimit: z.number().int().min(1).optional(),
  reason: z.string().trim().min(3),
});

export const VoidVoucherSchema = z.object({
  reason: z.string().trim().min(3, 'Void reason is required'),
});

