import mongoose, { Schema, Document, Types } from 'mongoose';

export type VoucherRedemptionStatus =
  | 'reserved'
  | 'redeemed'
  | 'released'
  | 'reversed';

export interface IItemDiscountAllocation {
  productId: string;
  productName: string;
  lineSubtotal: number;
  discountAmount: number; // Integer Taka allocated
}

export interface IVoucherRedemption extends Document {
  voucherId: Types.ObjectId;
  code: string;
  orderType: 'sale' | 'preorder';
  orderId: string | Types.ObjectId;
  orderNo: string;
  phone: string;
  userId?: string | null;
  discountAmount: number; // Integer Taka
  eligibleSubtotal: number; // Integer Taka
  status: VoucherRedemptionStatus;
  allocations: IItemDiscountAllocation[];
  statusHistory: {
    status: VoucherRedemptionStatus;
    note?: string;
    updatedAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const VoucherRedemptionSchema = new Schema<IVoucherRedemption>(
  {
    voucherId: {
      type: Schema.Types.ObjectId,
      ref: 'Voucher',
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    orderType: {
      type: String,
      required: true,
      enum: ['sale', 'preorder'],
    },
    orderId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
    orderNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      default: null,
      trim: true,
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    eligibleSubtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['reserved', 'redeemed', 'released', 'reversed'],
      default: 'reserved',
      index: true,
    },
    allocations: [
      {
        productId: { type: String, required: true },
        productName: { type: String, required: true },
        lineSubtotal: { type: Number, required: true },
        discountAmount: { type: Number, required: true },
      },
    ],
    statusHistory: [
      {
        status: { type: String, required: true },
        note: { type: String },
        updatedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Unique index on (voucherId, orderId)
VoucherRedemptionSchema.index({ voucherId: 1, orderId: 1 }, { unique: true });

export const VoucherRedemption =
  mongoose.models.VoucherRedemption ||
  mongoose.model<IVoucherRedemption>(
    'VoucherRedemption',
    VoucherRedemptionSchema
  );

