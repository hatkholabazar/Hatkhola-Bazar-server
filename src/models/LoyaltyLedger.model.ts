import mongoose, { Schema, Document, Types } from 'mongoose';

export type LoyaltyLedgerType =
  | 'earn_pending'
  | 'earn_eligible'
  | 'reversal'
  | 'manual_credit'
  | 'manual_debit'
  | 'voucher_issue'
  | 'import'
  | 'welcome';

export interface ILoyaltyLedger extends Document {
  accountId: Types.ObjectId;
  type: LoyaltyLedgerType;
  amount: number; // Signed integer Taka
  orderType: 'sale' | 'preorder' | 'none';
  orderId?: string | Types.ObjectId | null;
  orderNo?: string | null;
  eligibleAt?: Date | null;
  reason: string;
  createdBy: string; // 'system' or admin email
  createdAt: Date;
}

const LoyaltyLedgerSchema = new Schema<ILoyaltyLedger>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'LoyaltyAccount',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'earn_pending',
        'earn_eligible',
        'reversal',
        'manual_credit',
        'manual_debit',
        'voucher_issue',
        'import',
        'welcome',
      ],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    orderType: {
      type: String,
      enum: ['sale', 'preorder', 'none'],
      default: 'none',
    },
    orderId: {
      type: Schema.Types.Mixed,
      default: null,
    },
    orderNo: {
      type: String,
      default: null,
      trim: true,
    },
    eligibleAt: {
      type: Date,
      default: null,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: String,
      required: true,
      default: 'system',
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Append-only ledger
  }
);

// Unique partial index on (accountId, orderId, type) for earn and reversal types
// Ensures the exact same order cannot earn twice or be reversed twice
LoyaltyLedgerSchema.index(
  { accountId: 1, orderId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      orderId: { $ne: null },
      type: { $in: ['earn_pending', 'earn_eligible', 'reversal'] },
    },
  }
);

export const LoyaltyLedger =
  mongoose.models.LoyaltyLedger ||
  mongoose.model<ILoyaltyLedger>('LoyaltyLedger', LoyaltyLedgerSchema);

