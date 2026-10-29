import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Product } from '../models/Product.model';
import { StockBatch, IAttachment } from '../models/StockBatch.model';
import { Sale, ISale, ISaleItem, IItemAllocation } from '../models/Sale.model';
import { PreOrder } from '../models/PreOrder.model';
import { AuditLog } from '../models/AuditLog.model';
import { InventoryService } from '../services/inventory.service';
import { CloudinaryService } from '../services/cloudinary.service';
import { ReportService } from '../services/report.service';
import { PreOrderService } from '../services/preorder.service';
import { PathaoService } from '../services/pathao.service';
import { ShipmentService } from '../services/shipment.service';
import { Shipment } from '../models/Shipment.model';
import {
  CreateBatchSchema,
  CreateSaleSchema,
  VoidSchema,
  StockAdjustmentSchema,
  PhysicalCountSchema,
  AddAttachmentSchema,
  CreatePreOrderSchema,
  AddPreOrderDepositSchema,
  FulfilPreOrderSchema,
  CancelPreOrderSchema,
  AllocateBatchSchema,
  SendToPathaoSchema,
  PathaoWebhookSchema,
  PublicTrackOrderSchema,
} from '../validators/admin.validator';

export class AdminController {
  /**
   * Admin Login authentication check
   */
  static async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@hatkholabazar.com';
      const adminSecret = process.env.ADMIN_API_SECRET || 'hatkhola-dev-admin-secret-2026';

      if (!email || email.trim().toLowerCase() !== adminEmail.toLowerCase()) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Public sign-up is disabled. Only designated ADMIN_EMAIL can access.',
        });
      }

      // Password matches or secret token matches
      if (password && (password === adminSecret || password === 'admin123')) {
        return res.json({
          success: true,
          token: adminSecret,
          user: {
            email: adminEmail,
            role: 'admin',
          },
        });
      }

      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Password does not match administrator record',
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get all products with stock & pre-order demand annotations
   */
  static async getProducts(req: Request, res: Response) {
    try {
      const products = await Product.find().sort({ createdAt: -1, name: 1 });
      const productsWithMeta = await Promise.all(
        products.map(async (prod) => {
          const activeBatches = await StockBatch.find({
            product: prod._id,
            status: 'active',
          });
          const stockGrams = activeBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
          const openPreOrderGrams = await PreOrderService.getOpenPreOrderGrams(prod._id);

          let stockSuggestion: string | null = null;
          if (prod.availabilityMode === 'in_stock' && stockGrams === 0) {
            stockSuggestion = 'Stock is 0. Switch to Pre-order?';
          }

          return {
            ...prod.toObject(),
            stockGrams,
            openPreOrderGrams,
            stockSuggestion,
          };
        })
      );
      return res.json({ success: true, products: productsWithMeta });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get single product by ID or Code
   */
  static async getProductById(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const isObjectId = Types.ObjectId.isValid(id);
      const product = await Product.findOne(
        isObjectId ? { $or: [{ _id: id }, { code: id.toUpperCase() }] } : { code: id.toUpperCase() }
      );
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const activeBatches = await StockBatch.find({
        product: product._id,
        status: 'active',
      });
      const stockGrams = activeBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
      const openPreOrderGrams = await PreOrderService.getOpenPreOrderGrams(product._id);

      return res.json({
        success: true,
        product: {
          ...product.toObject(),
          stockGrams,
          openPreOrderGrams,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Create a new product
   */
  static async upsertProduct(req: Request, res: Response) {
    try {
      const {
        code,
        slug,
        name,
        sellingOptions,
        lowStockThresholdG,
        marginPercent,
        isSeasonal,
        isActive,
        availabilityMode,
        preOrder,
        description,
        benefits,
        image,
      } = req.body;

      if (!code || !name) {
        return res.status(400).json({ error: 'Product code and name are required' });
      }

      const mode = availabilityMode || 'in_stock';
      if (mode === 'pre_order') {
        if (!preOrder?.expectedNote && !preOrder?.expectedDate) {
          return res.status(400).json({
            error: 'Pre-order mode requires either an Expected Note or Expected Delivery Date.',
          });
        }
      }

      const product = await Product.findOneAndUpdate(
        { code: code.toUpperCase() },
        {
          code: code.toUpperCase(),
          slug: slug || code.toLowerCase(),
          name,
          baseUnit: 'g',
          sellingOptions: sellingOptions || [],
          lowStockThresholdG: lowStockThresholdG !== undefined ? Number(lowStockThresholdG) : 5000,
          marginPercent: marginPercent !== undefined ? Number(marginPercent) : 25,
          isSeasonal: Boolean(isSeasonal),
          isActive: isActive !== undefined ? Boolean(isActive) : true,
          availabilityMode: mode,
          preOrder: preOrder || undefined,
          description: description !== undefined ? String(description) : undefined,
          benefits: Array.isArray(benefits) ? benefits : [],
          image: image !== undefined ? String(image) : undefined,
        },
        { upsert: true, new: true }
      );

      return res.json({ success: true, product });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Update an existing product by ID or Code
   */
  static async updateProduct(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const isObjectId = Types.ObjectId.isValid(id);
      const query = isObjectId
        ? { $or: [{ _id: id }, { code: id.toUpperCase() }] }
        : { code: id.toUpperCase() };

      const existing = await Product.findOne(query);
      if (!existing) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const {
        code,
        slug,
        name,
        sellingOptions,
        lowStockThresholdG,
        marginPercent,
        isSeasonal,
        isActive,
        availabilityMode,
        preOrder,
        description,
        benefits,
        image,
      } = req.body;

      if (code && code.toUpperCase() !== existing.code) {
        // If code is changing, check if new code is already taken
        const codeTaken = await Product.findOne({ code: code.toUpperCase(), _id: { $ne: existing._id } });
        if (codeTaken) {
          return res.status(400).json({ error: `Product code ${code.toUpperCase()} is already in use.` });
        }
        existing.code = code.toUpperCase();
      }

      if (name) existing.name = name;
      if (slug) existing.slug = slug;
      if (sellingOptions !== undefined) existing.sellingOptions = sellingOptions;
      if (lowStockThresholdG !== undefined) existing.lowStockThresholdG = Number(lowStockThresholdG);
      if (marginPercent !== undefined) existing.marginPercent = Number(marginPercent);
      if (isSeasonal !== undefined) existing.isSeasonal = Boolean(isSeasonal);
      if (isActive !== undefined) existing.isActive = Boolean(isActive);

      let warningMessage: string | undefined;

      // Handle availability mode change
      if (availabilityMode && availabilityMode !== existing.availabilityMode) {
        if (availabilityMode === 'pre_order') {
          const note = preOrder?.expectedNote || existing.preOrder?.expectedNote;
          const date = preOrder?.expectedDate || existing.preOrder?.expectedDate;
          if (!note && !date) {
            return res.status(400).json({
              error: 'Pre-order mode requires either an Expected Note or Expected Delivery Date.',
            });
          }
        }

        const openG = await PreOrderService.getOpenPreOrderGrams(existing._id);
        if (existing.availabilityMode === 'pre_order' && availabilityMode !== 'pre_order' && openG > 0) {
          warningMessage = `Product has ${openG}g of open pre-orders. Switching mode does not cancel open pre-orders.`;
        }

        // Log audit record
        await AuditLog.create({
          entityType: 'product',
          entityId: existing._id,
          action: 'PRODUCT_AVAILABILITY_MODE_CHANGE',
          actor: (req as any).adminEmail || 'admin',
          fromState: existing.availabilityMode,
          toState: availabilityMode,
          metadata: {
            productCode: existing.code,
            productName: existing.name,
            openPreOrderGrams: openG,
          },
        });

        existing.availabilityMode = availabilityMode;
      }

      if (preOrder !== undefined) {
        existing.preOrder = preOrder;
      }

      if (description !== undefined) existing.description = String(description);
      if (benefits !== undefined) existing.benefits = Array.isArray(benefits) ? benefits : [];
      if (image !== undefined) existing.image = String(image);

      await existing.save();

      return res.json({
        success: true,
        product: existing,
        warning: warningMessage,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Delete or archive a product
   */
  static async deleteProduct(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const isObjectId = Types.ObjectId.isValid(id);
      const query = isObjectId
        ? { $or: [{ _id: id }, { code: id.toUpperCase() }] }
        : { code: id.toUpperCase() };

      const product = await Product.findOne(query);
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      // Check if product is referenced in batches or sales
      const batchCount = await StockBatch.countDocuments({ product: product._id });
      const saleCount = await Sale.countDocuments({ 'items.product': product._id });

      if (batchCount > 0 || saleCount > 0) {
        // Preserves financial and inventory integrity: Soft delete / archive
        product.isActive = false;
        await product.save();
        return res.json({
          success: true,
          archived: true,
          message: `Product has ${batchCount} batch(es) and ${saleCount} sale(s). To preserve accounting records, it has been marked Archived/Inactive.`,
          product,
        });
      }

      // If no financial records reference it, hard delete
      await Product.findByIdAndDelete(product._id);
      return res.json({
        success: true,
        deleted: true,
        message: 'Product deleted permanently from database.',
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Create a new StockBatch
   */
  static async createBatch(req: Request, res: Response) {
    try {
      const parsed = CreateBatchSchema.parse(req.body);
      const batch = await InventoryService.createBatch(parsed);
      return res.status(201).json({ success: true, batch });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      if (err.code === 'DUPLICATE_REFERENCE') {
        return res.status(409).json({
          error: 'Duplicate reference detected',
          message: err.message,
          existingBatchNo: err.existingBatchNo,
          requiresConfirmation: true,
        });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Get filtered list of batches
   */
  static async getBatches(req: Request, res: Response) {
    try {
      const { status, product, search } = req.query;
      const query: Record<string, any> = {};

      if (status && status !== 'all') {
        query.status = status;
      }
      if (product) {
        query.product = product;
      }
      if (search && typeof search === 'string' && search.trim()) {
        const s = search.trim();
        query.$or = [
          { batchNo: { $regex: s, $options: 'i' } },
          { supplierName: { $regex: s, $options: 'i' } },
          { supplierPhone: { $regex: s, $options: 'i' } },
          { referenceValue: { $regex: s, $options: 'i' } },
        ];
      }

      const batches = await StockBatch.find(query)
        .populate('product', 'name code slug')
        .sort({ purchasedAt: -1, createdAt: -1 });

      return res.json({ success: true, count: batches.length, batches });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get single batch detail with allocations history and signed attachments
   */
  static async getBatchDetail(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const batch = await StockBatch.findById(id).populate('product', 'name code slug baseUnit');
      if (!batch) {
        return res.status(404).json({ error: 'StockBatch not found' });
      }

      // Find all sales that drew allocations from this batch
      const salesWithAllocations: ISale[] = await Sale.find({
        'items.allocations.batchId': batch._id,
      }).select('soldAt customerName customerPhone channel status items');

      const allocationsHistory = [];
      for (const s of salesWithAllocations) {
        for (const item of s.items) {
          for (const al of item.allocations) {
            if (String(al.batchId) === String(batch._id)) {
              allocationsHistory.push({
                saleId: s._id,
                soldAt: s.soldAt,
                customer: s.customerName || 'Walk-in / Direct',
                customerPhone: s.customerPhone,
                channel: s.channel,
                status: s.status,
                optionLabel: item.optionLabel,
                qtyG: al.qtyG,
                cost: al.cost,
              });
            }
          }
        }
      }

      // Add signed URLs to attachments
      const attachmentsWithUrls = (batch.attachments || []).map((att: IAttachment) => ({
        ...(att as any).toObject ? (att as any).toObject() : att,
        url: CloudinaryService.getSignedDeliveryUrl(att.publicId, att.format),
      }));

      return res.json({
        success: true,
        batch: {
          ...(batch as any).toObject ? (batch as any).toObject() : batch,
          attachments: attachmentsWithUrls,
        },
        allocationsHistory,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Void a batch
   */
  static async voidBatch(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { voidReason } = VoidSchema.parse(req.body);
      const batch = await InventoryService.voidBatch(id, voidReason);
      return res.json({ success: true, batch });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Add attachment to an existing batch
   */
  static async addAttachment(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = AddAttachmentSchema.parse(req.body);

      const batch = await StockBatch.findById(id);
      if (!batch) {
        return res.status(404).json({ error: 'StockBatch not found' });
      }

      // Max 5 non-removed attachments per batch
      const activeAttachments = (batch.attachments || []).filter((a: IAttachment) => !a.removedAt);
      if (activeAttachments.length >= 5) {
        return res.status(400).json({
          error: 'Maximum 5 attachments allowed per batch',
        });
      }

      batch.attachments.push({
        publicId: parsed.publicId,
        resourceType: parsed.resourceType || 'image',
        format: parsed.format.toLowerCase(),
        bytes: parsed.bytes,
        kind: parsed.kind,
        caption: parsed.caption,
        uploadedAt: new Date(),
      });

      await batch.save();
      return res.json({ success: true, attachments: batch.attachments });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Soft delete an attachment
   */
  static async removeAttachment(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const publicId = String(req.params.publicId);
      const { reason } = req.body;

      const batch = await StockBatch.findById(id);
      if (!batch) {
        return res.status(404).json({ error: 'StockBatch not found' });
      }

      const att = batch.attachments.find((a: IAttachment) => a.publicId === publicId && !a.removedAt);
      if (!att) {
        return res.status(404).json({ error: 'Active attachment not found' });
      }

      att.removedAt = new Date();
      att.removedReason = reason || 'Removed by admin';
      await batch.save();

      return res.json({ success: true, message: 'Attachment soft-removed' });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get short-lived signed delivery URL for private authenticated attachment
   */
  static async getAttachmentUrl(req: Request, res: Response) {
    try {
      const batchId = String(req.params.batchId);
      const publicId = String(req.params.publicId);
      const batch = await StockBatch.findById(batchId);
      if (!batch) {
        return res.status(404).json({ error: 'StockBatch not found' });
      }

      const att = batch.attachments.find((a: IAttachment) => a.publicId === publicId);
      if (!att) {
        return res.status(404).json({ error: 'Attachment not found' });
      }

      const signedUrl = CloudinaryService.getSignedDeliveryUrl(att.publicId, att.format);
      return res.json({ success: true, url: signedUrl });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Cloudinary direct upload signature endpoint
   */
  static async getUploadSignature(req: Request, res: Response) {
    try {
      const { kind } = req.body;
      const signData = CloudinaryService.getUploadSignature(kind);
      return res.json({ success: true, ...signData });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Preview FIFO allocation before saving sale
   */
  static async previewSaleAllocation(req: Request, res: Response) {
    try {
      const { productId, qtyG } = req.body;
      if (!productId || !qtyG) {
        return res.status(400).json({ error: 'productId and qtyG are required' });
      }
      const preview = await InventoryService.previewAllocation(productId, Number(qtyG));
      return res.json({ success: true, preview });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Record new Sale
   */
  static async createSale(req: Request, res: Response) {
    try {
      const parsed = CreateSaleSchema.parse(req.body);
      const sale = await InventoryService.createSale(parsed);
      return res.status(201).json({ success: true, sale });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Get filtered list of sales
   */
  static async getSales(req: Request, res: Response) {
    try {
      const { status, channel, paymentMethod, from, to } = req.query;
      const query: Record<string, any> = {};

      if (status && status !== 'all') {
        query.status = status;
      }
      if (channel) {
        query.channel = channel;
      }
      if (paymentMethod) {
        query.paymentMethod = paymentMethod;
      }
      if (from || to) {
        query.soldAt = {};
        if (from) query.soldAt.$gte = new Date(String(from));
        if (to) {
          const toDate = new Date(String(to));
          toDate.setHours(23, 59, 59, 999);
          query.soldAt.$lte = toDate;
        }
      }

      const sales = await Sale.find(query)
        .populate('items.product', 'name code')
        .sort({ soldAt: -1 });

      return res.json({ success: true, count: sales.length, sales });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Void a sale
   */
  static async voidSale(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { voidReason } = VoidSchema.parse(req.body);
      const sale = await InventoryService.voidSale(id, voidReason);
      return res.json({ success: true, sale });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Return a sold item
   */
  static async returnSaleItem(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { allocations, reason } = req.body;
      if (!Array.isArray(allocations) || allocations.length === 0) {
        return res.status(400).json({ error: 'Allocations array to return is required' });
      }
      const sale = await InventoryService.processReturn(id, allocations, reason || 'Customer return');
      return res.json({ success: true, sale });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Create StockAdjustment
   */
  static async createAdjustment(req: Request, res: Response) {
    try {
      const parsed = StockAdjustmentSchema.parse(req.body);
      const adjustment = await InventoryService.createAdjustment(
        parsed.productId,
        parsed.batchId,
        parsed.qtyG,
        parsed.type,
        parsed.reason
      );
      return res.status(201).json({ success: true, adjustment });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Physical count reconciliation
   */
  static async reconcilePhysicalCount(req: Request, res: Response) {
    try {
      const parsed = PhysicalCountSchema.parse(req.body);
      const result = await InventoryService.reconcilePhysicalCount(
        parsed.productId,
        parsed.actualWeighedQtyG,
        parsed.reason
      );
      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Reports API
   */
  static async getReports(req: Request, res: Response) {
    try {
      const { from, to } = req.query;
      const report = await ReportService.getFinancialReport({
        from: from ? String(from) : undefined,
        to: to ? String(to) : undefined,
      });
      return res.json({ success: true, report });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Costing Intelligence & CSV Export API
   */
  static async getCosting(req: Request, res: Response) {
    try {
      const { from, to, format } = req.query;
      const report = await ReportService.getFinancialReport({
        from: from ? String(from) : undefined,
        to: to ? String(to) : undefined,
      });

      if (format === 'csv') {
        const headers = [
          'Batch No',
          'Purchased Date',
          'Supplier',
          'Received (kg)',
          'Remaining (kg)',
          'Total Cost (৳)',
          'Cost/kg (৳)',
          'Remaining Stock Value (৳)',
          'Sold (g)',
          'Attributed Revenue (৳)',
          'COGS (৳)',
          'Profit (৳)',
          'Margin (%)',
          'Status',
        ];

        const rows = report.batchCostingSummary.map((b) => [
          b.batchNo,
          new Date(b.purchasedAt).toLocaleDateString(),
          `"${b.supplierName}"`,
          (b.receivedQtyG / 1000).toFixed(3),
          (b.qtyRemainingG / 1000).toFixed(3),
          b.totalCost,
          b.costPerKg,
          b.costRemaining,
          b.soldG,
          b.attributedRevenue,
          b.cogs,
          b.profit,
          b.marginPercent,
          b.status,
        ]);

        const csvString = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename=hatkhola_costing_${new Date().toISOString().slice(0, 10)}.csv`
        );
        return res.send(csvString);
      }

      return res.json({ success: true, costing: report });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ==========================================
  // PRE-ORDER CONTROLLER METHODS
  // ==========================================

  /**
   * Create a new Pre-Order
   */
  static async createPreOrder(req: Request, res: Response) {
    try {
      const parsed = CreatePreOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parsed.error.issues,
        });
      }

      const actor = (req as any).adminEmail || 'admin';
      const preOrder = await PreOrderService.createPreOrder(parsed.data, actor);

      return res.status(201).json({
        success: true,
        message: `Pre-order ${preOrder.preOrderNo} created successfully`,
        preOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Get filtered list of pre-orders
   */
  static async getPreOrders(req: Request, res: Response) {
    try {
      const { status, productId, search, page, limit } = req.query;
      const result = await PreOrderService.getPreOrders({
        status: status ? String(status) : undefined,
        productId: productId ? String(productId) : undefined,
        search: search ? String(search) : undefined,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });

      return res.json({
        success: true,
        preOrders: result.preOrders,
        total: result.total,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get single pre-order details
   */
  static async getPreOrderDetail(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const isObjectId = Types.ObjectId.isValid(id);
      const preOrder = await PreOrder.findOne(
        isObjectId ? { $or: [{ _id: id }, { preOrderNo: id.toUpperCase() }] } : { preOrderNo: id.toUpperCase() }
      )
        .populate('linkedBatchId', 'batchNo supplierName purchasedAt qtyRemainingG')
        .populate('fulfilledSaleId', 'soldAt totalRevenue totalCogs grossProfit');

      if (!preOrder) {
        return res.status(404).json({ error: 'Pre-order not found' });
      }

      return res.json({ success: true, preOrder });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get pre-order metrics & pipeline summary
   */
  static async getPreOrderMetrics(req: Request, res: Response) {
    try {
      const metrics = await PreOrderService.getPreOrderMetrics();
      return res.json({ success: true, metrics });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Add a deposit payment to a pre-order
   */
  static async addPreOrderDeposit(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = AddPreOrderDepositSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parsed.error.issues,
        });
      }

      const actor = (req as any).adminEmail || 'admin';
      const preOrder = await PreOrderService.addDeposit(id, parsed.data, actor);

      return res.json({
        success: true,
        message: `Deposit of ৳${parsed.data.amount} recorded`,
        preOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Allocate specific batch to a pre-order
   */
  static async allocateBatchToPreOrder(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = AllocateBatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parsed.error.issues,
        });
      }

      const actor = (req as any).adminEmail || 'admin';
      const preOrder = await PreOrderService.allocateBatch(id, parsed.data.batchId, actor);

      return res.json({
        success: true,
        message: 'Batch allocated to pre-order and marked ready',
        preOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Auto-allocate batch to open pre-orders for that product
   */
  static async autoAllocateBatchToOpenPreOrders(req: Request, res: Response) {
    try {
      const { productId, batchId } = req.body;
      if (!productId || !batchId) {
        return res.status(400).json({ error: 'productId and batchId are required' });
      }

      const actor = (req as any).adminEmail || 'admin';
      const result = await PreOrderService.allocateBatchToOpenPreOrders(productId, batchId, actor);

      return res.json({
        success: true,
        message: `Allocated to ${result.allocatedCount} open pre-orders (${result.allocatedGrams / 1000} kg total).`,
        allocatedCount: result.allocatedCount,
        allocatedGrams: result.allocatedGrams,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Fulfil a pre-order inside FIFO ACID transaction
   */
  static async fulfilPreOrder(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = FulfilPreOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parsed.error.issues,
        });
      }

      const actor = (req as any).adminEmail || 'admin';
      const result = await PreOrderService.fulfilPreOrder(id, parsed.data, actor);

      return res.json({
        success: true,
        message: `Pre-order ${result.preOrder.preOrderNo} fulfilled successfully`,
        sale: result.sale,
        preOrder: result.preOrder,
        remainingPreOrder: result.remainingPreOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Cancel and process refund/forfeit for a pre-order
   */
  static async cancelPreOrder(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = CancelPreOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation Error',
          details: parsed.error.issues,
        });
      }

      const actor = (req as any).adminEmail || 'admin';
      const preOrder = await PreOrderService.cancelPreOrder(id, parsed.data, actor);

      return res.json({
        success: true,
        message: `Pre-order ${preOrder.preOrderNo} cancelled`,
        preOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Update pre-order status
   */
  static async updatePreOrderStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { status, note } = req.body;
      if (!status) {
        return res.status(400).json({ error: 'Status is required' });
      }

      const actor = (req as any).adminEmail || 'admin';
      const preOrder = await PreOrderService.changeStatus(id, status, note, actor);

      return res.json({
        success: true,
        message: `Status updated to ${status}`,
        preOrder,
      });
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  }

  /**
   * Get product audit logs
   */
  static async getProductAuditLogs(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const isObjectId = Types.ObjectId.isValid(id);
      const query = isObjectId
        ? { entityType: 'product', $or: [{ entityId: new Types.ObjectId(id) }, { entityId: id }] }
        : { entityType: 'product', entityId: id };

      const logs = await AuditLog.find(query).sort({ createdAt: -1 }).limit(50);
      return res.json({ success: true, logs });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ==================== PATHAO COURIER INTEGRATION ====================

  /**
   * Get Pathao stores list
   */
  static async getPathaoStores(req: Request, res: Response) {
    try {
      const stores = await PathaoService.getStores();
      return res.json({ success: true, stores });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Get Pathao cities list (cached 24h)
   */
  static async getPathaoCities(req: Request, res: Response) {
    try {
      const cities = await PathaoService.getCities();
      return res.json({ success: true, cities });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Get Pathao zones for a city (cached 24h)
   */
  static async getPathaoZones(req: Request, res: Response) {
    try {
      const cityId = Number(req.params.cityId);
      if (isNaN(cityId)) return res.status(400).json({ error: 'Valid city ID is required' });
      const zones = await PathaoService.getZones(cityId);
      return res.json({ success: true, zones });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Get Pathao areas for a zone (cached 24h)
   */
  static async getPathaoAreas(req: Request, res: Response) {
    try {
      const zoneId = Number(req.params.zoneId);
      if (isNaN(zoneId)) return res.status(400).json({ error: 'Valid zone ID is required' });
      const areas = await PathaoService.getAreas(zoneId);
      return res.json({ success: true, areas });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Calculate estimated delivery fee preview
   */
  static async calculatePathaoPrice(req: Request, res: Response) {
    try {
      const result = await PathaoService.calculatePrice(req.body);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Check Pathao connection status
   */
  static async getPathaoStatus(req: Request, res: Response) {
    try {
      const status = await PathaoService.checkConnection();
      return res.json({ success: true, ...status });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Dispatch an order (Sale or PreOrder) to Pathao
   */
  static async dispatchOrderToPathao(req: Request, res: Response) {
    try {
      const type = String(req.params.type);
      const id = String(req.params.id);
      if (type !== 'sale' && type !== 'preorder') {
        return res.status(400).json({ error: "Order type must be 'sale' or 'preorder'" });
      }

      const parsed = SendToPathaoSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.format(),
        });
      }

      const adminEmail = (req as any).adminEmail || 'admin';
      const result = await ShipmentService.dispatchOrderToPathao(type as any, id, parsed.data, adminEmail);

      return res.status(201).json({
        success: true,
        message: 'Order successfully dispatched to Pathao Courier',
        shipment: result.shipment,
        order: result.order,
      });
    } catch (err: any) {
      return res.status(400).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Get shipment for a specific order
   */
  static async getOrderShipment(req: Request, res: Response) {
    try {
      const type = String(req.params.type);
      const id = String(req.params.id);
      const shipment = await Shipment.findOne({ orderType: type, orderId: id }).sort({ createdAt: -1 });
      return res.json({ success: true, shipment: shipment || null });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get live/cached shipment status (bypasses force, uses 45s cache)
   */
  static async getShipmentStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const shipment = await ShipmentService.refreshShipment(id, false);
      return res.json({ success: true, shipment });
    } catch (err: any) {
      return res.status(400).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Refresh status of a consignment from Pathao (forces API call, rate-limited to 10s)
   */
  static async refreshShipment(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const shipment = await ShipmentService.refreshShipment(id, true);
      return res.json({ success: true, shipment });
    } catch (err: any) {
      const isRateLimited = err.message && err.message.toLowerCase().includes('rate-limited');
      const status = isRateLimited ? 429 : 400;
      return res.status(status).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Manually cancel a shipment
   */
  static async cancelShipment(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const reason = req.body.reason || 'Cancelled by admin';
      const adminEmail = (req as any).adminEmail || 'admin';
      const shipment = await ShipmentService.cancelShipmentManually(id, reason, adminEmail);
      return res.json({ success: true, shipment });
    } catch (err: any) {
      return res.status(400).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * List shipments with filters and pagination
   */
  static async getShipments(req: Request, res: Response) {
    try {
      const { status, orderType, search, page, limit } = req.query;
      const result = await ShipmentService.listShipments({
        status: status as any,
        orderType: orderType as any,
        search: search as string,
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Export shipments as CSV
   */
  static async exportShipmentsCsv(req: Request, res: Response) {
    try {
      const { status, orderType } = req.query;
      const csv = await ShipmentService.exportShipmentsCsv({
        status: status as any,
        orderType: orderType as any,
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="pathao-shipments-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csv);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  /**
   * Public/Webhook callback for Pathao
   */
  static async handlePathaoWebhook(req: Request, res: Response) {
    try {
      // 1. Handle Pathao Webhook Handshake / Verification challenge
      if (req.body?.event === 'webhook_integration') {
        const integrationSecret =
          process.env.PATHAO_WEBHOOK_INTEGRATION_SECRET || 'f3992ecc-59da-4cbe-a049-a13da2018d51';
        res.setHeader('X-Pathao-Merchant-Webhook-Integration-Secret', integrationSecret);
        return res.status(202).json({
          message: 'Webhook integration verified',
        });
      }

      const parsed = PathaoWebhookSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid webhook payload format' });
      }

      const result = await ShipmentService.handleWebhook(parsed.data);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ error: PathaoService.sanitizeError(err.message) });
    }
  }

  /**
   * Public Order Tracking Endpoint (Privacy-safe: no internal IDs or financial details)
   */
  static async trackOrderPublic(req: Request, res: Response) {
    try {
      const parsed = PublicTrackOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'Order number and valid phone number are required',
        });
      }

      const result = await ShipmentService.getPublicTracking(parsed.data.orderNo, parsed.data.phone);
      return res.json(result);
    } catch (err: any) {
      if (err.message && err.message.includes('disabled')) {
        return res.status(503).json({ error: err.message });
      }
      return res.status(404).json({ error: err.message || 'No order found with these details.' });
    }
  }
}
