import { VoucherService } from '../services/voucher.service';
import { ShipmentService } from '../services/shipment.service';

describe('Loyalty & Voucher Pure Engine Unit Tests', () => {
  describe('Voucher Code Generation and Formatting', () => {
    it('generates cryptographic unguessable codes in the format HB-XXXX-XXXX', () => {
      const code1 = VoucherService.generateVoucherCode('HB');
      const code2 = VoucherService.generateVoucherCode('HB');

      expect(code1).toMatch(/^HB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code2).toMatch(/^HB-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(code1).not.toBe(code2);

      // Verify ambiguous characters (I, O, 1, 0) are strictly omitted
      expect(code1).not.toMatch(/[IO10]/);
      expect(code2).not.toMatch(/[IO10]/);
    });

    it('correctly masks voucher codes for privacy in logs', () => {
      expect(VoucherService.maskCode('HB-7KP9-2W4M')).toBe('HB-****-2W4M');
      expect(VoucherService.maskCode('HB-ABCD-EFGH')).toBe('HB-****-EFGH');
      expect(VoucherService.maskCode('TEST')).toBe('****');
      expect(VoucherService.maskCode('')).toBe('');
    });
  });

  describe('Largest-Remainder Integer Proportional Discount Allocation', () => {
    it('allocates discount across multi-item cart without losing a single taka', () => {
      const items = [
        {
          productId: 'prod1',
          productName: 'Danadar Ghee 1kg',
          lineSubtotal: 1400,
        },
        {
          productId: 'prod2',
          productName: 'Mustard Oil 1L',
          lineSubtotal: 700,
        },
        {
          productId: 'prod3',
          productName: 'Date Palm Gur',
          lineSubtotal: 450,
        },
      ];

      // Total subtotal: 1400 + 700 + 450 = 2550
      // Voucher value: 250
      const voucherValue = 250;
      const allocations = VoucherService.allocateDiscountLargestRemainder(items, voucherValue);

      expect(allocations).toHaveLength(3);

      const totalAllocated = allocations.reduce((sum: number, a) => sum + a.discountAmount, 0);
      expect(totalAllocated).toBe(voucherValue);

      // Verify integer amounts
      allocations.forEach((a) => {
        expect(Number.isInteger(a.discountAmount)).toBe(true);
        expect(a.discountAmount).toBeGreaterThan(0);
      });
    });

    it('handles single item receiving 100% of the discount', () => {
      const items = [
        {
          productId: 'prod1',
          productName: 'Danadar Ghee 1kg',
          lineSubtotal: 1400,
        },
      ];

      const voucherValue = 250;
      const allocations = VoucherService.allocateDiscountLargestRemainder(items, voucherValue);

      expect(allocations).toHaveLength(1);
      expect(allocations[0].discountAmount).toBe(voucherValue);
    });
  });

  describe('Phone Number Normalization for Accounts', () => {
    it('normalizes Bangladesh numbers from local, +880, and formatted variants', () => {
      expect(ShipmentService.normalizePhoneNumber('01712-345678')).toBe('01712345678');
      expect(ShipmentService.normalizePhoneNumber('+880 1819 334455')).toBe('01819334455');
      expect(ShipmentService.normalizePhoneNumber('8801979333880')).toBe('01979333880');
      expect(ShipmentService.normalizePhoneNumber('01300000000')).toBe('01300000000');
    });
  });
});
