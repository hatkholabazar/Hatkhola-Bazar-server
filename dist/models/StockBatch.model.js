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
exports.StockBatch = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AttachmentSchema = new mongoose_1.Schema({
    publicId: { type: String, required: true },
    resourceType: { type: String, default: 'image' },
    format: { type: String, required: true },
    bytes: { type: Number, required: true },
    kind: {
        type: String,
        enum: ['whatsapp_chat', 'courier_slip', 'payment_receipt', 'other'],
        required: true,
    },
    caption: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now },
    removedAt: { type: Date },
    removedReason: { type: String, trim: true },
}, { _id: false });
const StockBatchSchema = new mongoose_1.Schema({
    batchNo: {
        type: String,
        required: true,
        unique: true,
        immutable: true,
        index: true,
    },
    product: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
        index: true,
    },
    purchasedAt: {
        type: Date,
        required: true,
        index: true,
    },
    receivedAt: {
        type: Date,
        required: true,
    },
    supplierName: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    supplierPhone: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    orderedQtyG: {
        type: Number,
        required: true,
        min: 1,
    },
    receivedQtyG: {
        type: Number,
        required: true,
        min: 1,
    },
    qtyRemainingG: {
        type: Number,
        required: true,
        min: 0,
        index: true,
    },
    productCost: {
        type: Number,
        required: true,
        min: 0,
    },
    courierCharge: {
        type: Number,
        default: 0,
        min: 0,
    },
    codFee: {
        type: Number,
        default: 0,
        min: 0,
    },
    otherExtraCost: {
        type: Number,
        default: 0,
        min: 0,
    },
    extraCost: {
        type: Number,
        required: true,
        min: 0,
    },
    totalCost: {
        type: Number,
        required: true,
        min: 0,
    },
    costRemaining: {
        type: Number,
        required: true,
        min: 0,
    },
    paymentMethod: {
        type: String,
        enum: ['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'],
        default: 'cash_on_delivery',
    },
    referenceType: {
        type: String,
        enum: ['courier_tracking', 'memo_invoice', 'online_order_id', 'payment_trxid', 'other', 'none'],
        default: 'courier_tracking',
    },
    referenceValue: {
        type: String,
        trim: true,
        index: true,
    },
    courierName: {
        type: String,
        enum: ['Pathao', 'Steadfast', 'RedX', 'Sundarban', 'SA Paribahan', 'Other'],
    },
    attachments: {
        type: [AttachmentSchema],
        default: [],
    },
    status: {
        type: String,
        enum: ['active', 'depleted', 'voided'],
        default: 'active',
        index: true,
    },
    voidReason: {
        type: String,
        trim: true,
    },
    voidedAt: {
        type: Date,
    },
    note: {
        type: String,
        trim: true,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
});
// Virtual: cost per kg = round(totalCost / receivedQtyG * 1000)
StockBatchSchema.virtual('costPerKg').get(function () {
    if (!this.receivedQtyG || this.receivedQtyG <= 0)
        return 0;
    return Math.round((this.totalCost / this.receivedQtyG) * 1000);
});
exports.StockBatch = mongoose_1.default.models.StockBatch || mongoose_1.default.model('StockBatch', StockBatchSchema);
