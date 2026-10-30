import { z } from 'zod';

export const CreateBatchSchema = z.object({
  productCode: z.string().min(1, 'Product code is required'),
  purchasedAt: z.string().or(z.date()),
  receivedAt: z.string().or(z.date()),
  supplierName: z.string().min(1, 'Supplier name is required'),
  supplierPhone: z.string().min(5, 'Supplier phone is required'),
  orderedQtyG: z.number().int().positive('Ordered quantity must be a positive integer in grams'),
  receivedQtyG: z.number().int().positive('Received quantity must be a positive integer in grams'),
  productCost: z.number().int().nonnegative('Product cost must be a non-negative integer in Taka'),
  courierCharge: z.number().int().nonnegative().optional().default(0),
  codFee: z.number().int().nonnegative().optional().default(0),
  otherExtraCost: z.number().int().nonnegative().optional().default(0),
  paymentMethod: z
    .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
    .optional()
    .default('cash_on_delivery'),
  referenceType: z
    .enum(['courier_tracking', 'memo_invoice', 'online_order_id', 'payment_trxid', 'other', 'none'])
    .optional()
    .default('courier_tracking'),
  referenceValue: z.string().optional(),
  courierName: z
    .enum(['Pathao', 'Steadfast', 'RedX', 'Sundarban', 'SA Paribahan', 'Other'])
    .optional(),
  note: z.string().optional(),
  allowDuplicate: z.boolean().optional().default(false),
});

export const SaleItemSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  optionLabel: z.string().min(1, 'Option label is required'),
  qtyG: z.number().int().positive('Quantity must be a positive integer in grams'),
  sellingPrice: z.number().int().nonnegative('Selling price must be an integer in Taka'),
});

export const CreateSaleSchema = z.object({
  soldAt: z.string().or(z.date()).optional(),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  courierName: z.string().optional(),
  courierCharge: z.number().int().nonnegative().optional().default(0),
  courierTrackingId: z.string().optional(),
  deliveryNotes: z.string().optional(),
  paymentTrxId: z.string().optional(),
  channel: z.enum(['whatsapp', 'messenger', 'phone', 'other']).optional().default('whatsapp'),
  paymentMethod: z
    .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
    .optional()
    .default('cash_on_delivery'),
  items: z.array(SaleItemSchema).min(1, 'At least one item is required'),
  giveawayG: z.number().int().nonnegative().optional().default(0),
  packagingCost: z.number().int().nonnegative().optional(),
  voucherId: z.string().optional(),
  voucherCode: z.string().optional(),
  discountTotal: z.number().int().nonnegative().optional().default(0),
  discountSource: z.enum(['loyalty', 'custom', 'manual']).optional(),
  subtotalBeforeDiscount: z.number().int().nonnegative().optional(),
});

export const VoidSchema = z.object({
  voidReason: z.string().min(3, 'A clear reason of at least 3 characters is required'),
});

export const StockAdjustmentSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  batchId: z.string().min(1, 'Batch ID is required'),
  qtyG: z.number().int().positive('Quantity must be a positive integer in grams'),
  type: z.enum(['wastage', 'sample', 'return', 'correction', 'physical_count']),
  reason: z.string().min(3, 'Adjustment reason is required'),
});

export const PhysicalCountSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  actualWeighedQtyG: z.number().int().nonnegative('Actual weighed quantity must be non-negative in grams'),
  reason: z.string().optional().default('Routine physical count audit'),
});

export const AddAttachmentSchema = z.object({
  publicId: z.string().min(1, 'Cloudinary public_id is required'),
  resourceType: z.string().default('image'),
  format: z
    .string()
    .refine((fmt) => ['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(fmt.toLowerCase()), {
      message: 'Format must be jpg, jpeg, png, webp, or pdf',
    }),
  bytes: z.number().int().max(5 * 1024 * 1024, 'File size must not exceed 5 MB'),
  kind: z.enum(['whatsapp_chat', 'courier_slip', 'payment_receipt', 'other']),
  caption: z.string().optional(),
});

export const CreatePreOrderItemSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  optionLabel: z.string().min(1, 'Option label is required'),
  qtyG: z.number().int().positive('Quantity must be a positive integer in grams'),
  quotedPrice: z.number().int().nonnegative('Quoted price must be an integer in Taka'),
});

export const CreatePreOrderDepositSchema = z.object({
  amount: z.number().int().positive('Deposit amount must be positive integer in Taka'),
  method: z.enum(['bkash', 'nagad', 'bank', 'cash']),
  trxId: z.string().optional(),
  receivedAt: z.string().or(z.date()).optional(),
  attachment: z
    .object({
      publicId: z.string(),
      url: z.string(),
      kind: z.literal('payment_receipt').default('payment_receipt'),
    })
    .optional(),
});

export const CreatePreOrderSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  customerPhone: z.string().min(5, 'Customer phone is required'),
  channel: z.enum(['whatsapp', 'messenger', 'phone', 'other']).optional().default('whatsapp'),
  address: z.string().optional(),
  items: z.array(CreatePreOrderItemSchema).min(1, 'At least one item is required'),
  expectedDate: z.string().or(z.date()).optional(),
  note: z.string().optional(),
  deposit: CreatePreOrderDepositSchema.optional(),
});

export const AddPreOrderDepositSchema = z.object({
  amount: z.number().int().positive('Deposit amount must be positive integer in Taka'),
  method: z.enum(['bkash', 'nagad', 'bank', 'cash']),
  trxId: z.string().optional(),
  receivedAt: z.string().or(z.date()).optional(),
  attachment: z
    .object({
      publicId: z.string(),
      url: z.string(),
      kind: z.literal('payment_receipt').default('payment_receipt'),
    })
    .optional(),
});

export const FulfilPreOrderSchema = z.object({
  customerAddress: z.string().optional(),
  courierName: z.string().optional(),
  courierCharge: z.number().int().nonnegative().optional().default(0),
  courierTrackingId: z.string().optional(),
  deliveryNotes: z.string().optional(),
  paymentMethod: z
    .enum(['cash_on_delivery', 'bkash', 'nagad', 'bank', 'cash', 'other'])
    .optional()
    .default('cash_on_delivery'),
  paymentTrxId: z.string().optional(),
  fulfilledItems: z
    .array(
      z.object({
        productId: z.string(),
        qtyG: z.number().int().positive(),
        quotedPrice: z.number().int().nonnegative(),
      })
    )
    .optional(),
});

export const CancelPreOrderSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason of at least 3 characters is required'),
  refundType: z.enum(['full_refund', 'partial_refund', 'forfeit', 'none']),
  refundAmount: z.number().int().nonnegative().optional(),
  forfeitAmount: z.number().int().nonnegative().optional(),
  trxId: z.string().optional(),
});

export const AllocateBatchSchema = z.object({
  batchId: z.string().min(1, 'Batch ID is required'),
});

export const SendToPathaoSchema = z.object({
  recipientName: z
    .string()
    .min(3, 'Recipient name must be at least 3 characters')
    .max(100, 'Recipient name cannot exceed 100 characters'),
  recipientPhone: z
    .string()
    .regex(/^01\d{9}$/, 'Recipient phone must be an 11-digit Bangladeshi mobile number (01XXXXXXXXX)'),
  recipientSecondaryPhone: z
    .string()
    .regex(/^01\d{9}$/, 'Secondary phone must be an 11-digit Bangladeshi mobile number')
    .optional()
    .or(z.literal('')),
  recipientAddress: z
    .string()
    .min(10, 'Recipient address must be at least 10 characters')
    .max(220, 'Recipient address cannot exceed 220 characters'),
  recipientCity: z.number().int().positive('Recipient city is required'),
  recipientZone: z.number().int().positive('Recipient zone is required'),
  recipientArea: z.number().int().positive('Recipient area is required'),
  recipientCityName: z.string().optional(),
  recipientZoneName: z.string().optional(),
  recipientAreaName: z.string().optional(),
  storeId: z.number().int().positive().optional(),
  deliveryType: z.literal(48).or(z.literal(12)).optional().default(48),
  itemType: z.literal(1).or(z.literal(2)).optional().default(2),
  specialInstruction: z.string().max(200).optional(),
  weightOverride: z.number().min(0.5).max(10).optional(),
});

export const PublicTrackOrderSchema = z.object({
  orderNo: z.string().min(1, 'Order number is required'),
  phone: z.string().min(8, 'Phone number is required'),
});

export const PathaoWebhookSchema = z.object({
  event: z.string().optional(),
  consignment_id: z.string().optional(),
  merchant_order_id: z.string().optional(),
  order_status: z.string().optional(),
  order_status_slug: z.string().optional(),
  updated_at: z.string().optional(),
});


