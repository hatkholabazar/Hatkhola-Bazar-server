"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const dotenv_1 = __importDefault(require("dotenv"));
const LoyaltySettings_model_1 = require("../models/LoyaltySettings.model");
const Voucher_model_1 = require("../models/Voucher.model");
dotenv_1.default.config();
async function seedLoyalty() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI is required to run seed script');
        process.exit(1);
    }
    try {
        await mongoose_1.default.connect(uri);
        console.log('Connected to MongoDB Atlas for loyalty seeding');
        // 1. Ensure LoyaltySettings document exists
        let settings = await LoyaltySettings_model_1.LoyaltySettings.findOne({ singletonKey: 'DEFAULT' });
        if (!settings) {
            settings = await LoyaltySettings_model_1.LoyaltySettings.create({
                singletonKey: 'DEFAULT',
                loyaltyEnabled: true,
                targetAmount: 4000,
                rewardAmount: 250,
                minOrderToRedeem: 2000,
                voucherExpiryDays: 90,
                holdDays: 3,
                carryOver: true,
                maxDiscountPercentOfOrder: 15,
                countDeliveryAndCodFees: false,
                includedProducts: [],
                maxActiveLoyaltyVouchersPerCustomer: 3,
                onReturnAfterIssue: 'flag_only',
                autoLinkByPhone: false,
                welcomeProgressAmount: 0,
                version: 1,
            });
            console.log('Default LoyaltySettings initialized successfully');
        }
        else {
            console.log('LoyaltySettings already exists (version ' + settings.version + ')');
        }
        // 2. Seed promotional starter vouchers if not present
        const welcomeVoucherCode = 'WELCOME100';
        const existingWelcome = await Voucher_model_1.Voucher.findOne({ code: welcomeVoucherCode });
        if (!existingWelcome) {
            const now = new Date();
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 180);
            await Voucher_model_1.Voucher.create({
                code: welcomeVoucherCode,
                source: 'custom',
                discountType: 'fixed',
                value: 100,
                minOrderAmount: 1000,
                startsAt: now,
                expiresAt,
                usageLimitTotal: 500,
                usageLimitPerCustomer: 1,
                usedCount: 0,
                reservedCount: 0,
                assignedPhone: null,
                assignedUserId: null,
                applicableProducts: [],
                excludedProducts: [],
                ignoreCap: false,
                stackable: false,
                status: 'active',
                note: 'Welcome coupon for early customers',
                createdBy: 'system',
            });
            console.log('Starter voucher WELCOME100 created');
        }
        else {
            console.log('Starter voucher WELCOME100 already exists');
        }
        console.log('Loyalty seeding complete');
        await mongoose_1.default.disconnect();
        process.exit(0);
    }
    catch (err) {
        console.error('Seeding failed:', err.message);
        if (mongoose_1.default.connection.readyState !== 0) {
            await mongoose_1.default.disconnect();
        }
        process.exit(1);
    }
}
seedLoyalty();
