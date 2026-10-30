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
exports.Voucher = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const VoucherSchema = new mongoose_1.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
    },
    source: {
        type: String,
        required: true,
        enum: ['loyalty', 'custom', 'manual', 'compensation'],
        default: 'custom',
        index: true,
    },
    discountType: {
        type: String,
        required: true,
        enum: ['fixed', 'percent'],
        default: 'fixed',
    },
    value: {
        type: Number,
        required: true,
        min: 1,
    },
    maxDiscountAmount: {
        type: Number,
        min: 1,
    },
    minOrderAmount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
    },
    startsAt: {
        type: Date,
        required: true,
        default: Date.now,
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true,
    },
    usageLimitTotal: {
        type: Number,
        default: 1,
    },
    usageLimitPerCustomer: {
        type: Number,
        default: 1,
        min: 1,
    },
    usedCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    reservedCount: {
        type: Number,
        default: 0,
        min: 0,
    },
    assignedPhone: {
        type: String,
        default: null,
        trim: true,
        index: true,
    },
    assignedUserId: {
        type: String,
        default: null,
        trim: true,
        index: true,
    },
    applicableProducts: {
        type: [String],
        default: [],
    },
    excludedProducts: {
        type: [String],
        default: [],
    },
    ignoreCap: {
        type: Boolean,
        default: false,
    },
    stackable: {
        type: Boolean,
        default: false,
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'paused', 'redeemed', 'expired', 'voided', 'review'],
        default: 'active',
        index: true,
    },
    note: {
        type: String,
        trim: true,
    },
    voidReason: {
        type: String,
        trim: true,
    },
    createdBy: {
        type: String,
        required: true,
        default: 'admin',
        trim: true,
    },
    snapshot: {
        type: mongoose_1.Schema.Types.Mixed,
    },
}, { timestamps: true });
exports.Voucher = mongoose_1.default.models.Voucher || mongoose_1.default.model('Voucher', VoucherSchema);
