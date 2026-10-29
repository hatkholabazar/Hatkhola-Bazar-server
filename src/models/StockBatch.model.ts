import mongoose, { Schema, Document, Types } from 'mongoose';

export type PaymentMethod = 'cash_on_delivery' | 'bkash' | 'nagad' | 'bank' | 'cash' | 'other';

export type ReferenceType =
  | 'courier_tracking'
  | 'memo_invoice'
  | 'online_order_id'
  | 'payment_trxid'
  | 'other'
  | 'none';

export type CourierName =
  | 'Pathao'
  | 'Steadfast'
  | 'RedX'
  | 'Sundarban'
  | 'SA Paribahan'
  | 'Other';

export type AttachmentKind =
  | 'whatsapp_chat'
  | 'courier_slip'
  | 'payment_receipt'
  | 'other';

export interface IAttachment {
  publicId: string;
  resourceType: string;
  format: string;
  bytes: number;
  kind: AttachmentKind;
  caption?: string;
  uploadedAt: Date;
  removedAt?: Date;
  removedReason?: string;
}

export type BatchStatus = 'active' | 'depleted' | 'voided';

export interface IStockBatch extends Document {
  batchNo: string;
  product: Types.ObjectId;
  purchasedAt: Date;
  receivedAt: Date;
  supplierName: string;
  supplierPhone: string;
  orderedQtyG: number;
  receivedQtyG: number;
  qtyRemainingG: number;
  productCost: number;
  courierCharge: number;
  codFee: number;
  otherExtraCost: number;
  extraCost: number;
  totalCost: number;
  costRemaining: number;
  paymentMethod: PaymentMethod;
  referenceType: ReferenceType;
  referenceValue?: string;
  courierName?: CourierName;
  attachments: IAttachment[];
  status: BatchStatus;
  voidReason?: string;
  voidedAt?: Date;
  note?: string;
  createdAt: Date;
  costPerKg: number;
}

const AttachmentSchema = new Schema<IAttachment>(
  {
    publicId: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    format: { type: String, required: true },
    bytes: { type: Number, required: true },
    kind: {
      type: String,
      enum: ['whatsapp_chat', 'courier_slip', 'payment_receipt', 'other'],
      required: true,
    },
    caption: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
    removedAt: { type: Date },
    removedReason: { type: String, trim: true },
  },
  { _id: false }
);

const StockBatchSchema = new Schema<IStockBatch>(
  {
    batchNo: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    purchasedAt: {
      type: Date,
      required: true,
      index: true,
    },
    receivedAt: {
      type: Date,
      required: true,
    },
    supplierName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    supplierPhone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    orderedQtyG: {
      type: Number,
      required: true,
      min: 1,
    },
    receivedQtyG: {
      type: Number,
      required: true,
      min: 1,
    },
    qtyRemainingG: {
      type: Number,
      required: true,
      min: 0,
      index: true,
    },
    productCost: {
      type: Number,
      required: true,
      min: 0,
    },
    courierCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    codFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    otherExtraCost: {
      type: Number,
      default: 0,
      min: 0,
    },
    extraCost: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCost: {
      type: Number,
      required: true,
      min: 0,
    },
    costRemaining: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'],
      default: 'cash_on_delivery',
    },
    referenceType: {
      type: String,
      enum: ['courier_tracking', 'memo_invoice', 'online_order_id', 'payment_trxid', 'other', 'none'],
      default: 'courier_tracking',
    },
    referenceValue: {
      type: String,
      trim: true,
      index: true,
    },
    courierName: {
      type: String,
      enum: ['Pathao', 'Steadfast', 'RedX', 'Sundarban', 'SA Paribahan', 'Other'],
    },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'depleted', 'voided'],
      default: 'active',
      index: true,
    },
    voidReason: {
      type: String,
      trim: true,
    },
    voidedAt: {
      type: Date,
    },
    note: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual: cost per kg = round(totalCost / receivedQtyG * 1000)
StockBatchSchema.virtual('costPerKg').get(function () {
  if (!this.receivedQtyG || this.receivedQtyG <= 0) return 0;
  return Math.round((this.totalCost / this.receivedQtyG) * 1000);
});

export const StockBatch =
  mongoose.models.StockBatch || mongoose.model<IStockBatch>('StockBatch', StockBatchSchema);

