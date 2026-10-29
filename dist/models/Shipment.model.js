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
exports.Shipment = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const ShipmentStatusHistorySchema = new mongoose_1.Schema({
    status: {
        type: String,
        required: true,
        enum: ['creating', 'created', 'failed', 'unknown', 'cancelled_manually'],
    },
    pathaoStatus: { type: String, trim: true },
    slug: { type: String, trim: true },
    label: { type: String, trim: true },
    pathaoUpdatedAt: { type: String, trim: true },
    fetchedAt: { type: Date, default: Date.now },
    note: { type: String, trim: true },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });
const ShipmentSchema = new mongoose_1.Schema({
    orderType: {
        type: String,
        required: true,
        enum: ['sale', 'preorder'],
        index: true,
    },
    orderId: {
        type: mongoose_1.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    orderNo: {
        type: String,
        required: true,
        index: true,
    },
    courier: {
        type: String,
        required: true,
        enum: ['pathao'],
        default: 'pathao',
    },
    consignmentId: {
        type: String,
        trim: true,
        index: true,
    },
    merchantOrderId: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    trackingUrl: {
        type: String,
        trim: true,
    },
    request: {
        type: mongoose_1.Schema.Types.Mixed,
        required: true,
    },
    amountToCollect: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    itemWeightKg: {
        type: Number,
        required: true,
        min: 0.1,
    },
    deliveryFee: {
        type: Number,
        required: true,
        min: 0,
        default: 0,
    },
    codFee: {
        type: Number,
        min: 0,
        default: 0,
    },
    pathaoStatus: {
        type: String,
        trim: true,
        default: 'Pending',
    },
    pathaoStatusSlug: {
        type: String,
        trim: true,
        default: 'pending',
        index: true,
    },
    pathaoUpdatedAt: {
        type: String,
        trim: true,
    },
    finalStatus: {
        type: Boolean,
        default: false,
        index: true,
    },
    lastRefreshedAt: {
        type: Date,
    },
    statusHistory: {
        type: [ShipmentStatusHistorySchema],
        default: [],
    },
    status: {
        type: String,
        required: true,
        enum: ['creating', 'created', 'failed', 'unknown', 'cancelled_manually'],
        default: 'creating',
        index: true,
    },
    errorMessage: {
        type: String,
        trim: true,
    },
    createdBy: {
        type: String,
        required: true,
        trim: true,
        default: 'admin',
    },
}, { timestamps: true });
// Unique partial index: An order cannot have more than one active ('creating' or 'created') shipment
ShipmentSchema.index({ orderType: 1, orderId: 1 }, {
    unique: true,
    partialFilterExpression: { status: { $in: ['creating', 'created'] } },
});
exports.Shipment = mongoose_1.default.models.Shipment || mongoose_1.default.model('Shipment', ShipmentSchema);
