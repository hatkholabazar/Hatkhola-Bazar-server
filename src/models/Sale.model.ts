import mongoose, { Schema, Document, Types } from 'mongoose';
import { PaymentMethod } from './StockBatch.model';

export type SaleChannel = 'whatsapp' | 'messenger' | 'phone' | 'other';
export type SaleStatus = 'completed' | 'voided';

export interface IItemAllocation {
  batchId: Types.ObjectId;
  batchNo: string;
  qtyG: number;
  cost: number; // Integer Taka
}

export interface ISaleItem {
  product: Types.ObjectId;
  optionLabel: string;
  qtyG: number;
  sellingPrice: number; // Integer Taka
  discountAllocated?: number; // Integer Taka discount distributed to this item
  allocations: IItemAllocation[];
}

export interface ISale extends Document {
  soldAt: Date;
  deliveredAt?: Date;
  orderNo?: string;
  userId?: string;
  idempotencyKey?: string;
  voucherId?: Types.ObjectId | string;
  voucherCode?: string;
  discountTotal?: number;
  discountSource?: 'loyalty' | 'custom' | 'manual';
  subtotalBeforeDiscount?: number;
  lowMarginFlag?: boolean;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  courierName?: string;
  courierCharge?: number; // Integer Taka
  courierTrackingId?: string;
  courierCost?: number; // Integer Taka incurred by store for courier delivery
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  pathaoCityId?: number;
  pathaoZoneId?: number;
  pathaoAreaId?: number;
  pathaoCityName?: string;
  pathaoZoneName?: string;
  pathaoAreaName?: string;
  deliveryNotes?: string;
  paymentTrxId?: string;
  channel: SaleChannel;
  paymentMethod: PaymentMethod;
  items: ISaleItem[];
  giveawayG: number;
  packagingCost: number;
  totalRevenue: number;
  totalCogs: number;
  grossProfit: number;
  status: SaleStatus;
  voidReason?: string;
  voidedAt?: Date;
  createdAt: Date;
}

const AllocationSchema = new Schema<IItemAllocation>(
  {
    batchId: { type: Schema.Types.ObjectId, ref: 'StockBatch', required: true },
    batchNo: { type: String, required: true },
    qtyG: { type: Number, required: true, min: 1 },
    cost: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const SaleItemSchema = new Schema<ISaleItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    optionLabel: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    sellingPrice: { type: Number, required: true, min: 0 },
    discountAllocated: { type: Number, default: 0, min: 0 },
    allocations: { type: [AllocationSchema], default: [] },
  },
  { _id: false }
);

const SaleSchema = new Schema<ISale>(
  {
    soldAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    deliveredAt: {
      type: Date,
      index: true,
    },
    orderNo: {
      type: String,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    idempotencyKey: {
      type: String,
      index: true,
    },
    voucherId: {
      type: Schema.Types.Mixed,
      index: true,
    },
    voucherCode: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
    },
    discountTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountSource: {
      type: String,
      enum: ['loyalty', 'custom', 'manual'],
    },
    subtotalBeforeDiscount: {
      type: Number,
      min: 0,
    },
    lowMarginFlag: {
      type: Boolean,
      default: false,
    },
    customerName: {
      type: String,
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
      index: true,
    },
    customerAddress: {
      type: String,
      trim: true,
    },
    courierName: {
      type: String,
      trim: true,
    },
    courierCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    courierTrackingId: {
      type: String,
      trim: true,
    },
    courierCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    recipientName: {
      type: String,
      trim: true,
    },
    recipientPhone: {
      type: String,
      trim: true,
    },
    recipientAddress: {
      type: String,
      trim: true,
    },
    pathaoCityId: {
      type: Number,
    },
    pathaoZoneId: {
      type: Number,
    },
    pathaoAreaId: {
      type: Number,
    },
    pathaoCityName: {
      type: String,
      trim: true,
    },
    pathaoZoneName: {
      type: String,
      trim: true,
    },
    pathaoAreaName: {
      type: String,
      trim: true,
    },
    deliveryNotes: {
      type: String,
      trim: true,
    },
    paymentTrxId: {
      type: String,
      trim: true,
    },
    channel: {
      type: String,
      enum: ['whatsapp', 'messenger', 'phone', 'other'],
      default: 'whatsapp',
    },
    paymentMethod: {
      type: String,
      enum: ['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'],
      default: 'cash_on_delivery',
    },
    items: {
      type: [SaleItemSchema],
      required: true,
    },
    giveawayG: {
      type: Number,
      default: 0,
      min: 0,
    },
    packagingCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRevenue: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCogs: {
      type: Number,
      required: true,
      min: 0,
    },
    grossProfit: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['completed', 'voided'],
      default: 'completed',
      index: true,
    },
    voidReason: {
      type: String,
      trim: true,
    },
    voidedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

SaleSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
SaleSchema.index({ userId: 1, soldAt: -1 });

export const Sale = mongoose.models.Sale || mongoose.model<ISale>('Sale', SaleSchema);

