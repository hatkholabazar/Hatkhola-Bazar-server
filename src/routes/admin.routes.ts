import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { requireAdminAuth } from '../middlewares/auth.middleware';
import { adminRateLimiter, adminAuthLimiter } from '../middlewares/rateLimiter';

const router = Router();

// Publicly reachable admin login (rate-limited)
router.post('/auth/login', adminAuthLimiter, AdminController.login);

// All subsequent routes require Admin Auth and general admin rate limiting
router.use(adminRateLimiter);
router.use(requireAdminAuth);

// Products CRUD
router.get('/products', AdminController.getProducts);
router.get('/products/:id', AdminController.getProductById);
router.get('/products/:id/audit', AdminController.getProductAuditLogs);
router.post('/products', AdminController.upsertProduct);
router.put('/products/:id', AdminController.updateProduct);
router.delete('/products/:id', AdminController.deleteProduct);

// Pre-Orders
router.get('/preorders/metrics', AdminController.getPreOrderMetrics);
router.get('/preorders', AdminController.getPreOrders);
router.get('/preorders/:id', AdminController.getPreOrderDetail);
router.post('/preorders', AdminController.createPreOrder);
router.post('/preorders/allocate-batch', AdminController.autoAllocateBatchToOpenPreOrders);
router.post('/preorders/:id/deposits', AdminController.addPreOrderDeposit);
router.post('/preorders/:id/allocate-batch', AdminController.allocateBatchToPreOrder);
router.post('/preorders/:id/fulfil', AdminController.fulfilPreOrder);
router.post('/preorders/:id/cancel', AdminController.cancelPreOrder);
router.patch('/preorders/:id/status', AdminController.updatePreOrderStatus);

// Batches
router.post('/batches', AdminController.createBatch);
router.get('/batches', AdminController.getBatches);
router.get('/batches/:id', AdminController.getBatchDetail);
router.post('/batches/:id/void', AdminController.voidBatch);
router.post('/batches/:id/attachments', AdminController.addAttachment);
router.delete('/batches/:id/attachments/:publicId', AdminController.removeAttachment);
router.get('/attachments/:batchId/:publicId/url', AdminController.getAttachmentUrl);
router.post('/uploads/sign', AdminController.getUploadSignature);
router.post('/uploads/direct', AdminController.directUpload);

// Sales & FIFO
router.post('/sales/preview', AdminController.previewSaleAllocation);
router.post('/sales', AdminController.createSale);
router.get('/sales', AdminController.getSales);
router.post('/sales/:id/void', AdminController.voidSale);
router.post('/sales/:id/return', AdminController.returnSaleItem);

// Adjustments
router.post('/adjustments', AdminController.createAdjustment);
router.post('/adjustments/physical-count', AdminController.reconcilePhysicalCount);

// Reports & Costing Intelligence
router.get('/reports', AdminController.getReports);
router.get('/costing', AdminController.getCosting);

// Pathao Courier Logistics
router.get('/pathao/locations/cities', AdminController.getPathaoCities);
router.get('/pathao/locations/cities/:cityId/zones', AdminController.getPathaoZones);
router.get('/pathao/locations/zones/:cityId', AdminController.getPathaoZones);
router.get('/pathao/locations/zones/:zoneId/areas', AdminController.getPathaoAreas);
router.get('/pathao/locations/areas/:zoneId', AdminController.getPathaoAreas);
router.get('/pathao/stores', AdminController.getPathaoStores);
router.post('/pathao/price-plan', AdminController.calculatePathaoPrice);
router.get('/pathao/status', AdminController.getPathaoStatus);

router.post('/orders/:type/:id/pathao', AdminController.dispatchOrderToPathao);
router.get('/orders/:type/:id/shipment', AdminController.getOrderShipment);

router.get('/shipments', AdminController.getShipments);
router.get('/shipments/export/csv', AdminController.exportShipmentsCsv);
router.get('/shipments/:id/status', AdminController.getShipmentStatus);
router.post('/shipments/:id/refresh', AdminController.refreshShipment);
router.post('/shipments/:id/cancel', AdminController.cancelShipment);

export const adminRouter = router;

