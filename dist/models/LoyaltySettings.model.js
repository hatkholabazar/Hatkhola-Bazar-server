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
exports.LoyaltySettings = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const LoyaltySettingsSchema = new mongoose_1.Schema({
    loyaltyEnabled: {
        type: Boolean,
        default: true,
    },
    targetAmount: {
        type: Number,
        required: true,
        default: 4000,
        min: 100,
    },
    rewardAmount: {
        type: Number,
        required: true,
        default: 250,
        min: 10,
    },
    minOrderToRedeem: {
        type: Number,
        required: true,
        default: 2000,
        min: 0,
    },
    voucherExpiryDays: {
        type: Number,
        required: true,
        default: 90,
        min: 1,
    },
    holdDays: {
        type: Number,
        required: true,
        default: 3,
        min: 0,
    },
    carryOver: {
        type: Boolean,
        default: true,
    },
    maxDiscountPercentOfOrder: {
        type: Number,
        required: true,
        default: 15,
        min: 1,
        max: 100,
    },
    countDeliveryAndCodFees: {
        type: Boolean,
        default: false,
    },
    includedProducts: {
        type: [String],
        default: [],
    },
    maxActiveLoyaltyVouchersPerCustomer: {
        type: Number,
        required: true,
        default: 3,
        min: 1,
    },
    onReturnAfterIssue: {
        type: String,
        enum: ['flag_only', 'revoke_if_unused'],
        default: 'flag_only',
    },
    autoLinkByPhone: {
        type: Boolean,
        default: false,
    },
    programStartDate: {
        type: Date,
    },
    welcomeProgressAmount: {
        type: Number,
        default: 0,
        min: 0,
    },
    updatedBy: {
        type: String,
        default: 'system',
        trim: true,
    },
}, { timestamps: true });
exports.LoyaltySettings = mongoose_1.default.models.LoyaltySettings ||
    mongoose_1.default.model('LoyaltySettings', LoyaltySettingsSchema);
