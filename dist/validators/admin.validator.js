"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PathaoWebhookSchema = exports.PublicTrackOrderSchema = exports.SendToPathaoSchema = exports.AllocateBatchSchema = exports.CancelPreOrderSchema = exports.FulfilPreOrderSchema = exports.AddPreOrderDepositSchema = exports.CreatePreOrderSchema = exports.CreatePreOrderDepositSchema = exports.CreatePreOrderItemSchema = exports.AddAttachmentSchema = exports.PhysicalCountSchema = exports.StockAdjustmentSchema = exports.VoidSchema = exports.CreateSaleSchema = exports.SaleItemSchema = exports.CreateBatchSchema = void 0;
const zod_1 = require("zod");
exports.CreateBatchSchema = zod_1.z.object({
    productCode: zod_1.z.string().min(1, 'Product code is required'),
    purchasedAt: zod_1.z.string().or(zod_1.z.date()),
    receivedAt: zod_1.z.string().or(zod_1.z.date()),
    supplierName: zod_1.z.string().min(1, 'Supplier name is required'),
    supplierPhone: zod_1.z.string().min(5, 'Supplier phone is required'),
    orderedQtyG: zod_1.z.number().int().positive('Ordered quantity must be a positive integer in grams'),
    receivedQtyG: zod_1.z.number().int().positive('Received quantity must be a positive integer in grams'),
    productCost: zod_1.z.number().int().nonnegative('Product cost must be a non-negative integer in Taka'),
    courierCharge: zod_1.z.number().int().nonnegative().optional().default(0),
    codFee: zod_1.z.number().int().nonnegative().optional().default(0),
    otherExtraCost: zod_1.z.number().int().nonnegative().optional().default(0),
    paymentMethod: zod_1.z
        .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
        .optional()
        .default('cash_on_delivery'),
    referenceType: zod_1.z
        .enum(['courier_tracking', 'memo_invoice', 'online_order_id', 'payment_trxid', 'other', 'none'])
        .optional()
        .default('courier_tracking'),
    referenceValue: zod_1.z.string().optional(),
    courierName: zod_1.z
        .enum(['Pathao', 'Steadfast', 'RedX', 'Sundarban', 'SA Paribahan', 'Other'])
        .optional(),
    note: zod_1.z.string().optional(),
    allowDuplicate: zod_1.z.boolean().optional().default(false),
});
exports.SaleItemSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, 'Product ID is required'),
    optionLabel: zod_1.z.string().min(1, 'Option label is required'),
    qtyG: zod_1.z.number().int().positive('Quantity must be a positive integer in grams'),
    sellingPrice: zod_1.z.number().int().nonnegative('Selling price must be an integer in Taka'),
});
exports.CreateSaleSchema = zod_1.z.object({
    soldAt: zod_1.z.string().or(zod_1.z.date()).optional(),
    customerName: zod_1.z.string().optional(),
    customerPhone: zod_1.z.string().optional(),
    customerAddress: zod_1.z.string().optional(),
    courierName: zod_1.z.string().optional(),
    courierCharge: zod_1.z.number().int().nonnegative().optional().default(0),
    courierTrackingId: zod_1.z.string().optional(),
    deliveryNotes: zod_1.z.string().optional(),
    paymentTrxId: zod_1.z.string().optional(),
    channel: zod_1.z.enum(['whatsapp', 'messenger', 'phone', 'other']).optional().default('whatsapp'),
    paymentMethod: zod_1.z
        .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
        .optional()
        .default('cash_on_delivery'),
    items: zod_1.z.array(exports.SaleItemSchema).min(1, 'At least one item is required'),
    giveawayG: zod_1.z.number().int().nonnegative().optional().default(0),
    packagingCost: zod_1.z.number().int().nonnegative().optional(),
});
exports.VoidSchema = zod_1.z.object({
    voidReason: zod_1.z.string().min(3, 'A clear reason of at least 3 characters is required'),
});
exports.StockAdjustmentSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, 'Product ID is required'),
    batchId: zod_1.z.string().min(1, 'Batch ID is required'),
    qtyG: zod_1.z.number().int().positive('Quantity must be a positive integer in grams'),
    type: zod_1.z.enum(['wastage', 'sample', 'return', 'correction', 'physical_count']),
    reason: zod_1.z.string().min(3, 'Adjustment reason is required'),
});
exports.PhysicalCountSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, 'Product ID is required'),
    actualWeighedQtyG: zod_1.z.number().int().nonnegative('Actual weighed quantity must be non-negative in grams'),
    reason: zod_1.z.string().optional().default('Routine physical count audit'),
});
exports.AddAttachmentSchema = zod_1.z.object({
    publicId: zod_1.z.string().min(1, 'Cloudinary public_id is required'),
    resourceType: zod_1.z.string().default('image'),
    format: zod_1.z
        .string()
        .refine((fmt) => ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(fmt.toLowerCase()), {
        message: 'Format must be jpg, jpeg, png, webp, or pdf',
    }),
    bytes: zod_1.z.number().int().max(5 * 1024 * 1024, 'File size must not exceed 5 MB'),
    kind: zod_1.z.enum(['whatsapp_chat', 'courier_slip', 'payment_receipt', 'other']),
    caption: zod_1.z.string().optional(),
});
exports.CreatePreOrderItemSchema = zod_1.z.object({
    productId: zod_1.z.string().min(1, 'Product ID is required'),
    optionLabel: zod_1.z.string().min(1, 'Option label is required'),
    qtyG: zod_1.z.number().int().positive('Quantity must be a positive integer in grams'),
    quotedPrice: zod_1.z.number().int().nonnegative('Quoted price must be an integer in Taka'),
});
exports.CreatePreOrderDepositSchema = zod_1.z.object({
    amount: zod_1.z.number().int().positive('Deposit amount must be positive integer in Taka'),
    method: zod_1.z.enum(['bkash', 'nagad', 'bank', 'cash']),
    trxId: zod_1.z.string().optional(),
    receivedAt: zod_1.z.string().or(zod_1.z.date()).optional(),
    attachment: zod_1.z
        .object({
        publicId: zod_1.z.string(),
        url: zod_1.z.string(),
        kind: zod_1.z.literal('payment_receipt').default('payment_receipt'),
    })
        .optional(),
});
exports.CreatePreOrderSchema = zod_1.z.object({
    customerName: zod_1.z.string().min(1, 'Customer name is required'),
    customerPhone: zod_1.z.string().min(5, 'Customer phone is required'),
    channel: zod_1.z.enum(['whatsapp', 'messenger', 'phone', 'other']).optional().default('whatsapp'),
    address: zod_1.z.string().optional(),
    items: zod_1.z.array(exports.CreatePreOrderItemSchema).min(1, 'At least one item is required'),
    expectedDate: zod_1.z.string().or(zod_1.z.date()).optional(),
    note: zod_1.z.string().optional(),
    deposit: exports.CreatePreOrderDepositSchema.optional(),
});
exports.AddPreOrderDepositSchema = zod_1.z.object({
    amount: zod_1.z.number().int().positive('Deposit amount must be positive integer in Taka'),
    method: zod_1.z.enum(['bkash', 'nagad', 'bank', 'cash']),
    trxId: zod_1.z.string().optional(),
    receivedAt: zod_1.z.string().or(zod_1.z.date()).optional(),
    attachment: zod_1.z
        .object({
        publicId: zod_1.z.string(),
        url: zod_1.z.string(),
        kind: zod_1.z.literal('payment_receipt').default('payment_receipt'),
    })
        .optional(),
});
exports.FulfilPreOrderSchema = zod_1.z.object({
    customerAddress: zod_1.z.string().optional(),
    courierName: zod_1.z.string().optional(),
    courierCharge: zod_1.z.number().int().nonnegative().optional().default(0),
    courierTrackingId: zod_1.z.string().optional(),
    deliveryNotes: zod_1.z.string().optional(),
    paymentMethod: zod_1.z
        .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
        .optional()
        .default('cash_on_delivery'),
    paymentTrxId: zod_1.z.string().optional(),
    fulfilledItems: zod_1.z
        .array(zod_1.z.object({
        productId: zod_1.z.string(),
        qtyG: zod_1.z.number().int().positive(),
        quotedPrice: zod_1.z.number().int().nonnegative(),
    }))
        .optional(),
});
exports.CancelPreOrderSchema = zod_1.z.object({
    reason: zod_1.z.string().min(3, 'Cancellation reason of at least 3 characters is required'),
    refundType: zod_1.z.enum(['full_refund', 'partial_refund', 'forfeit', 'none']),
    refundAmount: zod_1.z.number().int().nonnegative().optional(),
    forfeitAmount: zod_1.z.number().int().nonnegative().optional(),
    trxId: zod_1.z.string().optional(),
});
exports.AllocateBatchSchema = zod_1.z.object({
    batchId: zod_1.z.string().min(1, 'Batch ID is required'),
});
exports.SendToPathaoSchema = zod_1.z.object({
    recipientName: zod_1.z
        .string()
        .min(3, 'Recipient name must be at least 3 characters')
        .max(100, 'Recipient name cannot exceed 100 characters'),
    recipientPhone: zod_1.z
        .string()
        .regex(/^01\d{9}$/, 'Recipient phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)'),
    recipientSecondaryPhone: zod_1.z
        .string()
        .regex(/^01\d{9}$/, 'Secondary phone must be an 11-digit Bangladeshi mobile number')
        .optional()
        .or(zod_1.z.literal('')),
    recipientAddress: zod_1.z
        .string()
        .min(10, 'Recipient address must be at least 10 characters')
        .max(220, 'Recipient address cannot exceed 220 characters'),
    recipientCity: zod_1.z.number().int().positive('Recipient city is required'),
    recipientZone: zod_1.z.number().int().positive('Recipient zone is required'),
    recipientArea: zod_1.z.number().int().positive('Recipient area is required'),
    recipientCityName: zod_1.z.string().optional(),
    recipientZoneName: zod_1.z.string().optional(),
    recipientAreaName: zod_1.z.string().optional(),
    storeId: zod_1.z.number().int().positive().optional(),
    deliveryType: zod_1.z.literal(48).or(zod_1.z.literal(12)).optional().default(48),
    itemType: zod_1.z.literal(1).or(zod_1.z.literal(2)).optional().default(2),
    specialInstruction: zod_1.z.string().max(200).optional(),
    weightOverride: zod_1.z.number().min(0.5).max(10).optional(),
});
exports.PublicTrackOrderSchema = zod_1.z.object({
    orderNo: zod_1.z.string().min(1, 'Order number is required'),
    phone: zod_1.z.string().min(8, 'Phone number is required'),
});
exports.PathaoWebhookSchema = zod_1.z.object({
    event: zod_1.z.string().optional(),
    consignment_id: zod_1.z.string().optional(),
    merchant_order_id: zod_1.z.string().optional(),
    order_status: zod_1.z.string().optional(),
    order_status_slug: zod_1.z.string().optional(),
    updated_at: zod_1.z.string().optional(),
});
