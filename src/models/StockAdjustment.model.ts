import mongoose, { Schema, Document, Types } from 'mongoose';

export type AdjustmentType = 'wastage' | 'sample' | 'return' | 'correction' | 'physical_count';

export interface IStockAdjustment extends Document {
  product: Types.ObjectId;
  batch: Types.ObjectId;
  qtyG: number;
  type: AdjustmentType;
  costImpact: number; // Integer Taka
  reason: string;
  createdAt: Date;
}

const StockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    batch: {
      type: Schema.Types.ObjectId,
      ref: 'StockBatch',
      required: true,
      index: true,
    },
    qtyG: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ['wastage', 'sample', 'return', 'correction', 'physical_count'],
      required: true,
      index: true,
    },
    costImpact: {
      type: Number,
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const StockAdjustment =
  mongoose.models.StockAdjustment ||
  mongoose.model<IStockAdjustment>('StockAdjustment', StockAdjustmentSchema);

