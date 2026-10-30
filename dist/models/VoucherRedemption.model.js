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
exports.VoucherRedemption = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const VoucherRedemptionSchema = new mongoose_1.Schema({
    voucherId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Voucher',
        required: true,
        index: true,
    },
    code: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        index: true,
    },
    orderType: {
        type: String,
        required: true,
        enum: ['sale', 'preorder'],
    },
    orderId: {
        type: mongoose_1.Schema.Types.Mixed,
        required: true,
        index: true,
    },
    orderNo: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    phone: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    userId: {
        type: String,
        default: null,
        trim: true,
    },
    discountAmount: {
        type: Number,
        required: true,
        min: 0,
    },
    eligibleSubtotal: {
        type: Number,
        required: true,
        min: 0,
    },
    status: {
        type: String,
        required: true,
        enum: ['reserved', 'redeemed', 'released', 'reversed'],
        default: 'reserved',
        index: true,
    },
    allocations: [
        {
            productId: { type: String, required: true },
            productName: { type: String, required: true },
            lineSubtotal: { type: Number, required: true },
            discountAmount: { type: Number, required: true },
        },
    ],
    statusHistory: [
        {
            status: { type: String, required: true },
            note: { type: String },
            updatedAt: { type: Date, default: Date.now },
        },
    ],
}, { timestamps: true });
// Unique index on (voucherId, orderId)
VoucherRedemptionSchema.index({ voucherId: 1, orderId: 1 }, { unique: true });
exports.VoucherRedemption = mongoose_1.default.models.VoucherRedemption ||
    mongoose_1.default.model('VoucherRedemption', VoucherRedemptionSchema);
