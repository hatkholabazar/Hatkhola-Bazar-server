"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const admin_controller_1 = require("../controllers/admin.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const rateLimiter_1 = require("../middlewares/rateLimiter");
const router = (0, express_1.Router)();
// Publicly reachable admin login (rate-limited)
router.post('/auth/login', rateLimiter_1.adminAuthLimiter, admin_controller_1.AdminController.login);
// All subsequent routes require Admin Auth and general admin rate limiting
router.use(rateLimiter_1.adminRateLimiter);
router.use(auth_middleware_1.requireAdminAuth);
// Products CRUD
router.get('/products', admin_controller_1.AdminController.getProducts);
router.get('/products/:id', admin_controller_1.AdminController.getProductById);
router.get('/products/:id/audit', admin_controller_1.AdminController.getProductAuditLogs);
router.post('/products', admin_controller_1.AdminController.upsertProduct);
router.put('/products/:id', admin_controller_1.AdminController.updateProduct);
router.delete('/products/:id', admin_controller_1.AdminController.deleteProduct);
// Pre-Orders
router.get('/preorders/metrics', admin_controller_1.AdminController.getPreOrderMetrics);
router.get('/preorders', admin_controller_1.AdminController.getPreOrders);
router.get('/preorders/:id', admin_controller_1.AdminController.getPreOrderDetail);
router.post('/preorders', admin_controller_1.AdminController.createPreOrder);
router.post('/preorders/allocate-batch', admin_controller_1.AdminController.autoAllocateBatchToOpenPreOrders);
router.post('/preorders/:id/deposits', admin_controller_1.AdminController.addPreOrderDeposit);
router.post('/preorders/:id/allocate-batch', admin_controller_1.AdminController.allocateBatchToPreOrder);
router.post('/preorders/:id/fulfil', admin_controller_1.AdminController.fulfilPreOrder);
router.post('/preorders/:id/cancel', admin_controller_1.AdminController.cancelPreOrder);
router.patch('/preorders/:id/status', admin_controller_1.AdminController.updatePreOrderStatus);
// Batches
router.post('/batches', admin_controller_1.AdminController.createBatch);
router.get('/batches', admin_controller_1.AdminController.getBatches);
router.get('/batches/:id', admin_controller_1.AdminController.getBatchDetail);
router.post('/batches/:id/void', admin_controller_1.AdminController.voidBatch);
router.post('/batches/:id/attachments', admin_controller_1.AdminController.addAttachment);
router.delete('/batches/:id/attachments/:publicId', admin_controller_1.AdminController.removeAttachment);
router.get('/attachments/:batchId/:publicId/url', admin_controller_1.AdminController.getAttachmentUrl);
router.post('/uploads/sign', admin_controller_1.AdminController.getUploadSignature);
// Sales & FIFO
router.post('/sales/preview', admin_controller_1.AdminController.previewSaleAllocation);
router.post('/sales', admin_controller_1.AdminController.createSale);
router.get('/sales', admin_controller_1.AdminController.getSales);
router.post('/sales/:id/void', admin_controller_1.AdminController.voidSale);
router.post('/sales/:id/return', admin_controller_1.AdminController.returnSaleItem);
// Adjustments
router.post('/adjustments', admin_controller_1.AdminController.createAdjustment);
router.post('/adjustments/physical-count', admin_controller_1.AdminController.reconcilePhysicalCount);
// Reports & Costing Intelligence
router.get('/reports', admin_controller_1.AdminController.getReports);
router.get('/costing', admin_controller_1.AdminController.getCosting);
// Pathao Courier Logistics
router.get('/pathao/locations/cities', admin_controller_1.AdminController.getPathaoCities);
router.get('/pathao/locations/cities/:cityId/zones', admin_controller_1.AdminController.getPathaoZones);
router.get('/pathao/locations/zones/:cityId', admin_controller_1.AdminController.getPathaoZones);
router.get('/pathao/locations/zones/:zoneId/areas', admin_controller_1.AdminController.getPathaoAreas);
router.get('/pathao/locations/areas/:zoneId', admin_controller_1.AdminController.getPathaoAreas);
router.get('/pathao/stores', admin_controller_1.AdminController.getPathaoStores);
router.post('/pathao/price-plan', admin_controller_1.AdminController.calculatePathaoPrice);
router.get('/pathao/status', admin_controller_1.AdminController.getPathaoStatus);
router.post('/orders/:type/:id/pathao', admin_controller_1.AdminController.dispatchOrderToPathao);
router.get('/orders/:type/:id/shipment', admin_controller_1.AdminController.getOrderShipment);
router.get('/shipments', admin_controller_1.AdminController.getShipments);
router.get('/shipments/export/csv', admin_controller_1.AdminController.exportShipmentsCsv);
router.get('/shipments/:id/status', admin_controller_1.AdminController.getShipmentStatus);
router.post('/shipments/:id/refresh', admin_controller_1.AdminController.refreshShipment);
router.post('/shipments/:id/cancel', admin_controller_1.AdminController.cancelShipment);
exports.adminRouter = router;
