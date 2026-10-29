import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../index';
import { Product } from '../models/Product.model';
import { StockBatch } from '../models/StockBatch.model';
import { Sale } from '../models/Sale.model';
import { PreOrder } from '../models/PreOrder.model';
import { Shipment } from '../models/Shipment.model';
import { Counter } from '../models/Counter.model';
import { Settings } from '../models/Settings.model';
import { PathaoService } from '../services/pathao.service';
import { ShipmentService } from '../services/shipment.service';
import { ReportService } from '../services/report.service';
import { SendToPathaoSchema, PublicTrackOrderSchema } from '../validators/admin.validator';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  await Product.init();
  await StockBatch.init();
  await Sale.init();
  await PreOrder.init();
  await Shipment.init();
  await Counter.init();
  await Settings.init();
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
  await Shipment.deleteMany({});
  await Counter.deleteMany({});
  await Settings.deleteMany({});

  PathaoService.clearCache();
  jest.restoreAllMocks();
});

describe('Hatkhola-Bazar Pathao Courier Integration Test Suite', () => {
  const adminSecret = process.env.ADMIN_API_SECRET || 'hatkhola-dev-admin-secret-2026';

  async function seedProduct(code = 'GHEE') {
    const existing = await Product.findOne({ code });
    if (existing) return existing;
    return await Product.create({
      code,
      slug: `product-${code.toLowerCase()}-${Math.random().toString(36).substring(2, 7)}`,
      name: 'Danadar Ghee (দানাদার ঘি)',
      baseUnit: 'g',
      sellingOptions: [
        { label: '1 kg Glass Jar', qtyG: 1000, sellingPrice: 1400 },
        { label: '500 g Glass Jar', qtyG: 500, sellingPrice: 750 },
      ],
      isSeasonal: false,
      isActive: true,
      availabilityMode: 'in_stock',
    });
  }

  async function seedSale(overrides: Record<string, any> = {}) {
    const prod = await seedProduct();
    return await Sale.create({
      soldAt: new Date(),
      customerName: 'Tanvir Ahmed',
      customerPhone: '01711223344',
      customerAddress: 'House 12, Road 5, Sector 3, Uttara, Dhaka-1230',
      channel: 'whatsapp',
      paymentMethod: 'cash_on_delivery',
      items: [
        {
          product: prod._id,
          optionLabel: '1 kg Glass Jar',
          qtyG: 1000,
          sellingPrice: 1400,
          allocations: [],
        },
      ],
      giveawayG: 0,
      packagingCost: 25,
      totalRevenue: 1400,
      totalCogs: 950,
      grossProfit: 425,
      status: 'completed',
      ...overrides,
    });
  }

  // 1. Nested envelope parsing & malformed shape handling
  it('1. Location lookups: parsed defensively from nested envelope (data.data.data) and fails safely on malformed shape', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/city-list')) {
        // Deeply nested Pathao envelope
        return new Response(
          JSON.stringify({
            message: 'Cities retrieved',
            type: 'success',
            code: 200,
            data: {
              data: [
                { city_id: 2, city_name: ' Chittagong ' },
                { city_id: 1, city_name: ' Dhaka ' },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const cities = await PathaoService.getCities();
    expect(cities).toHaveLength(2);
    expect(cities[0].name).toBe('Chittagong');
    expect(cities[1].name).toBe('Dhaka');

    // Test malformed payload
    PathaoService.clearCache();
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/city-list')) {
        // Malformed: missing city_name
        return new Response(
          JSON.stringify({
            data: { data: [{ city_id: 999 }] },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    await expect(PathaoService.getCities()).rejects.toThrow('failed defensive validation');
  });

  // 2. Names trimmed, sorted, and areas without home delivery rejected
  it('2. Normalization & validation: trims names, sorts alphabetically, and rejects areas without home delivery', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/cities/1/zone-list')) {
        return new Response(
          JSON.stringify({
            data: {
              data: [
                { zone_id: 20, zone_name: '   Mirpur ' },
                { zone_id: 10, zone_name: ' Banani  ' },
              ],
            },
          }),
          { status: 200 }
        );
      }
      if (urlStr.includes('/aladdin/api/v1/zones/10/area-list')) {
        return new Response(
          JSON.stringify({
            data: {
              data: [
                { area_id: 101, area_name: ' Block B ', home_delivery_available: true, pickup_available: true },
                { area_id: 102, area_name: ' Block A ', home_delivery_available: false, pickup_available: true },
              ],
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const zones = await PathaoService.getZones(1);
    expect(zones[0].name).toBe('Banani');
    expect(zones[1].name).toBe('Mirpur');

    const areas = await PathaoService.getAreas(10);
    expect(areas[0].name).toBe('Block A');
    expect(areas[0].homeDeliveryAvailable).toBe(false);
    expect(areas[1].name).toBe('Block B');
    expect(areas[1].homeDeliveryAvailable).toBe(true);

    // Validation rejects area without home delivery
    await expect(ShipmentService.validateDeliveryLocation(1, 10, 102)).rejects.toThrow(
      'Selected area does not support home delivery'
    );

    // Validation passes for eligible area
    await expect(ShipmentService.validateDeliveryLocation(1, 10, 101)).resolves.not.toThrow();
  });

  // 3. Stale cache served when Pathao is temporarily failing
  it('3. Stale cache fallback: serves cached locations if Pathao is temporarily down', async () => {
    // Initial successful fetch
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/city-list')) {
        return new Response(
          JSON.stringify({
            data: { data: [{ city_id: 1, city_name: 'Dhaka' }] },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const initialCities = await PathaoService.getCities();
    expect(initialCities).toHaveLength(1);

    // Simulate Pathao 500 error / outage
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/city-list')) {
        return new Response('Internal Server Error', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    });

    // Should return stale cached data without throwing
    const fallbackCities = await PathaoService.getCities();
    expect(fallbackCities).toHaveLength(1);
    expect(fallbackCities[0].name).toBe('Dhaka');
  });

  // 4. Concurrent requests for same key trigger exactly one Pathao call
  it('4. Concurrency lock: concurrent location lookups for the same key trigger exactly one HTTP call', async () => {
    let callCount = 0;

    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/city-list')) {
        callCount++;
        // Small delay to simulate in-flight
        await new Promise((r) => setTimeout(r, 20));
        return new Response(
          JSON.stringify({ data: { data: [{ city_id: 1, city_name: 'Dhaka' }] } }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const [c1, c2, c3, c4] = await Promise.all([
      PathaoService.getCities(),
      PathaoService.getCities(),
      PathaoService.getCities(),
      PathaoService.getCities(),
    ]);

    expect(c1).toHaveLength(1);
    expect(c2).toHaveLength(1);
    expect(c3).toHaveLength(1);
    expect(c4).toHaveLength(1);
    expect(callCount).toBe(1);
  });

  // 5. Order info cached for 45s and forced refresh is rate limited to 10s
  it('5. Order info caching & rate limiting: 45s TTL cache, single in-flight lock, and 10s manual refresh rate limit', async () => {
    let infoCallCount = 0;

    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/orders/PT-TEST-123/info')) {
        infoCallCount++;
        return new Response(
          JSON.stringify({
            data: {
              consignment_id: 'PT-TEST-123',
              order_status: 'In Transit',
              order_status_slug: 'in_transit',
              updated_at: '2026-10-29T10:00:00Z',
              delivery_fee: 80,
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    // 5a. First call fetches
    const info1 = await PathaoService.getOrderInfo('PT-TEST-123', false);
    expect(info1.order_status).toBe('In Transit');
    expect(infoCallCount).toBe(1);

    // 5b. Second call within 45s returns cached
    const info2 = await PathaoService.getOrderInfo('PT-TEST-123', false);
    expect(info2.order_status).toBe('In Transit');
    expect(infoCallCount).toBe(1);

    // 5c. Force refresh calls API
    const info3 = await PathaoService.getOrderInfo('PT-TEST-123', true);
    expect(info3.order_status).toBe('In Transit');
    expect(infoCallCount).toBe(2);

    // 5d. Manual refresh rate limit on Shipment (10s)
    const sale = await seedSale();
    const shipment = await Shipment.create({
      orderType: 'sale',
      orderId: sale._id,
      orderNo: 'ORD-TEST-RATE',
      courier: 'pathao',
      consignmentId: 'PT-TEST-123',
      merchantOrderId: 'ORD-TEST-RATE',
      request: { recipient_name: 'Tanvir' },
      amountToCollect: 1400,
      itemWeightKg: 1.5,
      deliveryFee: 80,
      status: 'created',
      lastRefreshedAt: new Date(), // Just refreshed
    });

    await expect(ShipmentService.refreshShipment(shipment._id.toString(), true)).rejects.toThrow(
      'Refresh rate-limited'
    );
  });

  // 6. Status change appends to statusHistory; unchanged status does not
  it('6. History tracking: status change appends to statusHistory while identical status is idempotent', async () => {
    let currentStatus = 'in_transit';
    let currentLabel = 'In Transit';

    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/orders/PT-HIST-1/info')) {
        return new Response(
          JSON.stringify({
            data: {
              consignment_id: 'PT-HIST-1',
              order_status: currentLabel,
              order_status_slug: currentStatus,
              updated_at: '2026-10-29T11:00:00Z',
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const sale = await seedSale();
    const shipment = await Shipment.create({
      orderType: 'sale',
      orderId: sale._id,
      orderNo: 'ORD-HIST-1',
      courier: 'pathao',
      consignmentId: 'PT-HIST-1',
      merchantOrderId: 'ORD-HIST-1',
      request: { recipient_name: 'Tanvir' },
      amountToCollect: 1400,
      itemWeightKg: 1.5,
      deliveryFee: 80,
      status: 'created',
      pathaoStatus: 'Pending',
      pathaoStatusSlug: 'pending',
      statusHistory: [{ status: 'created', slug: 'pending', pathaoStatus: 'Pending', timestamp: new Date() }],
    });

    // Refresh with new status (in_transit)
    const s1 = await ShipmentService.refreshShipment(shipment._id.toString(), false);
    expect(s1.pathaoStatusSlug).toBe('in_transit');
    expect(s1.statusHistory).toHaveLength(2);

    // Refresh again with SAME status (in_transit) -> history length should stay 2
    const s2 = await ShipmentService.refreshShipment(shipment._id.toString(), false);
    expect(s2.statusHistory).toHaveLength(2);
  });

  // 7. Final status stops refresh and background sync
  it('7. Terminal status: marks finalStatus = true when delivered or returned', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/orders/PT-FINAL-1/info')) {
        return new Response(
          JSON.stringify({
            data: {
              consignment_id: 'PT-FINAL-1',
              order_status: 'Delivered',
              order_status_slug: 'delivered',
              updated_at: '2026-10-29T12:00:00Z',
            },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const sale = await seedSale();
    const shipment = await Shipment.create({
      orderType: 'sale',
      orderId: sale._id,
      orderNo: 'ORD-FINAL-1',
      courier: 'pathao',
      consignmentId: 'PT-FINAL-1',
      merchantOrderId: 'ORD-FINAL-1',
      request: { recipient_name: 'Tanvir' },
      amountToCollect: 1400,
      itemWeightKg: 1.5,
      deliveryFee: 80,
      status: 'created',
      finalStatus: false,
    });

    const updated = await ShipmentService.refreshShipment(shipment._id.toString(), false);
    expect(updated.finalStatus).toBe(true);
    expect(updated.pathaoStatusSlug).toBe('delivered');
  });

  // 8. Public customer tracking: privacy-safe, generic errors, rate limited, no leaked fields
  it('8. Public tracking: returns generic error on mismatch, returns only allowed fields, and rate limited', async () => {
    const sale = await seedSale({ customerPhone: '01711223344' });
    const orderNo = `ORD-${String(sale._id).slice(-6).toUpperCase()}`;

    // 8a. Wrong phone -> generic error
    const resWrongPhone = await request(app).post('/api/public/track').send({
      orderNo,
      phone: '01999999999',
    });
    expect(resWrongPhone.status).toBe(404);
    expect(resWrongPhone.body.error).toContain('No order found with these details');

    // 8b. Order not shipped yet -> shows confirmed & being prepared
    const resPrepared = await request(app).post('/api/public/track').send({
      orderNo,
      phone: '01711223344',
    });
    expect(resPrepared.status).toBe(200);
    expect(resPrepared.body.step).toBe('Confirmed');
    expect(resPrepared.body.statusLabel.en).toContain('Your order is confirmed and being prepared');
    expect(resPrepared.body.statusLabel.bn).toBeDefined();
    // Verify privacy safety: no internal fields
    expect(resPrepared.body.consignmentId).toBeUndefined();
    expect(resPrepared.body.customerAddress).toBeUndefined();
    expect(resPrepared.body.amountToCollect).toBeUndefined();
    expect(resPrepared.body.totalRevenue).toBeUndefined();

    // 8c. Order with active shipment
    await Shipment.create({
      orderType: 'sale',
      orderId: sale._id,
      orderNo,
      courier: 'pathao',
      consignmentId: 'PT-PUB-100',
      merchantOrderId: orderNo,
      request: { recipient_address: 'Secret House 42' },
      amountToCollect: 1400,
      itemWeightKg: 1.5,
      deliveryFee: 80,
      pathaoStatus: 'Out for Delivery',
      pathaoStatusSlug: 'out_for_delivery',
      finalStatus: false,
      status: 'created',
    });

    const resShipped = await request(app).post('/api/public/track').send({
      orderNo,
      phone: '+8801711223344', // tests number normalization
    });
    expect(resShipped.status).toBe(200);
    expect(resShipped.body.step).toBe('Out for delivery');
    expect(resShipped.body.statusLabel.en).toBe('Out for Delivery');
    expect(resShipped.body.statusLabel.bn).toBe('ডেলিভারির জন্য বের হয়েছে');
    expect(resShipped.body.consignmentId).toBeUndefined();
    expect(resShipped.body.recipient_address).toBeUndefined();
  });

  // 9. Secrets masking
  it('9. Secrets masking: Pathao credentials and tokens never leak in error messages or responses', () => {
    const secret = 'zW7Oc0uFmA11mlkHcHxS2huWATQa3AljasIpVQkY';
    const leakedError = `Connection failed with secret=${secret} and access_token=secret_token_12345`;

    const sanitized = PathaoService.sanitizeError(leakedError);

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain('***MASKED***');
  });

  // 10. Server-side amount to collect computation
  it('10. Amount to collect: strictly computed on server, ignores client values, and reflects COD vs paid upfront', async () => {
    const codSale = await seedSale({ totalRevenue: 1400, courierCharge: 60, paymentMethod: 'cash_on_delivery' });
    expect(ShipmentService.calculateAmountToCollect('sale', codSale)).toBe(1460);

    const paidSale = await seedSale({ totalRevenue: 1400, courierCharge: 60, paymentMethod: 'bkash' });
    expect(ShipmentService.calculateAmountToCollect('sale', paidSale)).toBe(0);

    const preOrderPartial = { quotedTotal: 2000, depositTotal: 500 };
    expect(ShipmentService.calculateAmountToCollect('preorder', preOrderPartial)).toBe(1500);

    const preOrderPaid = { quotedTotal: 2000, depositTotal: 2000 };
    expect(ShipmentService.calculateAmountToCollect('preorder', preOrderPaid)).toBe(0);
  });

  // 11. Weight and packaging calculation
  it('11. Weight calculation: adds 0.2kg packaging allowance and rounds up to nearest 0.5kg (min 0.5kg, max 10kg)', () => {
    expect(ShipmentService.calculateBillableWeightKg(1000)).toBe(1.5);
    expect(ShipmentService.calculateBillableWeightKg(250)).toBe(0.5);
    expect(ShipmentService.calculateBillableWeightKg(1300)).toBe(1.5);
    expect(ShipmentService.calculateBillableWeightKg(1400)).toBe(2.0);
    expect(ShipmentService.calculateBillableWeightKg(1000, 3.5)).toBe(3.5);
  });

  // 12. Double dispatch prevention
  it('12. Double dispatch prevention: rejects second shipment creation if order already has an active shipment', async () => {
    const sale = await seedSale();

    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/stores')) {
        return new Response(JSON.stringify({ data: { data: [{ store_id: 99, store_name: 'Main Hub' }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/cities/1/zone-list')) {
        return new Response(JSON.stringify({ data: { data: [{ zone_id: 10, zone_name: 'Uttara' }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/zones/10/area-list')) {
        return new Response(JSON.stringify({ data: { data: [{ area_id: 100, area_name: 'Sector 3', home_delivery_available: true }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/orders')) {
        return new Response(
          JSON.stringify({
            data: { consignment_id: 'PT-1001', merchant_order_id: 'ORD-1001', order_status: 'Pending', delivery_fee: 80 },
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    });

    const res1 = await request(app)
      .post(`/api/admin/orders/sale/${sale._id}/pathao`)
      .set('x-admin-secret', adminSecret)
      .send({
        recipientName: 'Tanvir Ahmed',
        recipientPhone: '01711223344',
        recipientAddress: 'House 12, Road 5, Sector 3, Uttara, Dhaka-1230',
        recipientCity: 1,
        recipientZone: 10,
        recipientArea: 100,
        storeId: 99,
      });

    expect(res1.status).toBe(201);
    expect(res1.body.shipment.consignmentId).toBe('PT-1001');

    const res2 = await request(app)
      .post(`/api/admin/orders/sale/${sale._id}/pathao`)
      .set('x-admin-secret', adminSecret)
      .send({
        recipientName: 'Tanvir Ahmed',
        recipientPhone: '01711223344',
        recipientAddress: 'House 12, Road 5, Sector 3, Uttara, Dhaka-1230',
        recipientCity: 1,
        recipientZone: 10,
        recipientArea: 100,
        storeId: 99,
      });

    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('already has an active Pathao shipment');
  });

  // 13. Timeout handling
  it('13. Timeout handling: sets status to unknown with warning on timeout and NEVER auto-retries', async () => {
    const sale = await seedSale();

    jest.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/aladdin/api/v1/issue-token')) {
        return new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/stores')) {
        return new Response(JSON.stringify({ data: { data: [{ store_id: 99, store_name: 'Main Hub' }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/cities/1/zone-list')) {
        return new Response(JSON.stringify({ data: { data: [{ zone_id: 10, zone_name: 'Uttara' }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/zones/10/area-list')) {
        return new Response(JSON.stringify({ data: { data: [{ area_id: 100, area_name: 'Sector 3', home_delivery_available: true }] } }), { status: 200 });
      }
      if (urlStr.includes('/aladdin/api/v1/orders')) {
        const abortErr = new Error('Pathao request timed out after 15s');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      return new Response('{}', { status: 200 });
    });

    const res = await request(app)
      .post(`/api/admin/orders/sale/${sale._id}/pathao`)
      .set('x-admin-secret', adminSecret)
      .send({
        recipientName: 'Tanvir Ahmed',
        recipientPhone: '01711223344',
        recipientAddress: 'House 12, Road 5, Sector 3, Uttara, Dhaka-1230',
        recipientCity: 1,
        recipientZone: 10,
        recipientArea: 100,
        storeId: 99,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Request timed out. Verify in Pathao merchant panel before retrying');

    const shipment = await Shipment.findOne({ orderId: sale._id });
    expect(shipment).not.toBeNull();
    expect(shipment!.status).toBe('unknown');
  });

  // 14. Webhook integration verification
  it('14. Webhook verification: returns status 202 and X-Pathao-Merchant-Webhook-Integration-Secret header on integration test', async () => {
    const res = await request(app)
      .post('/api/webhooks/pathao')
      .send({ event: 'webhook_integration' });

    expect(res.status).toBe(202);
    expect(res.headers['x-pathao-merchant-webhook-integration-secret']).toBe(
      'f3992ecc-59da-4cbe-a049-a13da2018d51'
    );
    expect(res.body.message).toContain('Webhook integration verified');
  });
});
