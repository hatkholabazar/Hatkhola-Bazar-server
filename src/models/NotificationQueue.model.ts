import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationQueue extends Document {
  phone: string;
  type: 'voucher_issued' | 'spend_threshold_approaching';
  channel: 'sms' | 'whatsapp';
  message: string;
  metadata: {
    voucherCode?: string;
    voucherAmount?: number;
    targetAmount?: number;
    remainingAmount?: number;
    expiresAt?: Date;
  };
  status: 'queued' | 'logged' | 'sent' | 'failed';
  gatewayResponse?: any;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationQueueSchema = new Schema<INotificationQueue>(
  {
    phone: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['voucher_issued', 'spend_threshold_approaching'],
      required: true,
    },
    channel: {
      type: String,
      enum: ['sms', 'whatsapp'],
      default: 'sms',
    },
    message: {
      type: String,
      required: true,
    },
    metadata: {
      voucherCode: { type: String },
      voucherAmount: { type: Number },
      targetAmount: { type: Number },
      remainingAmount: { type: Number },
      expiresAt: { type: Date },
    },
    status: {
      type: String,
      enum: ['queued', 'logged', 'sent', 'failed'],
      default: 'queued',
      index: true,
    },
    gatewayResponse: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for queue processing and customer lookups
NotificationQueueSchema.index({ status: 1, createdAt: 1 });
NotificationQueueSchema.index({ phone: 1, createdAt: -1 });

export const NotificationQueue = mongoose.model<INotificationQueue>(
  'NotificationQueue',
  NotificationQueueSchema
);
