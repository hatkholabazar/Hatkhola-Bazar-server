import mongoose, { Schema, Document } from 'mongoose';

export interface ISellingOption {
  label: string;
  qtyG: number;
  sellingPrice: number;
}

export type AvailabilityMode = 'in_stock' | 'pre_order' | 'out_of_stock';

export interface IPreOrderConfig {
  expectedDate?: Date;
  expectedNote?: string;
  depositRequired: boolean;
  depositAmount?: number; // Integer Taka
  depositPercent?: number; // Integer % (0-100)
  maxQtyG?: number; // Grams cap
  closesAt?: Date;
  cancellationPolicyText?: string;
}

export interface IProduct extends Document {
  code: string;
  slug: string;
  name: string;
  baseUnit: 'g';
  sellingOptions: ISellingOption[];
  isSeasonal: boolean;
  isActive: boolean;
  availabilityMode: AvailabilityMode;
  preOrder?: IPreOrderConfig;
  lowStockThresholdG: number;
  marginPercent: number;
  description?: string;
  tagline?: string;
  badge?: string;
  origin?: string;
  benefits?: string[];
  image?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SellingOptionSchema = new Schema<ISellingOption>(
  {
    label: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    sellingPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const ProductSchema = new Schema<IProduct>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    baseUnit: {
      type: String,
      default: 'g',
      enum: ['g'],
    },
    sellingOptions: {
      type: [SellingOptionSchema],
      default: [],
    },
    isSeasonal: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    availabilityMode: {
      type: String,
      enum: ['in_stock', 'pre_order', 'out_of_stock'],
      default: 'in_stock',
      index: true,
    },
    preOrder: {
      expectedDate: { type: Date },
      expectedNote: { type: String, trim: true },
      depositRequired: { type: Boolean, default: false },
      depositAmount: { type: Number, min: 0 },
      depositPercent: { type: Number, min: 0, max: 100 },
      maxQtyG: { type: Number, min: 0 },
      closesAt: { type: Date },
      cancellationPolicyText: { type: String, trim: true },
    },
    lowStockThresholdG: {
      type: Number,
      default: 5000, // 5 kg
      min: 0,
    },
    marginPercent: {
      type: Number,
      default: 25,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
    },
    tagline: {
      type: String,
      trim: true,
    },
    badge: {
      type: String,
      trim: true,
    },
    origin: {
      type: String,
      trim: true,
    },
    benefits: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

ProductSchema.index({ slug: 1, isActive: 1 });
ProductSchema.index({ code: 1, isActive: 1 });

export const Product = mongoose.models.Product || mongoose.model<IProduct>('Product', ProductSchema);

