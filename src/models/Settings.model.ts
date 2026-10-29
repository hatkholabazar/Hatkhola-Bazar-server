import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
  packagingCostPerOrder: number;
  defaultMarginPercent: number;
  defaultLowStockThresholdG: number;
  currencyLabel: string;
  preOrderEnabled: boolean;
  defaultCancellationPolicyText: string;
  updatedAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    packagingCostPerOrder: {
      type: Number,
      default: 25,
      min: 0,
    },
    defaultMarginPercent: {
      type: Number,
      default: 25,
      min: 0,
    },
    defaultLowStockThresholdG: {
      type: Number,
      default: 5000,
      min: 0,
    },
    currencyLabel: {
      type: String,
      default: '৳',
      trim: true,
    },
    preOrderEnabled: {
      type: Boolean,
      default: true,
    },
    defaultCancellationPolicyText: {
      type: String,
      default: 'Pre-orders can be cancelled with a full refund up to 48 hours before the expected shipment date.',
      trim: true,
    },
  },
  { timestamps: true }
);

export const Settings =
  mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);

