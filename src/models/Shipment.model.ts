import mongoose, { Schema, Document, Types } from 'mongoose';

export type ShipmentOrderType = 'sale' | 'preorder';

export type ShipmentStatus =
  | 'creating'
  | 'created'
  | 'failed'
  | 'unknown'
  | 'cancelled_manually';

export interface IShipmentStatusHistory {
  status: ShipmentStatus;
  pathaoStatus?: string;
  slug?: string;
  label?: string;
  pathaoUpdatedAt?: string;
  fetchedAt?: Date;
  note?: string;
  timestamp: Date;
}

export interface IShipment extends Document {
  orderType: ShipmentOrderType;
  orderId: Types.ObjectId;
  orderNo: string;
  courier: 'pathao';
  consignmentId?: string;
  merchantOrderId: string;
  trackingUrl?: string;
  request: Record<string, any>;
  amountToCollect: number; // Integer Taka
  itemWeightKg: number;
  deliveryFee: number; // Integer Taka
  codFee: number; // Integer Taka
  pathaoStatus?: string; // e.g. "Pending", "In Transit", "Delivered"
  pathaoStatusSlug?: string; // e.g. "pending", "in_transit", "delivered"
  pathaoUpdatedAt?: string;
  finalStatus: boolean; // true if reached a terminal state (delivered, returned, cancelled)
  lastRefreshedAt?: Date;
  statusHistory: IShipmentStatusHistory[];
  status: ShipmentStatus;
  errorMessage?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const ShipmentStatusHistorySchema = new Schema<IShipmentStatusHistory>(
  {
    status: {
      type: String,
      required: true,
      enum: ['creating', 'created', 'failed', 'unknown', 'cancelled_manually'],
    },
    pathaoStatus: { type: String, trim: true },
    slug: { type: String, trim: true },
    label: { type: String, trim: true },
    pathaoUpdatedAt: { type: String, trim: true },
    fetchedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const ShipmentSchema = new Schema<IShipment>(
  {
    orderType: {
      type: String,
      required: true,
      enum: ['sale', 'preorder'],
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    orderNo: {
      type: String,
      required: true,
      index: true,
    },
    courier: {
      type: String,
      required: true,
      enum: ['pathao'],
      default: 'pathao',
    },
    consignmentId: {
      type: String,
      trim: true,
      index: true,
    },
    merchantOrderId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    trackingUrl: {
      type: String,
      trim: true,
    },
    request: {
      type: Schema.Types.Mixed,
      required: true,
    },
    amountToCollect: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    itemWeightKg: {
      type: Number,
      required: true,
      min: 0.1,
    },
    deliveryFee: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    codFee: {
      type: Number,
      min: 0,
      default: 0,
    },
    pathaoStatus: {
      type: String,
      trim: true,
      default: 'Pending',
    },
    pathaoStatusSlug: {
      type: String,
      trim: true,
      default: 'pending',
      index: true,
    },
    pathaoUpdatedAt: {
      type: String,
      trim: true,
    },
    finalStatus: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastRefreshedAt: {
      type: Date,
    },
    statusHistory: {
      type: [ShipmentStatusHistorySchema],
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ['creating', 'created', 'failed', 'unknown', 'cancelled_manually'],
      default: 'creating',
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      trim: true,
      default: 'admin',
    },
  },
  { timestamps: true }
);

// Unique partial index: An order cannot have more than one active ('creating' or 'created') shipment
ShipmentSchema.index(
  { orderType: 1, orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['creating', 'created'] } },
  }
);

export const Shipment =
  mongoose.models.Shipment || mongoose.model<IShipment>('Shipment', ShipmentSchema);
