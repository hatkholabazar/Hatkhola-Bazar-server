import mongoose, { Schema, Document, Types } from 'mongoose';
import { SaleChannel } from './Sale.model';

export type PreOrderStatus =
  | 'pending'
  | 'confirmed'
  | 'ready'
  | 'fulfilled'
  | 'cancelled'
  | 'refunded';

export type DepositMethod = 'bkash' | 'nagad' | 'bank' | 'cash';

export interface IPreOrderDepositAttachment {
  publicId: string;
  url: string;
  kind: 'payment_receipt';
}

export interface IPreOrderDeposit {
  depositId: string;
  amount: number; // Integer Taka
  method: DepositMethod;
  trxId?: string;
  receivedAt: Date;
  attachment?: IPreOrderDepositAttachment;
}

export interface IPreOrderItem {
  product: Types.ObjectId;
  productCode: string;
  productName: string;
  optionLabel: string;
  qtyG: number;
  quotedPrice: number; // Integer Taka
  discountAllocated?: number; // Integer Taka
}

export interface IPreOrderStatusHistory {
  status: PreOrderStatus;
  changedAt: Date;
  changedBy: string;
  note?: string;
}

export interface IPreOrderRefundRecord {
  amount: number; // Integer Taka
  type: 'refund' | 'forfeit';
  reason: string;
  processedAt: Date;
  processedBy: string;
  trxId?: string;
}

export interface IPreOrder extends Document {
  preOrderNo: string; // e.g. PRE-2610-001
  userId?: string;
  idempotencyKey?: string;
  voucherId?: Types.ObjectId | string;
  voucherCode?: string;
  discountTotal?: number;
  discountSource?: 'loyalty' | 'custom' | 'manual';
  subtotalBeforeDiscount?: number;
  lowMarginFlag?: boolean;
  deliveredAt?: Date;
  customerName: string;
  customerPhone: string;
  channel: SaleChannel;
  address?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  pathaoCityId?: number;
  pathaoZoneId?: number;
  pathaoAreaId?: number;
  pathaoCityName?: string;
  pathaoZoneName?: string;
  pathaoAreaName?: string;
  courierCost?: number; // Integer Taka
  items: IPreOrderItem[];
  quotedTotal: number; // Integer Taka
  expectedDate?: Date;
  note?: string;
  deposits: IPreOrderDeposit[];
  depositTotal: number; // Integer Taka
  refundedTotal: number; // Integer Taka
  forfeitedTotal: number; // Integer Taka
  status: PreOrderStatus;
  statusHistory: IPreOrderStatusHistory[];
  linkedBatchId?: Types.ObjectId;
  fulfilledSaleId?: Types.ObjectId;
  cancelReason?: string;
  refunds: IPreOrderRefundRecord[];
  createdAt: Date;
  updatedAt: Date;
}

const DepositAttachmentSchema = new Schema<IPreOrderDepositAttachment>(
  {
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, default: 'payment_receipt', enum: ['payment_receipt'] },
  },
  { _id: false }
);

const PreOrderDepositSchema = new Schema<IPreOrderDeposit>(
  {
    depositId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      required: true,
      enum: ['bkash', 'nagad', 'bank', 'cash'],
    },
    trxId: { type: String, trim: true },
    receivedAt: { type: Date, default: Date.now },
    attachment: { type: DepositAttachmentSchema },
  },
  { _id: false }
);

const PreOrderItemSchema = new Schema<IPreOrderItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productCode: { type: String, required: true, uppercase: true, trim: true },
    productName: { type: String, required: true, trim: true },
    optionLabel: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    quotedPrice: { type: Number, required: true, min: 0 },
    discountAllocated: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const PreOrderStatusHistorySchema = new Schema<IPreOrderStatusHistory>(
  {
    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'ready', 'fulfilled', 'cancelled', 'refunded'],
    },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String, required: true, default: 'admin' },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const PreOrderRefundSchema = new Schema<IPreOrderRefundRecord>(
  {
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, required: true, enum: ['refund', 'forfeit'] },
    reason: { type: String, required: true, trim: true },
    processedAt: { type: Date, default: Date.now },
    processedBy: { type: String, required: true, default: 'admin' },
    trxId: { type: String, trim: true },
  },
  { _id: false }
);

const PreOrderSchema = new Schema<IPreOrder>(
  {
    preOrderNo: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
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
    deliveredAt: {
      type: Date,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    customerPhone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ['whatsapp', 'messenger', 'phone', 'other'],
      default: 'whatsapp',
    },
    address: {
      type: String,
      trim: true,
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
    courierCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    items: {
      type: [PreOrderItemSchema],
      required: true,
      validate: [(val: any[]) => val.length > 0, 'Pre-order must have at least one item'],
    },
    quotedTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    expectedDate: {
      type: Date,
    },
    note: {
      type: String,
      trim: true,
    },
    deposits: {
      type: [PreOrderDepositSchema],
      default: [],
    },
    depositTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundedTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    forfeitedTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'ready', 'fulfilled', 'cancelled', 'refunded'],
      default: 'pending',
      index: true,
    },
    statusHistory: {
      type: [PreOrderStatusHistorySchema],
      default: [],
    },
    linkedBatchId: {
      type: Schema.Types.ObjectId,
      ref: 'StockBatch',
      index: true,
    },
    fulfilledSaleId: {
      type: Schema.Types.ObjectId,
      ref: 'Sale',
      index: true,
    },
    cancelReason: {
      type: String,
      trim: true,
    },
    refunds: {
      type: [PreOrderRefundSchema],
      default: [],
    },
  },
  { timestamps: true }
);

PreOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const PreOrder =
  mongoose.models.PreOrder || mongoose.model<IPreOrder>('PreOrder', PreOrderSchema);

