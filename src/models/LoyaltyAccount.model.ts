import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ILoyaltyAccount extends Document {
  phone: string; // Normalized 01XXXXXXXXX
  userId?: string | null; // Better Auth user ID if linked
  name: string;
  progressBalance: number; // Integer Taka eligible spend toward next voucher
  pendingAmount: number; // Integer Taka spend within hold period
  lifetimeEligibleSpend: number; // Total eligible delivered spend
  vouchersIssuedCount: number;
  issueSeq: number; // Atomic sequence counter for idempotent issuance
  createdAt: Date;
  updatedAt: Date;
}

const LoyaltyAccountSchema = new Schema<ILoyaltyAccount>(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      sparse: true,
      unique: true,
      trim: true,
      default: null,
    },
    name: {
      type: String,
      default: 'Valued Customer',
      trim: true,
    },
    progressBalance: {
      type: Number,
      required: true,
      default: 0,
    },
    pendingAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    lifetimeEligibleSpend: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    vouchersIssuedCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    issueSeq: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  { timestamps: true }
);

export const LoyaltyAccount =
  mongoose.models.LoyaltyAccount ||
  mongoose.model<ILoyaltyAccount>('LoyaltyAccount', LoyaltyAccountSchema);

