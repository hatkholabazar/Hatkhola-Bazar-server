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
exports.Product = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const SellingOptionSchema = new mongoose_1.Schema({
    label: { type: String, required: true, trim: true },
    qtyG: { type: Number, required: true, min: 1 },
    sellingPrice: { type: Number, required: true, min: 0 },
}, { _id: false });
const ProductSchema = new mongoose_1.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        index: true,
    },
    slug: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    baseUnit: {
        type: String,
        default: 'g',
        enum: ['g'],
    },
    sellingOptions: {
        type: [SellingOptionSchema],
        default: [],
    },
    isSeasonal: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true,
    },
    availabilityMode: {
        type: String,
        enum: ['in_stock', 'pre_order', 'out_of_stock'],
        default: 'in_stock',
        index: true,
    },
    preOrder: {
        expectedDate: { type: Date },
        expectedNote: { type: String, trim: true },
        depositRequired: { type: Boolean, default: false },
        depositAmount: { type: Number, min: 0 },
        depositPercent: { type: Number, min: 0, max: 100 },
        maxQtyG: { type: Number, min: 0 },
        closesAt: { type: Date },
        cancellationPolicyText: { type: String, trim: true },
    },
    lowStockThresholdG: {
        type: Number,
        default: 5000, // 5 kg
        min: 0,
    },
    marginPercent: {
        type: Number,
        default: 25,
        min: 0,
    },
    description: {
        type: String,
        trim: true,
    },
    benefits: {
        type: [String],
        default: [],
    },
    image: {
        type: String,
        trim: true,
    },
}, { timestamps: true });
exports.Product = mongoose_1.default.models.Product || mongoose_1.default.model('Product', ProductSchema);
