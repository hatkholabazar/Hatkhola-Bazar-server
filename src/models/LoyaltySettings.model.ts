import mongoose, { Schema, Document } from 'mongoose';

export interface ILoyaltySettings extends Document {
  loyaltyEnabled: boolean;
  targetAmount: number; // Integer Taka (e.g. 4000)
  rewardAmount: number; // Integer Taka (e.g. 250)
  minOrderToRedeem: number; // Integer Taka (e.g. 2000)
  voucherExpiryDays: number; // Integer days (e.g. 90)
  holdDays: number; // Days after delivery before eligible (e.g. 3)
  carryOver: boolean; // Extra spend carries over
  maxDiscountPercentOfOrder: number; // Max discount percent (e.g. 15)
  countDeliveryAndCodFees: boolean; // Whether courier fees count toward progress
  includedProducts: string[]; // List of product codes, empty = all
  maxActiveLoyaltyVouchersPerCustomer: number; // Max active vouchers cap (e.g. 3)
  onReturnAfterIssue: 'flag_only' | 'revoke_if_unused';
  autoLinkByPhone: boolean;
  programStartDate?: Date;
  welcomeProgressAmount: number;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const LoyaltySettingsSchema = new Schema<ILoyaltySettings>(
  {
    loyaltyEnabled: {
      type: Boolean,
      default: true,
    },
    targetAmount: {
      type: Number,
      required: true,
      default: 4000,
      min: 100,
    },
    rewardAmount: {
      type: Number,
      required: true,
      default: 250,
      min: 10,
    },
    minOrderToRedeem: {
      type: Number,
      required: true,
      default: 2000,
      min: 0,
    },
    voucherExpiryDays: {
      type: Number,
      required: true,
      default: 90,
      min: 1,
    },
    holdDays: {
      type: Number,
      required: true,
      default: 3,
      min: 0,
    },
    carryOver: {
      type: Boolean,
      default: true,
    },
    maxDiscountPercentOfOrder: {
      type: Number,
      required: true,
      default: 15,
      min: 1,
      max: 100,
    },
    countDeliveryAndCodFees: {
      type: Boolean,
      default: false,
    },
    includedProducts: {
      type: [String],
      default: [],
    },
    maxActiveLoyaltyVouchersPerCustomer: {
      type: Number,
      required: true,
      default: 3,
      min: 1,
    },
    onReturnAfterIssue: {
      type: String,
      enum: ['flag_only', 'revoke_if_unused'],
      default: 'flag_only',
    },
    autoLinkByPhone: {
      type: Boolean,
      default: false,
    },
    programStartDate: {
      type: Date,
    },
    welcomeProgressAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedBy: {
      type: String,
      default: 'system',
      trim: true,
    },
  },
  { timestamps: true }
);

export const LoyaltySettings =
  mongoose.models.LoyaltySettings ||
  mongoose.model<ILoyaltySettings>('LoyaltySettings', LoyaltySettingsSchema);

