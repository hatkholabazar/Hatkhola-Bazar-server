import { z } from 'zod';

export function normalizeBdPhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+880')) {
    return '0' + cleaned.slice(4);
  }
  if (cleaned.startsWith('880')) {
    return '0' + cleaned.slice(3);
  }
  return cleaned;
}

export const CustomerOrderItemSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  optionLabel: z.string().min(1, 'Option label is required'),
  qtyG: z.number().int().positive('Gram quantity must be a positive integer'),
  quantity: z.number().int().positive('Item quantity must be at least 1').default(1),
});

export const CustomerCreateOrderSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(3, 'Full name must be at least 3 characters')
      .max(100, 'Full name cannot exceed 100 characters'),
    phone: z
      .string()
      .trim()
      .refine(
        (val) => {
          const norm = normalizeBdPhone(val);
          return /^01[3-9]\d{8}$/.test(norm);
        },
        { message: 'Valid Bangladesh mobile number required (01XXXXXXXXX)' }
      )
      .transform(normalizeBdPhone),
    address: z
      .string()
      .trim()
      .min(10, 'Delivery address must be between 10 and 220 characters')
      .max(220, 'Delivery address cannot exceed 220 characters'),
    cityId: z.number().int().positive().optional(),
    cityName: z.string().trim().optional(),
    zoneId: z.number().int().positive().optional(),
    zoneName: z.string().trim().optional(),
    areaId: z.number().int().positive().optional(),
    areaName: z.string().trim().optional(),
    deliveryArea: z.enum(['ctg', 'outside']).optional().default('ctg'),
    items: z
      .array(CustomerOrderItemSchema)
      .min(1, 'At least one product item is required for checkout'),
    paymentMethod: z.enum(['cod', 'bkash', 'nagad', 'cash_on_delivery']).default('cod'),
    senderNumber: z.string().trim().optional(),
    trxId: z.string().trim().optional(),
    notes: z.string().trim().max(300, 'Notes cannot exceed 300 characters').optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(8, 'Valid idempotency key required'),
    website: z.string().optional(), // Honeypot field
  })
  .refine(
    (data) => {
      // Honeypot check: bot filled it
      if (data.website && data.website.trim().length > 0) {
        return false;
      }
      return true;
    },
    { message: 'Invalid submission detected' }
  )
  .refine(
    (data) => {
      const isMfs = data.paymentMethod === 'bkash' || data.paymentMethod === 'nagad';
      if (isMfs && (!data.senderNumber || !data.trxId)) {
        return false;
      }
      return true;
    },
    { message: 'Sender phone number and Transaction ID (TrxID) are required for bKash/Nagad payments' }
  );

