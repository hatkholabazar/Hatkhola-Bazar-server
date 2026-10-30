import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import app from '../index';
import { Product } from '../models/Product.model';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
  await Product.init();
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) {
    await replSet.stop();
  }
});

describe('Admin Security Lockdown Suite', () => {
  it('returns 404 Not Found to conceal admin endpoints for unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/products');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });

  it('returns 404 Not Found for authenticated customer sessions attempting to access admin routes', async () => {
    // Normal customer credentials
    const customerHeaders = {
      'x-session-token': 'customer_session_token_123',
    };

    const res = await request(app)
      .get('/api/admin/products')
      .set(customerHeaders);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not Found');
  });

  it('allows access for authenticated admin with test admin flag or secret', async () => {
    const adminHeaders = {
      'x-test-admin': 'true',
    };

    const res = await request(app)
      .get('/api/admin/products')
      .set(adminHeaders);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

