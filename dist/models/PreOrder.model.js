"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreOrder = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const DepositAttachmentSchema = new mongoose_1.Schema({
    publicId: { type: String, required: true },
    url: { type: String, required: true },
    kind: { type: String, default: 'payment_receipt', enum: ['payment_receipt'] },
}, { _id: false });
const PreOrderDepositSchema = new mongoose_1.Schema({
    depositId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: {
        type: String,
        required: true,
        enum: ['bkash', 'nagad', 'bank', 'cash'],
    },
    trxId: { type: String, trim: true },
    receivedAt: { type: Date, default: Date.now },
    attachment: { type: DepositAttachmentSchema },
}, { _id: false });
const PreOrderItemSchema = new mongoose_1.Schema({
    product: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Product', required: true },
    productCode: { type: String, required: true, uppercase: true, trim: true },
    productName: { type: String, required: true, trim: true },
    optionLabel: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    quotedPrice: { type: Number, required: true, min: 0 },
}, { _id: false });
const PreOrderStatusHistorySchema = new mongoose_1.Schema({
    status: {
        type: String,
        required: true,
        enum: ['pending', 'confirmed', 'ready', 'fulfilled', 'cancelled', 'refunded'],
    },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String, required: true, default: 'admin' },
    note: { type: String, trim: true },
}, { _id: false });
const PreOrderRefundSchema = new mongoose_1.Schema({
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, required: true, enum: ['refund', 'forfeit'] },
    reason: { type: String, required: true, trim: true },
    processedAt: { type: Date, default: Date.now },
    processedBy: { type: String, required: true, default: 'admin' },
    trxId: { type: String, trim: true },
}, { _id: false });
const PreOrderSchema = new mongoose_1.Schema({
    preOrderNo: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
    },
    userId: {
        type: String,
        index: true,
    },
    idempotencyKey: {
        type: String,
        index: true,
    },
    customerName: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    customerPhone: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    channel: {
        type: String,
        required: true,
        enum: ['whatsapp', 'messenger', 'phone', 'other'],
        default: 'whatsapp',
    },
    address: {
        type: String,
        trim: true,
    },
    recipientName: {
        type: String,
        trim: true,
    },
    recipientPhone: {
        type: String,
        trim: true,
    },
    recipientAddress: {
        type: String,
        trim: true,
    },
    pathaoCityId: {
        type: Number,
    },
    pathaoZoneId: {
        type: Number,
    },
    pathaoAreaId: {
        type: Number,
    },
    pathaoCityName: {
        type: String,
        trim: true,
    },
    pathaoZoneName: {
        type: String,
        trim: true,
    },
    pathaoAreaName: {
        type: String,
        trim: true,
    },
    courierCost: {
        type: Number,
        default: 0,
        min: 0,
    },
    items: {
        type: [PreOrderItemSchema],
        required: true,
        validate: [(val) => val.length > 0, 'Pre-order must have at least one item'],
    },
    quotedTotal: {
        type: Number,
        required: true,
        min: 0,
    },
    expectedDate: {
        type: Date,
    },
    note: {
        type: String,
        trim: true,
    },
    deposits: {
        type: [PreOrderDepositSchema],
        default: [],
    },
    depositTotal: {
        type: Number,
        default: 0,
        min: 0,
    },
    refundedTotal: {
        type: Number,
        default: 0,
        min: 0,
    },
    forfeitedTotal: {
        type: Number,
        default: 0,
        min: 0,
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'confirmed', 'ready', 'fulfilled', 'cancelled', 'refunded'],
        default: 'pending',
        index: true,
    },
    statusHistory: {
        type: [PreOrderStatusHistorySchema],
        default: [],
    },
    linkedBatchId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'StockBatch',
        index: true,
    },
    fulfilledSaleId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Sale',
        index: true,
    },
    cancelReason: {
        type: String,
        trim: true,
    },
    refunds: {
        type: [PreOrderRefundSchema],
        default: [],
    },
}, { timestamps: true });
PreOrderSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
exports.PreOrder = mongoose_1.default.models.PreOrder || mongoose_1.default.model('PreOrder', PreOrderSchema);
