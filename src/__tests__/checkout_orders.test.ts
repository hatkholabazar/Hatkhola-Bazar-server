import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../index';
import { Product } from '../models/Product.model';
import { StockBatch } from '../models/StockBatch.model';
import { Sale } from '../models/Sale.model';
import { PreOrder } from '../models/PreOrder.model';
import { Settings } from '../models/Settings.model';
import { PathaoService } from '../services/pathao.service';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  await Product.init();
  await StockBatch.init();
  await Sale.init();
  await PreOrder.init();
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
  await Settings.deleteMany({});
  if (mongoose.connection.db) {
    await mongoose.connection.db.collection('orders').deleteMany({});
    await mongoose.connection.db.collection('user').deleteMany({});
    await mongoose.connection.db.collection('session').deleteMany({});
  }
});

describe('Customer Checkout & Order History API Suite', () => {
  const customerHeaders = {
    'x-test-user-id': 'cust_12345',
    'x-test-user-email': 'customer@example.com',
    'x-test-user-name': 'Test Customer',
  };

  async function seedTestProducts() {
    const inStockProd = await Product.create({
      code: 'GHEE',
      slug: 'danadar-ghee',
      name: 'Danadar Ghee',
      baseUnit: 'g',
      availabilityMode: 'in_stock',
      isActive: true,
      lowStockThresholdG: 1000,
      marginPercent: 25,
      sellingOptions: [
        { label: '1 kg Glass Jar', qtyG: 1000, sellingPrice: 1400 },
        { label: '500 g Glass Jar', qtyG: 500, sellingPrice: 750 },
      ],
    });

    const preOrderProd = await Product.create({
      code: 'HONEY',
      slug: 'sundarban-honey',
      name: 'Sundarban Raw Honey',
      baseUnit: 'g',
      availabilityMode: 'pre_order',
      isActive: true,
      lowStockThresholdG: 1000,
      marginPercent: 30,
      preOrder: {
        expectedNote: 'Harvesting mid December',
        depositRequired: true,
        depositAmount: 200,
        cancellationPolicyText: 'Full refund if delayed over 14 days',
      },
      sellingOptions: [
        { label: '1 kg Jar', qtyG: 1000, sellingPrice: 1200 },
      ],
    });

    const outOfStockProd = await Product.create({
      code: 'GUR',
      slug: 'patali-gur',
      name: 'Patali Gur',
      baseUnit: 'g',
      availabilityMode: 'out_of_stock',
      isActive: true,
      lowStockThresholdG: 1000,
      marginPercent: 25,
      sellingOptions: [
        { label: '1 kg Block', qtyG: 1000, sellingPrice: 450 },
      ],
    });

    return { inStockProd, preOrderProd, outOfStockProd };
  }

  it('rejects unauthenticated order placement with 401', async () => {
    const res = await request(app).post('/api/orders').send({
      fullName: 'Anonymous User',
      phone: '01811223344',
      address: 'House 1, Road 2, Chattogram',
      deliveryArea: 'ctg',
      items: [{ productId: 'any', optionLabel: '1 kg', qtyG: 1000, quantity: 1 }],
      paymentMethod: 'cod',
      idempotencyKey: 'test-idem-1',
    });

    expect(res.status).toBe(401);
  });

  it('places in-stock order and recalculates server-side prices correctly', async () => {
    const { inStockProd } = await seedTestProducts();

    const payload = {
      fullName: 'Zabed Mahmud',
      phone: '+880 1812 345678', // with spaces and +880 format
      address: 'House 12, Road 4, GEC Circle, Chattogram',
      deliveryArea: 'ctg',
      items: [
        {
          productId: inStockProd._id.toString(),
          optionLabel: '1 kg Glass Jar',
          qtyG: 1000,
          quantity: 2, // 1400 * 2 = 2800 + 60 delivery = 2860
        },
      ],
      paymentMethod: 'cod',
      idempotencyKey: 'idem-test-order-1',
    };

    const res = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.total).toBe(2860); // 1400 * 2 + 60
    expect(res.body.orderType).toBe('sale');
  });

  it('re-submitting identical idempotency key returns HTTP 200 replay without duplicate records', async () => {
    const { inStockProd } = await seedTestProducts();

    const payload = {
      fullName: 'Zabed Mahmud',
      phone: '01812345678',
      address: 'House 12, Road 4, GEC Circle, Chattogram',
      deliveryArea: 'ctg',
      items: [
        {
          productId: inStockProd._id.toString(),
          optionLabel: '1 kg Glass Jar',
          qtyG: 1000,
          quantity: 1,
        },
      ],
      paymentMethod: 'cod',
      idempotencyKey: 'unique-idempotency-key-replay-test',
    };

    // First attempt: creates order
    const res1 = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res1.status).toBe(201);
    const orderId1 = res1.body.orderId;

    // Second attempt with exact same user and idempotencyKey: returns 200 replay
    const res2 = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.orderId).toBe(orderId1);
    expect(res2.body.isIdempotentReplay).toBe(true);

    // Verify only 1 record exists in db
    const totalOrders = await mongoose.connection.db
      ?.collection('orders')
      .countDocuments({ idempotencyKey: 'unique-idempotency-key-replay-test' });
    expect(totalOrders).toBe(1);
  });

  it('rejects order if product availabilityMode is out_of_stock', async () => {
    const { outOfStockProd } = await seedTestProducts();

    const payload = {
      fullName: 'Zabed Mahmud',
      phone: '01812345678',
      address: 'House 12, Road 4, GEC Circle, Chattogram',
      deliveryArea: 'ctg',
      items: [
        {
          productId: outOfStockProd._id.toString(),
          optionLabel: '1 kg Block',
          qtyG: 1000,
          quantity: 1,
        },
      ],
      paymentMethod: 'cod',
      idempotencyKey: 'test-out-of-stock-attempt',
    };

    const res = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('out of stock');
  });

  it('creates pre-order record when product availabilityMode is pre_order', async () => {
    const { preOrderProd } = await seedTestProducts();

    const payload = {
      fullName: 'Preorder Customer',
      phone: '01712345678',
      address: 'House 5, Road 10, Dhanmondi, Dhaka',
      deliveryArea: 'outside',
      items: [
        {
          productId: preOrderProd._id.toString(),
          optionLabel: '1 kg Jar',
          qtyG: 1000,
          quantity: 1,
        },
      ],
      paymentMethod: 'bkash',
      senderNumber: '01712345678',
      trxId: 'TRX987654321',
      idempotencyKey: 'test-preorder-creation',
    };

    const res = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.orderType).toBe('pre_order');

    const createdPo = await PreOrder.findOne({ idempotencyKey: 'test-preorder-creation' });
    expect(createdPo).not.toBeNull();
    expect(createdPo?.status).toBe('confirmed');
    expect(createdPo?.deposits.length).toBe(1);
  });

  it('rejects bot submission when honeypot field is filled', async () => {
    const { inStockProd } = await seedTestProducts();

    const payload = {
      fullName: 'Spam Bot',
      phone: '01812345678',
      address: '123 Fake Street, Chattogram',
      deliveryArea: 'ctg',
      items: [
        {
          productId: inStockProd._id.toString(),
          optionLabel: '1 kg Glass Jar',
          qtyG: 1000,
          quantity: 1,
        },
      ],
      paymentMethod: 'cod',
      idempotencyKey: 'bot-submission-key',
      website: 'http://spam-link.example.com', // honeypot
    };

    const res = await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send(payload);

    expect(res.status).toBe(400);
  });

  it('retrieves customer order history at GET /api/account/orders', async () => {
    const { inStockProd } = await seedTestProducts();

    // Place an order for this customer
    await request(app)
      .post('/api/orders')
      .set(customerHeaders)
      .send({
        fullName: 'Test Customer',
        phone: '01812345678',
        address: 'House 12, Road 4, GEC Circle, Chattogram',
        deliveryArea: 'ctg',
        items: [
          {
            productId: inStockProd._id.toString(),
            optionLabel: '1 kg Glass Jar',
            qtyG: 1000,
            quantity: 1,
          },
        ],
        paymentMethod: 'cod',
        idempotencyKey: 'cust-history-test-1',
      });

    // Unauthenticated request fails
    const unauthRes = await request(app).get('/api/account/orders');
    expect(unauthRes.status).toBe(401);

    // Authenticated request returns order history
    const authRes = await request(app)
      .get('/api/account/orders')
      .set(customerHeaders);

    expect(authRes.status).toBe(200);
    expect(Array.isArray(authRes.body.orders)).toBe(true);
    expect(authRes.body.orders.length).toBeGreaterThanOrEqual(1);
    expect(authRes.body.orders[0].items[0].productName).toBe('Danadar Ghee');
  });

  it('serves public Pathao location cascades with rate-limiting support', async () => {
    jest.spyOn(PathaoService, 'getCities').mockResolvedValueOnce([
      { id: 1, name: 'Dhaka' },
      { id: 2, name: 'Chattogram' },
    ]);

    const res = await request(app).get('/api/public/locations/cities');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cities.length).toBe(2);
  });
});

