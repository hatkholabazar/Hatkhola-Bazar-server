"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerCreateOrderSchema = exports.CustomerOrderItemSchema = void 0;
exports.normalizeBdPhone = normalizeBdPhone;
const zod_1 = require("zod");
function normalizeBdPhone(phone) {
    const cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+880')) {
        return '0' + cleaned.slice(4);
    }
    if (cleaned.startsWith('880')) {
        return '0' + cleaned.slice(3);
    }
    return cleaned;
}
exports.CustomerOrderItemSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, 'Product ID is required'),
    optionLabel: zod_1.z.string().min(1, 'Option label is required'),
    qtyG: zod_1.z.number().int().positive('Gram quantity must be a positive integer'),
    quantity: zod_1.z.number().int().positive('Item quantity must be at least 1').default(1),
});
exports.CustomerCreateOrderSchema = zod_1.z
    .object({
    fullName: zod_1.z
        .string()
        .trim()
        .min(3, 'Full name must be at least 3 characters')
        .max(100, 'Full name cannot exceed 100 characters'),
    phone: zod_1.z
        .string()
        .trim()
        .refine((val) => {
        const norm = normalizeBdPhone(val);
        return /^01[3-9]\d{8}$/.test(norm);
    }, { message: 'Valid Bangladesh mobile number required (01XXXXXXXXX)' })
        .transform(normalizeBdPhone),
    address: zod_1.z
        .string()
        .trim()
        .min(10, 'Delivery address must be between 10 and 220 characters')
        .max(220, 'Delivery address cannot exceed 220 characters'),
    cityId: zod_1.z.number().int().positive().optional(),
    cityName: zod_1.z.string().trim().optional(),
    zoneId: zod_1.z.number().int().positive().optional(),
    zoneName: zod_1.z.string().trim().optional(),
    areaId: zod_1.z.number().int().positive().optional(),
    areaName: zod_1.z.string().trim().optional(),
    deliveryArea: zod_1.z.enum(['ctg', 'outside']).optional().default('ctg'),
    items: zod_1.z
        .array(exports.CustomerOrderItemSchema)
        .min(1, 'At least one product item is required for checkout'),
    voucherCode: zod_1.z.string().trim().max(30).optional(),
    paymentMethod: zod_1.z.enum(['cod', 'bkash', 'nagad', 'cash_on_delivery']).default('cod'),
    senderNumber: zod_1.z.string().trim().optional(),
    trxId: zod_1.z.string().trim().optional(),
    notes: zod_1.z.string().trim().max(300, 'Notes cannot exceed 300 characters').optional(),
    idempotencyKey: zod_1.z
        .string()
        .trim()
        .min(8, 'Valid idempotency key required'),
    website: zod_1.z.string().optional(), // Honeypot field
})
    .refine((data) => {
    // Honeypot check: bot filled it
    if (data.website && data.website.trim().length > 0) {
        return false;
    }
    return true;
}, { message: 'Invalid submission detected' })
    .refine((data) => {
    const isMfs = data.paymentMethod === 'bkash' || data.paymentMethod === 'nagad';
    if (isMfs && (!data.senderNumber || !data.trxId)) {
        return false;
    }
    return true;
}, { message: 'Sender phone number and Transaction ID (TrxID) are required for bKash/Nagad payments' });
