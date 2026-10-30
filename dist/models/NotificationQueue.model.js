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
exports.NotificationQueue = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const NotificationQueueSchema = new mongoose_1.Schema({
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
        type: mongoose_1.Schema.Types.Mixed,
    },
}, {
    timestamps: true,
});
// Indexes for queue processing and customer lookups
NotificationQueueSchema.index({ status: 1, createdAt: 1 });
NotificationQueueSchema.index({ phone: 1, createdAt: -1 });
exports.NotificationQueue = mongoose_1.default.model('NotificationQueue', NotificationQueueSchema);
