import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../index';
import { Product } from '../models/Product.model';
import { StockBatch } from '../models/StockBatch.model';
import { Sale } from '../models/Sale.model';
import { Counter } from '../models/Counter.model';
import { InventoryService } from '../services/inventory.service';
import { BatchNumberService } from '../services/batchNumber.service';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Start in-memory replica set to test MongoDB ACID multi-document transactions
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  // Ensure collections and unique indexes are created up-front to prevent catalog lock during transactions
  await Product.init();
  await StockBatch.init();
  await Sale.init();
  await Counter.init();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

beforeEach(async () => {
  await Product.deleteMany({});
  await StockBatch.deleteMany({});
  await Sale.deleteMany({});
  await Counter.deleteMany({});
});

describe('Hatkhola Bazar Financial Inventory & Costing Test Suite', () => {
  const adminSecret = process.env.ADMIN_API_SECRET || 'hatkhola-dev-admin-secret-2026';

  async function seedTestProduct(code: string = 'GHEE') {
    return await Product.create({
      code,
      slug: code.toLowerCase(),
      name: `${code} Pure Village Batch`,
      baseUnit: 'g',
      sellingOptions: [
        { label: '1 kg Jar', qtyG: 1000, sellingPrice: 1400 },
        { label: '500 g Jar', qtyG: 500, sellingPrice: 750 },
        { label: '400 g Custom', qtyG: 400, sellingPrice: 600 },
        { label: '100 g Trial', qtyG: 100, sellingPrice: 150 },
      ],
      isSeasonal: false,
      isActive: true,
      lowStockThresholdG: 3000,
      marginPercent: 25,
    });
  }

  // 1. Single-batch sale
  test('1. Single-batch sale correctly deducts stock and calculates COGS', async () => {
    const product = await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Kashem Ali',
      supplierPhone: '01711223344',
      orderedQtyG: 5000,
      receivedQtyG: 5000,
      productCost: 5000, // ৳ 1 per gram
      courierCharge: 200,
      codFee: 50,
      otherExtraCost: 0,
      // Total cost = 5250, received = 5000g -> 1.05 tk/g
    });

    const sale = await InventoryService.createSale({
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Jar',
          qtyG: 1000,
          sellingPrice: 1400,
        },
      ],
      packagingCost: 25,
    });

    expect(sale.status).toBe('completed');
    expect(sale.totalRevenue).toBe(1400);
    // 1000g * 5250 / 5000 = 1050
    expect(sale.totalCogs).toBe(1050);
    expect(sale.grossProfit).toBe(1400 - 1050 - 25); // 325

    const updatedBatch = await StockBatch.findById(batch._id);
    expect(updatedBatch?.qtyRemainingG).toBe(4000);
    expect(updatedBatch?.costRemaining).toBe(4200);
    expect(updatedBatch?.status).toBe('active');
  });

  // 2. Split allocation across 2 batches (500g order with 400g in batch 1 and 10,000g in batch 2)
  test('2. Split allocation: 500 g sale drawing 400 g from batch 1 and 100 g from batch 2', async () => {
    const product = await seedTestProduct('GHEE');

    // Batch 1: 400g at cost ৳ 400 (৳ 1/g)
    const b1 = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Vendor 1',
      supplierPhone: '01711111111',
      orderedQtyG: 400,
      receivedQtyG: 400,
      productCost: 400,
    });

    // Batch 2: 10,000g at cost ৳ 12,000 (৳ 1.2/g)
    const b2 = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-03'),
      receivedAt: new Date('2026-10-04'),
      supplierName: 'Vendor 2',
      supplierPhone: '01722222222',
      orderedQtyG: 10000,
      receivedQtyG: 10000,
      productCost: 12000,
    });

    const sale = await InventoryService.createSale({
      items: [
        {
          productId: String(product._id),
          optionLabel: '500 g Jar',
          qtyG: 500,
          sellingPrice: 750,
        },
      ],
      packagingCost: 20,
    });

    const allocations = sale.items[0].allocations;
    expect(allocations.length).toBe(2);

    // Allocation 1: from b1, 400g
    expect(allocations[0].batchNo).toBe(b1.batchNo);
    expect(allocations[0].qtyG).toBe(400);
    expect(allocations[0].cost).toBe(400); // Empties b1 exactly

    // Allocation 2: from b2, 100g
    expect(allocations[1].batchNo).toBe(b2.batchNo);
    expect(allocations[1].qtyG).toBe(100);
    // 100g * 12000 / 10000 = 120
    expect(allocations[1].cost).toBe(120);

    expect(sale.totalCogs).toBe(520);
    expect(sale.grossProfit).toBe(750 - 520 - 20); // 210

    const b1After = await StockBatch.findById(b1._id);
    const b2After = await StockBatch.findById(b2._id);

    expect(b1After?.qtyRemainingG).toBe(0);
    expect(b1After?.costRemaining).toBe(0);
    expect(b1After?.status).toBe('depleted');

    expect(b2After?.qtyRemainingG).toBe(9900);
    expect(b2After?.costRemaining).toBe(11880);
    expect(b2After?.status).toBe('active');
  });

  // 3. A sale spanning three batches
  test('3. Sale spanning three active batches in FIFO sequence', async () => {
    const product = await seedTestProduct('GHEE');

    const b1 = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'S1',
      supplierPhone: '01711111111',
      orderedQtyG: 200,
      receivedQtyG: 200,
      productCost: 200,
    });

    const b2 = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-02'),
      receivedAt: new Date('2026-10-03'),
      supplierName: 'S2',
      supplierPhone: '01722222222',
      orderedQtyG: 300,
      receivedQtyG: 300,
      productCost: 300,
    });

    const b3 = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-03'),
      receivedAt: new Date('2026-10-04'),
      supplierName: 'S3',
      supplierPhone: '01733333333',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
    });

    const sale = await InventoryService.createSale({
      items: [
        {
          productId: String(product._id),
          optionLabel: '600 g Bundle',
          qtyG: 600,
          sellingPrice: 900,
        },
      ],
    });

    const allocs = sale.items[0].allocations;
    expect(allocs.length).toBe(3);
    expect(allocs[0].qtyG).toBe(200); // 200 from b1
    expect(allocs[1].qtyG).toBe(300); // 300 from b2
    expect(allocs[2].qtyG).toBe(100); // 100 from b3

    const b1A = await StockBatch.findById(b1._id);
    const b2A = await StockBatch.findById(b2._id);
    const b3A = await StockBatch.findById(b3._id);

    expect(b1A?.status).toBe('depleted');
    expect(b2A?.status).toBe('depleted');
    expect(b3A?.qtyRemainingG).toBe(900);
  });

  // 4. Exact depletion (no lost taka) with awkward numbers
  test('4. Exact depletion: totalCost 10,333 over 9,800 g sold in small uneven chunks sums to exactly 10,333', async () => {
    const product = await seedTestProduct('GUR');
    const batch = await InventoryService.createBatch({
      productCode: 'GUR',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Gachi Sourcing',
      supplierPhone: '01811223344',
      orderedQtyG: 9800,
      receivedQtyG: 9800,
      productCost: 10333, // Awkward integer
    });

    // Sell in uneven quantities: 7 chunks of 1,300g (9,100g) + final chunk of 700g (completes 9,800g)
    let sumAllocatedCost = 0;

    for (let i = 0; i < 7; i++) {
      const s = await InventoryService.createSale({
        items: [
          {
            productId: String(product._id),
            optionLabel: 'Chunk',
            qtyG: 1300,
            sellingPrice: 1500,
          },
        ],
      });
      sumAllocatedCost += s.items[0].allocations[0].cost;
    }

    // Final sale of 700g that empties the batch
    const finalSale = await InventoryService.createSale({
      items: [
        {
          productId: String(product._id),
          optionLabel: 'Final Chunk',
          qtyG: 700,
          sellingPrice: 800,
        },
      ],
    });
    sumAllocatedCost += finalSale.items[0].allocations[0].cost;

    expect(sumAllocatedCost).toBe(10333); // Exactly equals totalCost! Not a single Taka lost!

    const depletedBatch = await StockBatch.findById(batch._id);
    expect(depletedBatch?.qtyRemainingG).toBe(0);
    expect(depletedBatch?.costRemaining).toBe(0);
    expect(depletedBatch?.status).toBe('depleted');
  });

  // 5. Insufficient stock is rejected and nothing changes
  test('5. Insufficient stock is rejected and leaves stock unchanged', async () => {
    const product = await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Supplier',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1200,
    });

    await expect(
      InventoryService.createSale({
        items: [
          {
            productId: String(product._id),
            optionLabel: '2 kg Jar',
            qtyG: 2000,
            sellingPrice: 2800,
          },
        ],
      })
    ).rejects.toThrow(/Insufficient stock/);

    const checkBatch = await StockBatch.findById(batch._id);
    expect(checkBatch?.qtyRemainingG).toBe(1000);
    expect(checkBatch?.costRemaining).toBe(1200);
    const saleCount = await Sale.countDocuments();
    expect(saleCount).toBe(0);
  });

  // 6. Concurrent sales cannot oversell (transaction test)
  test('6. Concurrent sales cannot oversell available stock', async () => {
    const product = await seedTestProduct('GHEE');
    await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Supplier',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1200,
    });

    // Two parallel sales of 800g when only 1000g exists
    const p1 = InventoryService.createSale({
      items: [{ productId: String(product._id), optionLabel: '800g', qtyG: 800, sellingPrice: 1000 }],
    });
    const p2 = InventoryService.createSale({
      items: [{ productId: String(product._id), optionLabel: '800g', qtyG: 800, sellingPrice: 1000 }],
    });

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const remainingStock = await StockBatch.find();
    expect(remainingStock[0].qtyRemainingG).toBe(200);
    expect(remainingStock[0].qtyRemainingG).toBeGreaterThanOrEqual(0);
  });

  // 7. A return restores the correct batches and costs
  test('7. Return restores quantity and cost back to exact original batch', async () => {
    const product = await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Supplier',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
    });

    const sale = await InventoryService.createSale({
      items: [{ productId: String(product._id), optionLabel: '500g', qtyG: 500, sellingPrice: 700 }],
    });

    expect(sale.items[0].allocations[0].qtyG).toBe(500);
    expect(sale.items[0].allocations[0].cost).toBe(500);

    const bAfterSale = await StockBatch.findById(batch._id);
    expect(bAfterSale?.qtyRemainingG).toBe(500);

    // Return the 500g allocation
    await InventoryService.processReturn(
      String(sale._id),
      [
        {
          batchId: String(batch._id),
          qtyG: 500,
          cost: 500,
        },
      ],
      'Customer changed order size'
    );

    const bAfterReturn = await StockBatch.findById(batch._id);
    expect(bAfterReturn?.qtyRemainingG).toBe(1000);
    expect(bAfterReturn?.costRemaining).toBe(1000);
    expect(bAfterReturn?.status).toBe('active');
  });

  // 8. A void sale restores stock
  test('8. Void sale restores stock to original batches', async () => {
    const product = await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Supplier',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
    });

    const sale = await InventoryService.createSale({
      items: [{ productId: String(product._id), optionLabel: '1000g', qtyG: 1000, sellingPrice: 1400 }],
    });

    const depletedBatch = await StockBatch.findById(batch._id);
    expect(depletedBatch?.status).toBe('depleted');
    expect(depletedBatch?.qtyRemainingG).toBe(0);

    // Void the sale
    await InventoryService.voidSale(String(sale._id), 'Customer canceled delivery before dispatch');

    const restoredBatch = await StockBatch.findById(batch._id);
    expect(restoredBatch?.status).toBe('active');
    expect(restoredBatch?.qtyRemainingG).toBe(1000);
    expect(restoredBatch?.costRemaining).toBe(1000);

    const voidedSale = await Sale.findById(sale._id);
    expect(voidedSale?.status).toBe('voided');
    expect(voidedSale?.voidReason).toBe('Customer canceled delivery before dispatch');
  });

  // 9. Concurrent batch creation never produces duplicate batchNo and restarts at 001 in new month
  test('9. Atomic batch numbers: concurrent creation never duplicates and SEQ restarts in new month', async () => {
    const p1 = BatchNumberService.generateBatchNo('GHEE', new Date('2026-10-15'));
    const p2 = BatchNumberService.generateBatchNo('GHEE', new Date('2026-10-15'));
    const p3 = BatchNumberService.generateBatchNo('GHEE', new Date('2026-10-15'));

    const [b1, b2, b3] = await Promise.all([p1, p2, p3]);
    const set = new Set([b1, b2, b3]);
    expect(set.size).toBe(3); // All unique!
    expect(b1).toMatch(/^GHEE-2610-\d{3}$/);

    // New month restarts at 001
    const nextMonthBatch = await BatchNumberService.generateBatchNo('GHEE', new Date('2026-11-01'));
    expect(nextMonthBatch).toBe('GHEE-2611-001');
  });

  // 10. Unit cost uses receivedQtyG when it differs from orderedQtyG
  test('10. Unit cost is calculated strictly from receivedQtyG when ordered differs', async () => {
    await seedTestProduct('GHEE');
    // Ordered 10 kg (10,000 g), but courier/weighing arrived with 9,500 g (-5% shortage)
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Vendor',
      supplierPhone: '01711111111',
      orderedQtyG: 10000,
      receivedQtyG: 9500,
      productCost: 9500, // ৳ 9,500
    });

    // costPerKg = round(9500 / 9500 * 1000) = 1000 tk/kg (not 950 tk/kg from ordered 10k)
    expect(batch.costPerKg).toBe(1000);
    expect(batch.receivedQtyG).toBe(9500);
    expect(batch.qtyRemainingG).toBe(9500);
  });

  // 11. Extra costs (courier + COD + other) are included in totalCost
  test('11. Extra costs (courier + COD + other) are summed into totalCost', async () => {
    await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Vendor',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
      courierCharge: 120,
      codFee: 30,
      otherExtraCost: 50,
    });

    expect(batch.extraCost).toBe(200);
    expect(batch.totalCost).toBe(1200);
    expect(batch.costRemaining).toBe(1200);
  });

  // 12. Duplicate-reference warning triggers for same supplier and value
  test('12. Duplicate reference check triggers for same supplier and tracking value', async () => {
    await seedTestProduct('GHEE');
    await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Sunderban Courier Vendor',
      supplierPhone: '01799887766',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
      referenceType: 'courier_tracking',
      referenceValue: 'TRACK-9988',
    });

    // Second batch with same supplier and reference should throw duplicate warning unless confirmed
    await expect(
      InventoryService.createBatch({
        productCode: 'GHEE',
        purchasedAt: new Date('2026-10-05'),
        receivedAt: new Date('2026-10-06'),
        supplierName: 'Sunderban Courier Vendor',
        supplierPhone: '01799887766',
        orderedQtyG: 1000,
        receivedQtyG: 1000,
        productCost: 1000,
        referenceType: 'courier_tracking',
        referenceValue: 'TRACK-9988',
        allowDuplicate: false,
      })
    ).rejects.toThrow(/already exists for supplier/);

    // With explicit allowDuplicate: true, it succeeds
    const allowed = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-05'),
      receivedAt: new Date('2026-10-06'),
      supplierName: 'Sunderban Courier Vendor',
      supplierPhone: '01799887766',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
      referenceType: 'courier_tracking',
      referenceValue: 'TRACK-9988',
      allowDuplicate: true,
    });
    expect(allowed.batchNo).toBeDefined();
  });

  // 13. The sign endpoint rejects non-admin users, server rejects >5MB, 6th attachment, disallowed formats
  test('13. Cloudinary endpoints: rejects non-admin, rejects >5MB, 6th attachment, and invalid formats', async () => {
    await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Vendor',
      supplierPhone: '01711111111',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      productCost: 1000,
    });

    // A. Unauthorized request to sign endpoint
    const unauthSign = await request(app).post('/api/admin/uploads/sign').send({ kind: 'courier_slip' });
    expect(unauthSign.status).toBe(401);

    // B. Authorized sign request succeeds
    const authSign = await request(app)
      .post('/api/admin/uploads/sign')
      .set('Authorization', `Bearer ${adminSecret}`)
      .send({ kind: 'courier_slip' });
    expect(authSign.status).toBe(200);
    expect(authSign.body.signature).toBeDefined();
    expect(authSign.body.timestamp).toBeDefined();

    // C. Rejects disallowed format (e.g. .exe or .zip)
    const badFormat = await request(app)
      .post(`/api/admin/batches/${batch._id}/attachments`)
      .set('Authorization', `Bearer ${adminSecret}`)
      .send({
        publicId: 'receipt_1',
        format: 'exe',
        bytes: 1000,
        kind: 'payment_receipt',
      });
    expect(badFormat.status).toBe(400);

    // D. Rejects file over 5 MB (5 * 1024 * 1024 + 1 = 5242881)
    const oversized = await request(app)
      .post(`/api/admin/batches/${batch._id}/attachments`)
      .set('Authorization', `Bearer ${adminSecret}`)
      .send({
        publicId: 'receipt_big',
        format: 'jpg',
        bytes: 6 * 1024 * 1024,
        kind: 'courier_slip',
      });
    expect(oversized.status).toBe(400);

    // E. Max 5 attachments rule
    for (let i = 1; i <= 5; i++) {
      const ok = await request(app)
        .post(`/api/admin/batches/${batch._id}/attachments`)
        .set('Authorization', `Bearer ${adminSecret}`)
        .send({
          publicId: `receipt_${i}`,
          format: 'jpg',
          bytes: 50000,
          kind: 'courier_slip',
        });
      expect(ok.status).toBe(200);
    }

    // 6th attachment rejected
    const sixth = await request(app)
      .post(`/api/admin/batches/${batch._id}/attachments`)
      .set('Authorization', `Bearer ${adminSecret}`)
      .send({
        publicId: 'receipt_6',
        format: 'jpg',
        bytes: 50000,
        kind: 'courier_slip',
      });
    expect(sixth.status).toBe(400);
    expect(sixth.body.error).toMatch(/Maximum 5 attachments allowed/);
  });

  // 14. A batch added on the stock side appears in the costing API
  test('14. Batch added on stock side appears automatically in costing and reports API', async () => {
    const product = await seedTestProduct('GHEE');
    const batch = await InventoryService.createBatch({
      productCode: 'GHEE',
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Artisan Ghee Producer',
      supplierPhone: '01700112233',
      orderedQtyG: 5000,
      receivedQtyG: 5000,
      productCost: 6000,
    });

    const costingRes = await request(app)
      .get('/api/admin/costing')
      .set('Authorization', `Bearer ${adminSecret}`);

    expect(costingRes.status).toBe(200);
    const summary = costingRes.body.costing.batchCostingSummary;
    const found = summary.find((b: any) => b.batchNo === batch.batchNo);
    expect(found).toBeDefined();
    expect(found.totalCost).toBe(6000);
    expect(found.qtyRemainingG).toBe(5000);
    expect(found.costPerKg).toBe(1200);
  });
});
