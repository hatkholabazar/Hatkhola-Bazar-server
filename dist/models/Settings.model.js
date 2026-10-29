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
exports.Settings = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const SettingsSchema = new mongoose_1.Schema({
    packagingCostPerOrder: {
        type: Number,
        default: 25,
        min: 0,
    },
    defaultMarginPercent: {
        type: Number,
        default: 25,
        min: 0,
    },
    defaultLowStockThresholdG: {
        type: Number,
        default: 5000,
        min: 0,
    },
    currencyLabel: {
        type: String,
        default: '৳',
        trim: true,
    },
    preOrderEnabled: {
        type: Boolean,
        default: true,
    },
    defaultCancellationPolicyText: {
        type: String,
        default: 'Pre-orders can be cancelled with a full refund up to 48 hours before the expected shipment date.',
        trim: true,
    },
}, { timestamps: true });
exports.Settings = mongoose_1.default.models.Settings || mongoose_1.default.model('Settings', SettingsSchema);
