import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuditEntityType =
  | 'product'
  | 'preorder'
  | 'batch'
  | 'sale'
  | 'loyalty_settings'
  | 'loyalty_account'
  | 'voucher'
  | 'voucher_redemption';

export interface IAuditLog extends Document {
  entityType: AuditEntityType;
  entityId: Types.ObjectId | string;
  action: string;
  actor: string;
  fromState?: any;
  toState?: any;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    entityType: {
      type: String,
      required: true,
      enum: [
        'product',
        'preorder',
        'batch',
        'sale',
        'loyalty_settings',
        'loyalty_account',
        'voucher',
        'voucher_redemption',
      ],
      index: true,
    },
    entityId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    actor: {
      type: String,
      required: true,
      default: 'admin',
      trim: true,
    },
    fromState: {
      type: Schema.Types.Mixed,
    },
    toState: {
      type: Schema.Types.Mixed,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AuditLog =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

