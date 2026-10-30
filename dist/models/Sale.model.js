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
exports.Sale = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AllocationSchema = new mongoose_1.Schema({
    batchId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'StockBatch', required: true },
    batchNo: { type: String, required: true },
    qtyG: { type: Number, required: true, min: 1 },
    cost: { type: Number, required: true, min: 0 },
}, { _id: false });
const SaleItemSchema = new mongoose_1.Schema({
    product: { type: mongoose_1.Schema.Types.ObjectId, ref: 'Product', required: true },
    optionLabel: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    sellingPrice: { type: Number, required: true, min: 0 },
    allocations: { type: [AllocationSchema], default: [] },
}, { _id: false });
const SaleSchema = new mongoose_1.Schema({
    soldAt: {
        type: Date,
        default: Date.now,
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
        trim: true,
    },
    customerPhone: {
        type: String,
        trim: true,
        index: true,
    },
    customerAddress: {
        type: String,
        trim: true,
    },
    courierName: {
        type: String,
        trim: true,
    },
    courierCharge: {
        type: Number,
        default: 0,
        min: 0,
    },
    courierTrackingId: {
        type: String,
        trim: true,
    },
    courierCost: {
        type: Number,
        default: 0,
        min: 0,
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
    deliveryNotes: {
        type: String,
        trim: true,
    },
    paymentTrxId: {
        type: String,
        trim: true,
    },
    channel: {
        type: String,
        enum: ['whatsapp', 'messenger', 'phone', 'other'],
        default: 'whatsapp',
    },
    paymentMethod: {
        type: String,
        enum: ['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'],
        default: 'cash_on_delivery',
    },
    items: {
        type: [SaleItemSchema],
        required: true,
    },
    giveawayG: {
        type: Number,
        default: 0,
        min: 0,
    },
    packagingCost: {
        type: Number,
        default: 0,
        min: 0,
    },
    totalRevenue: {
        type: Number,
        required: true,
        min: 0,
    },
    totalCogs: {
        type: Number,
        required: true,
        min: 0,
    },
    grossProfit: {
        type: Number,
        required: true,
    },
    status: {
        type: String,
        enum: ['completed', 'voided'],
        default: 'completed',
        index: true,
    },
    voidReason: {
        type: String,
        trim: true,
    },
    voidedAt: {
        type: Date,
    },
}, { timestamps: { createdAt: true, updatedAt: false } });
SaleSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
SaleSchema.index({ userId: 1, soldAt: -1 });
SaleSchema.index({ orderNo: 1 });
exports.Sale = mongoose_1.default.models.Sale || mongoose_1.default.model('Sale', SaleSchema);
