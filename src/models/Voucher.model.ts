import mongoose, { Schema, Document } from 'mongoose';

export type VoucherSource = 'loyalty' | 'custom' | 'manual' | 'compensation';
export type VoucherDiscountType = 'fixed' | 'percent';
export type VoucherStatus =
  | 'active'
  | 'paused'
  | 'redeemed'
  | 'expired'
  | 'voided'
  | 'review';

export interface IVoucher extends Document {
  code: string; // Uppercase unique (e.g. HB-XXXX-XXXX)
  source: VoucherSource;
  discountType: VoucherDiscountType;
  value: number; // Integer Taka or Integer percent (1 to 100)
  maxDiscountAmount?: number; // Integer Taka (required for percent)
  minOrderAmount: number; // Integer Taka (0 allowed)
  startsAt: Date;
  expiresAt: Date;
  usageLimitTotal?: number | null; // null = unlimited
  usageLimitPerCustomer: number; // Default 1
  usedCount: number;
  reservedCount: number;
  assignedPhone?: string | null;
  assignedUserId?: string | null;
  applicableProducts: string[]; // Included product slugs/codes (empty = all)
  excludedProducts: string[]; // Excluded product slugs/codes
  ignoreCap: boolean; // Overrides maxDiscountPercentOfOrder, audited
  stackable: boolean; // Always false
  status: VoucherStatus;
  note?: string;
  voidReason?: string;
  createdBy: string;
  snapshot?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const VoucherSchema = new Schema<IVoucher>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
      enum: ['loyalty', 'custom', 'manual', 'compensation'],
      default: 'custom',
      index: true,
    },
    discountType: {
      type: String,
      required: true,
      enum: ['fixed', 'percent'],
      default: 'fixed',
    },
    value: {
      type: Number,
      required: true,
      min: 1,
    },
    maxDiscountAmount: {
      type: Number,
      min: 1,
    },
    minOrderAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    startsAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    usageLimitTotal: {
      type: Number,
      default: 1,
    },
    usageLimitPerCustomer: {
      type: Number,
      default: 1,
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    reservedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    assignedPhone: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    assignedUserId: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    applicableProducts: {
      type: [String],
      default: [],
    },
    excludedProducts: {
      type: [String],
      default: [],
    },
    ignoreCap: {
      type: Boolean,
      default: false,
    },
    stackable: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'paused', 'redeemed', 'expired', 'voided', 'review'],
      default: 'active',
      index: true,
    },
    note: {
      type: String,
      trim: true,
    },
    voidReason: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      default: 'admin',
      trim: true,
    },
    snapshot: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

export const Voucher =
  mongoose.models.Voucher || mongoose.model<IVoucher>('Voucher', VoucherSchema);

