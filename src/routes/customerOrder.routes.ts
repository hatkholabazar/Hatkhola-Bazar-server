import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CustomerOrderController } from '../controllers/customerOrder.controller';
import { requireCustomerAuth } from '../middlewares/customerAuth.middleware';

export const customerOrderRouter = Router();

// Order creation rate limiter (15 requests per 15 min per IP)
const orderCreationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many order requests. Please try again in a few minutes.' },
});

// Location lookups rate limiter (100 requests per 15 min per IP)
const locationLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many location requests. Please try again shortly.' },
});

// Customer order submission
customerOrderRouter.post(
  '/orders',
  orderCreationLimiter,
  requireCustomerAuth,
  CustomerOrderController.createOrder
);

// Customer order history
customerOrderRouter.get(
  '/account/orders',
  requireCustomerAuth,
  CustomerOrderController.getMyOrders
);

// Public Pathao location cascades
customerOrderRouter.get(
  '/public/locations/cities',
  locationLookupLimiter,
  CustomerOrderController.getPublicCities
);

customerOrderRouter.get(
  '/public/locations/cities/:cityId/zones',
  locationLookupLimiter,
  CustomerOrderController.getPublicZones
);

customerOrderRouter.get(
  '/public/locations/zones/:zoneId/areas',
  locationLookupLimiter,
  CustomerOrderController.getPublicAreas
);

