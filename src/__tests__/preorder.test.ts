import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../index';
import { Product } from '../models/Product.model';
import { StockBatch } from '../models/StockBatch.model';
import { Sale } from '../models/Sale.model';
import { PreOrder } from '../models/PreOrder.model';
import { Counter } from '../models/Counter.model';
import { Settings } from '../models/Settings.model';
import { AuditLog } from '../models/AuditLog.model';
import { PreOrderService } from '../services/preorder.service';
import { InventoryService } from '../services/inventory.service';
import { ReportService } from '../services/report.service';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  // Initialize collections & indexes to prevent catalog locking during multi-document transactions
  await Product.init();
  await StockBatch.init();
  await Sale.init();
  await PreOrder.init();
  await Counter.init();
  await Settings.init();
  await AuditLog.init();
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
  await PreOrder.deleteMany({});
  await Counter.deleteMany({});
  await AuditLog.deleteMany({});
  await Settings.deleteMany({});

  await Settings.create({
    packagingCostPerOrder: 25,
    defaultMarginPercent: 25,
    defaultLowStockThresholdG: 5000,
    preOrderEnabled: true,
  });
});

describe('Hatkhola-Bazar Pre-Order Feature Test Suite', () => {
  const adminSecret = process.env.ADMIN_API_SECRET || 'hatkhola-dev-admin-secret-2026';

  async function seedPreOrderProduct(overrides: Record<string, any> = {}) {
    return await Product.create({
      code: 'GUR',
      slug: 'patali-gur',
      name: 'Patali Gur (খেজুরের পাটালি গুড়)',
      baseUnit: 'g',
      sellingOptions: [
        { label: '1 kg Block', qtyG: 1000, sellingPrice: 650 },
        { label: '500 g Block', qtyG: 500, sellingPrice: 350 },
      ],
      isSeasonal: true,
      isActive: true,
      availabilityMode: 'pre_order',
      preOrder: {
        expectedNote: 'Expected Mid-December Winter Harvest',
        expectedDate: new Date('2026-12-15'),
        depositRequired: true,
        depositAmount: 200,
        maxQtyG: 10000,
        cancellationPolicyText: 'Full refund up to 48 hours before shipment',
      },
      lowStockThresholdG: 3000,
      marginPercent: 25,
      ...overrides,
    });
  }

  // 1. Creating a pre-order leaves stock, batches, and revenue unchanged
  test('1. Creating a pre-order leaves stock, batches, and revenue unchanged', async () => {
    const product = await seedPreOrderProduct();

    const batch = await StockBatch.create({
      batchNo: 'GUR-2610-001',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date(),
      receivedAt: new Date(),
      supplierName: 'Village Gur Maker',
      supplierPhone: '01711223344',
      orderedQtyG: 10000,
      receivedQtyG: 10000,
      qtyRemainingG: 10000,
      productCost: 4000,
      extraCost: 200,
      totalCost: 4200,
      costRemaining: 4200,
      paymentMethod: 'cash',
      status: 'active',
    });

    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'Tanvir Ahmed',
      customerPhone: '01819223344',
      channel: 'whatsapp',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quotedPrice: 650,
        },
      ],
      deposit: {
        amount: 200,
        method: 'bkash',
        trxId: 'TRX998877',
      },
    });

    expect(preOrder.preOrderNo).toMatch(/^PRE-\d{4}-\d{3}$/);
    expect(preOrder.status).toBe('confirmed');
    expect(preOrder.depositTotal).toBe(200);

    // Assert StockBatch is completely untouched
    const freshBatch = await StockBatch.findById(batch._id);
    expect(freshBatch?.qtyRemainingG).toBe(10000);
    expect(freshBatch?.costRemaining).toBe(4200);

    // Assert No Sales and Zero Revenue
    const salesCount = await Sale.countDocuments();
    expect(salesCount).toBe(0);

    const report = await ReportService.getFinancialReport();
    expect(report.summary.totalRevenue).toBe(0);
    expect(report.summary.totalGrossProfit).toBe(0);
    expect(report.preOrders.depositsHeld).toBe(200);
  });

  // 2. The maxQtyG cap rejects an over-limit pre-order
  test('2. The maxQtyG cap rejects an over-limit pre-order', async () => {
    const product = await seedPreOrderProduct({
      preOrder: {
        expectedNote: 'Strict 5kg Harvest Cap',
        depositRequired: false,
        maxQtyG: 5000, // 5 kg limit
      },
    });

    // First pre-order: 3,000g (Succeeds)
    await PreOrderService.createPreOrder({
      customerName: 'Customer One',
      customerPhone: '01711111111',
      items: [
        {
          productId: String(product._id),
          optionLabel: '3 kg Bulk',
          qtyG: 3000,
          quotedPrice: 1950,
        },
      ],
    });

    // Second pre-order: 3,000g (Would bring total to 6,000g > 5,000g -> Must Reject)
    await expect(
      PreOrderService.createPreOrder({
        customerName: 'Customer Two',
        customerPhone: '01722222222',
        items: [
          {
            productId: String(product._id),
            optionLabel: '3 kg Bulk',
            qtyG: 3000,
            quotedPrice: 1950,
          },
        ],
      })
    ).rejects.toThrow(/pre-order cap reached/i);
  });

  // 3. Fulfilment creates a Sale with correct FIFO split allocation and exact cost rounding
  test('3. Fulfilment creates a Sale with correct FIFO split allocation and exact cost rounding', async () => {
    const product = await seedPreOrderProduct();

    // Seed Batch 1: 1,000g at landed cost ৳450
    await StockBatch.create({
      batchNo: 'GUR-2610-001',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date('2026-10-01'),
      receivedAt: new Date('2026-10-02'),
      supplierName: 'Maker 1',
      supplierPhone: '01711000001',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      qtyRemainingG: 1000,
      productCost: 450,
      extraCost: 0,
      totalCost: 450,
      costRemaining: 450,
      status: 'active',
    });

    // Seed Batch 2: 2,000g at landed cost ৳1000 (৳500 / kg)
    await StockBatch.create({
      batchNo: 'GUR-2610-002',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date('2026-10-05'),
      receivedAt: new Date('2026-10-06'),
      supplierName: 'Maker 2',
      supplierPhone: '01711000002',
      orderedQtyG: 2000,
      receivedQtyG: 2000,
      qtyRemainingG: 2000,
      productCost: 1000,
      extraCost: 0,
      totalCost: 1000,
      costRemaining: 1000,
      status: 'active',
    });

    // Create Pre-order for 1,500g
    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'Tanvir Ahmed',
      customerPhone: '01819223344',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1.5 kg Pack',
          qtyG: 1500,
          quotedPrice: 1000,
        },
      ],
      deposit: {
        amount: 300,
        method: 'bkash',
      },
    });

    // Fulfil Pre-order
    const fulfilment = await PreOrderService.fulfilPreOrder(String(preOrder._id), {
      courierCharge: 100,
      courierName: 'Steadfast',
    });

    expect(fulfilment.preOrder.status).toBe('fulfilled');
    expect(fulfilment.preOrder.fulfilledSaleId).toBeDefined();

    const sale = fulfilment.sale;
    expect(sale.totalRevenue).toBe(1000);
    // COGS: 1,000g from Batch 1 (৳450) + 500g from Batch 2 (500/2000 * 1000 = ৳250) = ৳700
    expect(sale.totalCogs).toBe(700);

    // Verify Batches depleted correctly
    const b1 = await StockBatch.findOne({ batchNo: 'GUR-2610-001' });
    const b2 = await StockBatch.findOne({ batchNo: 'GUR-2610-002' });
    expect(b1?.qtyRemainingG).toBe(0);
    expect(b1?.status).toBe('depleted');
    expect(b2?.qtyRemainingG).toBe(1500);
    expect(b2?.costRemaining).toBe(750);
  });

  // 4. Fulfilment with insufficient stock is rejected and changes nothing
  test('4. Fulfilment with insufficient stock is rejected and changes nothing', async () => {
    const product = await seedPreOrderProduct();

    // Batch with only 500g
    const batch = await StockBatch.create({
      batchNo: 'GUR-2610-001',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date(),
      receivedAt: new Date(),
      supplierName: 'Maker 1',
      supplierPhone: '01711000001',
      orderedQtyG: 500,
      receivedQtyG: 500,
      qtyRemainingG: 500,
      productCost: 250,
      extraCost: 0,
      totalCost: 250,
      costRemaining: 250,
      status: 'active',
    });

    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'Customer',
      customerPhone: '01811111111',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quotedPrice: 650,
        },
      ],
    });

    await expect(
      PreOrderService.fulfilPreOrder(String(preOrder._id))
    ).rejects.toThrow(/insufficient stock/i);

    // Batch remains untouched
    const freshBatch = await StockBatch.findById(batch._id);
    expect(freshBatch?.qtyRemainingG).toBe(500);

    // Pre-order remains pending
    const freshPreOrder = await PreOrder.findById(preOrder._id);
    expect(freshPreOrder?.status).toBe('pending');
    expect(freshPreOrder?.fulfilledSaleId).toBeUndefined();
  });

  // 5. Concurrent fulfilments cannot oversell
  test('5. Concurrent fulfilments cannot oversell', async () => {
    const product = await seedPreOrderProduct();

    // 1,000g batch in stock
    await StockBatch.create({
      batchNo: 'GUR-2610-001',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date(),
      receivedAt: new Date(),
      supplierName: 'Maker 1',
      supplierPhone: '01711000001',
      orderedQtyG: 1000,
      receivedQtyG: 1000,
      qtyRemainingG: 1000,
      productCost: 500,
      extraCost: 0,
      totalCost: 500,
      costRemaining: 500,
      status: 'active',
    });

    // Two pre-orders, each wanting 800g (Total = 1600g > 1000g available)
    const po1 = await PreOrderService.createPreOrder({
      customerName: 'Customer A',
      customerPhone: '01811111111',
      items: [
        {
          productId: String(product._id),
          optionLabel: '800g',
          qtyG: 800,
          quotedPrice: 520,
        },
      ],
    });

    const po2 = await PreOrderService.createPreOrder({
      customerName: 'Customer B',
      customerPhone: '01822222222',
      items: [
        {
          productId: String(product._id),
          optionLabel: '800g',
          qtyG: 800,
          quotedPrice: 520,
        },
      ],
    });

    const results = await Promise.allSettled([
      PreOrderService.fulfilPreOrder(String(po1._id)),
      PreOrderService.fulfilPreOrder(String(po2._id)),
    ]);

    const fulfilledCount = results.filter((r) => r.status === 'fulfilled').length;
    const rejectedCount = results.filter((r) => r.status === 'rejected').length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const b = await StockBatch.findOne({ batchNo: 'GUR-2610-001' });
    expect(b?.qtyRemainingG).toBe(200); // 1000 - 800
  });

  // 6. Deposits are not counted in revenue until fulfilment, and a cancelled pre-order with a full refund leaves the net effect at zero
  test('6. Deposits are not counted in revenue until fulfilment, and a cancelled pre-order with full refund leaves net zero', async () => {
    const product = await seedPreOrderProduct();

    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'Customer Refund',
      customerPhone: '01833333333',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quotedPrice: 650,
        },
      ],
      deposit: {
        amount: 300,
        method: 'bkash',
      },
    });

    let report = await ReportService.getFinancialReport();
    expect(report.summary.totalRevenue).toBe(0);
    expect(report.preOrders.depositsHeld).toBe(300);

    // Cancel with full refund
    const cancelled = await PreOrderService.cancelPreOrder(String(preOrder._id), {
      reason: 'Customer requested cancellation 48h prior',
      refundType: 'full_refund',
    });

    expect(cancelled.status).toBe('refunded');
    expect(cancelled.refundedTotal).toBe(300);
    expect(cancelled.forfeitedTotal).toBe(0);

    report = await ReportService.getFinancialReport();
    expect(report.summary.totalRevenue).toBe(0);
    expect(report.preOrders.depositsHeld).toBe(0);
    expect(report.preOrders.totalRefundedDeposits).toBe(300);
  });

  // 7. A forfeited deposit appears as other income only when explicitly recorded
  test('7. A forfeited deposit appears as other income only when explicitly recorded', async () => {
    const product = await seedPreOrderProduct();

    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'No Show Customer',
      customerPhone: '01844444444',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quotedPrice: 650,
        },
      ],
      deposit: {
        amount: 500,
        method: 'nagad',
      },
    });

    // Cancel with forfeit
    const cancelled = await PreOrderService.cancelPreOrder(String(preOrder._id), {
      reason: 'Late cancellation within 24h, deposit forfeited per policy',
      refundType: 'forfeit',
    });

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.forfeitedTotal).toBe(500);
    expect(cancelled.refundedTotal).toBe(0);

    const report = await ReportService.getFinancialReport();
    expect(report.summary.otherIncomeForfeited).toBe(500);
    expect(report.preOrders.otherIncomeForfeited).toBe(500);
  });

  // 8. Invalid status transitions are rejected
  test('8. Invalid status transitions are rejected', async () => {
    const product = await seedPreOrderProduct();

    const preOrder = await PreOrderService.createPreOrder({
      customerName: 'Test Status',
      customerPhone: '01855555555',
      items: [
        {
          productId: String(product._id),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quotedPrice: 650,
        },
      ],
    });

    expect(preOrder.status).toBe('pending');

    // Valid: pending -> ready
    await PreOrderService.changeStatus(String(preOrder._id), 'ready', 'Stock arrived');
    const readyOrder = await PreOrder.findById(preOrder._id);
    expect(readyOrder?.status).toBe('ready');

    // Cancel it (terminal state)
    await PreOrderService.cancelPreOrder(String(preOrder._id), {
      reason: 'Customer changed mind',
      refundType: 'none',
    });

    // Invalid: cancelled -> ready must reject
    await expect(
      PreOrderService.changeStatus(String(preOrder._id), 'ready')
    ).rejects.toThrow(/invalid status transition/i);
  });

  // 9. Concurrent pre-order creation never duplicates preOrderNo, and SEQ restarts monthly
  test('9. Concurrent pre-order creation never duplicates preOrderNo, and SEQ restarts monthly', async () => {
    const product = await seedPreOrderProduct({ preOrder: { maxQtyG: 50000 } });

    // Concurrently create 10 pre-orders
    const promises = Array.from({ length: 10 }).map((_, i) =>
      PreOrderService.createPreOrder({
        customerName: `Customer ${i}`,
        customerPhone: `0180000000${i}`,
        items: [
          {
            productId: String(product._id),
            optionLabel: '1 kg Block',
            qtyG: 1000,
            quotedPrice: 650,
          },
        ],
      })
    );

    const created = await Promise.all(promises);
    const orderNos = created.map((p) => p.preOrderNo);

    // Assert exact uniqueness
    const uniqueNos = new Set(orderNos);
    expect(uniqueNos.size).toBe(10);

    // Monthly restart test: generate for next month
    const nextMonth = new Date('2026-11-01');
    const nextMonthNo = await PreOrderService.generatePreOrderNo(nextMonth);
    expect(nextMonthNo).toBe('PRE-2611-001');
  });

  // 10. The public /api/products response never exposes costs or stock quantities
  test('10. The public /api/products response never exposes costs or stock quantities', async () => {
    const product = await seedPreOrderProduct();

    await StockBatch.create({
      batchNo: 'GUR-2610-001',
      product: product._id,
      productCode: product.code,
      purchasedAt: new Date(),
      receivedAt: new Date(),
      supplierName: 'Secret Master Artisan',
      supplierPhone: '01700998877',
      orderedQtyG: 10000,
      receivedQtyG: 10000,
      qtyRemainingG: 10000,
      productCost: 4000,
      extraCost: 200,
      totalCost: 4200,
      costRemaining: 4200,
      status: 'active',
    });

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeDefined();
    expect(res.body.success).toBe(true);

    const gur = res.body.products.find((p: any) => p.code === 'GUR');
    expect(gur).toBeDefined();
    expect(gur.availabilityMode).toBe('pre_order');
    expect(gur.preOrder.expectedNote).toBe('Expected Mid-December Winter Harvest');

    // STRICT PRIVACY: Zero exposure of costs, margins, or warehouse stock quantities
    expect(gur.productCost).toBeUndefined();
    expect(gur.totalCost).toBeUndefined();
    expect(gur.costRemaining).toBeUndefined();
    expect(gur.marginPercent).toBeUndefined();
    expect(gur.qtyRemainingG).toBeUndefined();
    expect(gur.stockGrams).toBeUndefined();
    expect(gur.supplierName).toBeUndefined();
  });

  // 11. Public endpoint auto-maps closed/capped pre-orders to out_of_stock
  test('11. Public endpoint auto-maps closed/capped pre-orders to out_of_stock', async () => {
    // Product with past closesAt
    const product = await seedPreOrderProduct({
      preOrder: {
        expectedNote: 'Past deadline',
        closesAt: new Date('2020-01-01'), // Expired
      },
    });

    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);

    const p = res.body.products.find((item: any) => item.code === product.code);
    expect(p.availabilityMode).toBe('out_of_stock');
  });
});

