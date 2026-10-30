import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { LoyaltyService } from '../services/loyalty.service';
import { VoucherService } from '../services/voucher.service';
import { Voucher, IVoucher } from '../models/Voucher.model';
import { VoucherRedemption } from '../models/VoucherRedemption.model';
import { LoyaltyAccount } from '../models/LoyaltyAccount.model';
import { LoyaltyLedger } from '../models/LoyaltyLedger.model';
import { AuditLog } from '../models/AuditLog.model';
import { NotificationQueue } from '../models/NotificationQueue.model';
import { ShipmentService } from '../services/shipment.service';
import {
  ValidateVoucherInputSchema,
  UpdateLoyaltySettingsSchema,
  CreateVoucherSchema,
  BulkGenerateVouchersSchema,
  ManualAdjustmentSchema,
  LinkCustomerSchema,
  ImportPurchasesSchema,
  ExtendVoucherExpirySchema,
  IncreaseUsageLimitSchema,
  VoidVoucherSchema,
} from '../validators/loyalty.validator';

export class LoyaltyController {
  // ==================== PUBLIC API ====================

  /**
   * Public read-only loyalty program parameters
   * Cached for 60 seconds
   */
  public static async getPublicLoyaltySettings(req: Request, res: Response) {
    try {
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
      const settings = await LoyaltyService.getSettings();

      return res.json({
        success: true,
        loyalty: {
          enabled: settings.loyaltyEnabled,
          targetAmount: settings.targetAmount,
          rewardAmount: settings.rewardAmount,
          minOrderToRedeem: settings.minOrderToRedeem,
          voucherExpiryDays: settings.voucherExpiryDays,
        },
        settings: {
          loyaltyEnabled: settings.loyaltyEnabled,
          targetAmount: settings.targetAmount,
          rewardAmount: settings.rewardAmount,
          minOrderToRedeem: settings.minOrderToRedeem,
          voucherExpiryDays: settings.voucherExpiryDays,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==================== CUSTOMER API ====================

  /**
   * Customer / Checkout: Validate voucher against cart items
   * Rate limited: 15 / 15m per IP
   */
  public static async validateVoucher(req: Request, res: Response) {
    try {
      const parsed = ValidateVoucherInputSchema.parse(req.body);
      const user = (req as any).user;
      const phone = parsed.phone || (user?.phone ? ShipmentService.normalizePhoneNumber(user.phone) : undefined);
      const userId = user?.id || user?._id?.toString() || undefined;

      const evalItems = parsed.items.map((it) => ({
        productId: it.productId,
        productCode: it.productCode,
        productName: it.productName || 'Cart Item',
        price: it.price,
        quantity: it.quantity,
      }));

      const evaluation = await VoucherService.evaluateVoucher(
        parsed.code,
        evalItems,
        phone,
        userId
      );

      return res.json({
        success: true,
        evaluation,
      });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Customer: Get progress balance, hold amount, and program snapshot
   */
  public static async getCustomerLoyalty(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
      let resolvedPhone = phoneParam || (user?.phone ? ShipmentService.normalizePhoneNumber(user.phone) : undefined);

      const db = mongoose.connection.db;

      // If user is authenticated but phone is not in query/session, look up their phone from orders or account
      if (!resolvedPhone && user && db) {
        const queryOr: any[] = [];
        if (user.id) {
          queryOr.push({ userId: user.id });
          try {
            queryOr.push({ userId: new mongoose.Types.ObjectId(user.id) });
          } catch {}
        }
        if (user.email) {
          queryOr.push({ 'customer.email': user.email });
        }
        if (queryOr.length > 0) {
          const latestOrder = await db.collection('orders').findOne(
            { $or: queryOr },
            { sort: { createdAt: -1 } }
          );
          if (latestOrder?.customer?.phone) {
            resolvedPhone = ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
          }
        }
      }

      if (!resolvedPhone && user?.id) {
        const accByUserId = await LoyaltyAccount.findOne({ userId: user.id });
        if (accByUserId?.phone) {
          resolvedPhone = accByUserId.phone;
        }
      }

      if (!resolvedPhone && !user?.id) {
        return res.status(400).json({ success: false, error: 'Customer phone or session required' });
      }

      let account = null;
      let unlinkedPastPurchases = false;
      const settings = await LoyaltyService.getSettings();

      if (resolvedPhone) {
        const existing = await LoyaltyAccount.findOne({ phone: resolvedPhone });
        if (existing) {
          if (user?.id && !existing.userId) {
            existing.userId = user.id;
            await existing.save();
          }
          account = existing;
        } else {
          account = await LoyaltyService.getOrCreateAccount(
            resolvedPhone,
            user?.name || user?.fullName,
            user?.id
          );
        }
      } else if (user?.id) {
        account = await LoyaltyAccount.findOne({ userId: user.id });
      }

      // Automatically sync uncredited customer orders (counting product price only, excluding delivery cost)
      if (account) {
        await LoyaltyService.syncCustomerOrdersSpend(account, resolvedPhone, user?.id);
        account = await LoyaltyAccount.findById(account._id);
      }

      return res.json({
        success: true,
        account,
        unlinkedPastPurchases,
        settings: {
          loyaltyEnabled: settings.loyaltyEnabled,
          targetAmount: settings.targetAmount,
          rewardAmount: settings.rewardAmount,
          minOrderToRedeem: settings.minOrderToRedeem,
          voucherExpiryDays: settings.voucherExpiryDays,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Customer: Get wallet vouchers (active, used, expired)
   */
  public static async getCustomerVouchers(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      let resolvedPhone = phoneParam || (user?.phone ? ShipmentService.normalizePhoneNumber(user.phone) : undefined);

      if (!resolvedPhone && user && mongoose.connection.db) {
        const queryOr: any[] = [];
        if (user.id) {
          queryOr.push({ userId: user.id });
          try {
            queryOr.push({ userId: new mongoose.Types.ObjectId(user.id) });
          } catch {}
        }
        if (user.email) {
          queryOr.push({ 'customer.email': user.email });
        }
        if (queryOr.length > 0) {
          const latestOrder = await mongoose.connection.db.collection('orders').findOne(
            { $or: queryOr },
            { sort: { createdAt: -1 } }
          );
          if (latestOrder?.customer?.phone) {
            resolvedPhone = ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
          }
        }
      }

      if (!resolvedPhone && user?.id) {
        const accByUserId = await LoyaltyAccount.findOne({ userId: user.id });
        if (accByUserId?.phone) {
          resolvedPhone = accByUserId.phone;
        }
      }

      const filter: any = {};
      if (resolvedPhone) {
        filter.$or = [{ assignedPhone: resolvedPhone }, { assignedUserId: user?.id }];
      } else if (user?.id) {
        filter.assignedUserId = user.id;
      }

      const allVouchers = await Voucher.find(filter).sort({ createdAt: -1 });
      const now = new Date();

      // Synchronize expiration status for vouchers that have reached usage capacity or expired by date
      for (const v of allVouchers) {
        let dirty = false;
        const isDateExpired = Boolean(v.expiresAt && now > new Date(v.expiresAt));
        const isCapacityUsed = Boolean(
          v.usageLimitTotal !== null &&
          v.usageLimitTotal !== undefined &&
          v.usedCount + v.reservedCount >= v.usageLimitTotal
        );

        if (v.status === 'active' && (isDateExpired || isCapacityUsed)) {
          v.status = 'expired';
          dirty = true;
        }

        if (dirty) {
          await v.save();
        }
      }

      let returnVouchers = allVouchers;
      if (status && status !== 'all') {
        if (status === 'active') {
          returnVouchers = allVouchers.filter(
            (v) =>
              v.status === 'active' &&
              (!v.expiresAt || new Date(v.expiresAt) > now) &&
              (v.usageLimitTotal === null ||
                v.usageLimitTotal === undefined ||
                v.usedCount + v.reservedCount < v.usageLimitTotal)
          );
        } else if (status === 'expired' || status === 'used') {
          returnVouchers = allVouchers.filter(
            (v) =>
              v.status === 'expired' ||
              v.status === 'redeemed' ||
              v.status === 'voided' ||
              (v.expiresAt && new Date(v.expiresAt) <= now) ||
              (v.usageLimitTotal !== null &&
                v.usageLimitTotal !== undefined &&
                v.usedCount + v.reservedCount >= v.usageLimitTotal)
          );
        } else {
          returnVouchers = allVouchers.filter((v) => v.status === status);
        }
      }

      return res.json({
        success: true,
        vouchers: returnVouchers,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Customer: Get ledger history entries
   */
  public static async getCustomerHistory(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const phoneParam = req.query.phone ? String(req.query.phone) : undefined;
      let resolvedPhone = phoneParam || (user?.phone ? ShipmentService.normalizePhoneNumber(user.phone) : undefined);

      if (!resolvedPhone && user && mongoose.connection.db) {
        const queryOr: any[] = [];
        if (user.id) {
          queryOr.push({ userId: user.id });
          try {
            queryOr.push({ userId: new mongoose.Types.ObjectId(user.id) });
          } catch {}
        }
        if (user.email) {
          queryOr.push({ 'customer.email': user.email });
        }
        if (queryOr.length > 0) {
          const latestOrder = await mongoose.connection.db.collection('orders').findOne(
            { $or: queryOr },
            { sort: { createdAt: -1 } }
          );
          if (latestOrder?.customer?.phone) {
            resolvedPhone = ShipmentService.normalizePhoneNumber(latestOrder.customer.phone);
          }
        }
      }

      if (!resolvedPhone && user?.id) {
        const accByUserId = await LoyaltyAccount.findOne({ userId: user.id });
        if (accByUserId?.phone) {
          resolvedPhone = accByUserId.phone;
        }
      }

      let account = null;
      if (resolvedPhone) {
        account = await LoyaltyAccount.findOne({ phone: resolvedPhone });
      } else if (user?.id) {
        account = await LoyaltyAccount.findOne({ userId: user.id });
      }

      if (!account) {
        return res.json({ success: true, entries: [] });
      }

      const entries = await LoyaltyLedger.find({ accountId: account._id })
        .sort({ createdAt: -1 })
        .limit(50);

      return res.json({
        success: true,
        entries,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ==================== ADMIN API ====================

  /**
   * Admin: Read current loyalty program settings
   */
  public static async getAdminSettings(req: Request, res: Response) {
    try {
      const settings = await LoyaltyService.getSettings();
      return res.json({ success: true, settings });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Update loyalty program settings with audit log
   */
  public static async updateAdminSettings(req: Request, res: Response) {
    try {
      const parsed = UpdateLoyaltySettingsSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';
      const { programStartDate, ...rest } = parsed;
      const payload: any = { ...rest };
      if (programStartDate) {
        payload.programStartDate = new Date(programStartDate);
      } else if (programStartDate === null) {
        payload.programStartDate = undefined;
      }
      const updated = await LoyaltyService.updateSettings(payload, adminEmail);
      return res.json({ success: true, settings: updated });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: List vouchers with search, status, and source filters
   */
  public static async getVouchers(req: Request, res: Response) {
    try {
      const { search, status, source, type, page = 1, limit = 50 } = req.query;
      const filter: any = {};

      if (status && status !== 'all') filter.status = status;
      if (source && source !== 'all') filter.source = source;
      if (type && type !== 'all') filter.discountType = type;

      if (search && typeof search === 'string' && search.trim()) {
        const q = search.trim();
        filter.$or = [
          { code: { $regex: q, $options: 'i' } },
          { assignedPhone: { $regex: q, $options: 'i' } },
          { note: { $regex: q, $options: 'i' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const total = await Voucher.countDocuments(filter);
      const vouchers = await Voucher.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.json({
        success: true,
        vouchers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Create custom single voucher
   */
  public static async createVoucher(req: Request, res: Response) {
    try {
      const parsed = CreateVoucherSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const code = parsed.code
        ? parsed.code.trim().toUpperCase()
        : VoucherService.generateVoucherCode('HB');

      const existing = await Voucher.findOne({ code });
      if (existing) {
        return res.status(400).json({ success: false, error: 'A voucher with this code already exists' });
      }

      const voucher = await Voucher.create({
        code,
        source: parsed.source,
        discountType: parsed.discountType,
        value: parsed.value,
        maxDiscountAmount: parsed.maxDiscountAmount,
        minOrderAmount: parsed.minOrderAmount,
        startsAt: parsed.startsAt || new Date(),
        expiresAt: parsed.expiresAt,
        usageLimitTotal: parsed.usageLimitTotal,
        usageLimitPerCustomer: parsed.usageLimitPerCustomer,
        assignedPhone: parsed.assignedPhone ? ShipmentService.normalizePhoneNumber(parsed.assignedPhone) : null,
        assignedUserId: parsed.assignedUserId || null,
        applicableProducts: parsed.applicableProducts || [],
        excludedProducts: parsed.excludedProducts || [],
        ignoreCap: parsed.ignoreCap || false,
        stackable: false,
        status: 'active',
        note: parsed.note,
        createdBy: adminEmail,
      });

      await AuditLog.create({
        entityType: 'voucher',
        entityId: voucher._id,
        action: 'create',
        actor: adminEmail,
        toState: voucher.toObject(),
      });

      return res.status(201).json({ success: true, voucher });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Bulk generate promotional vouchers
   */
  public static async bulkGenerateVouchers(req: Request, res: Response) {
    try {
      const parsed = BulkGenerateVouchersSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const prefix = parsed.prefix || 'HB';
      const count = parsed.count;
      const codes: string[] = [];
      const vouchersToInsert: any[] = [];

      const now = new Date();
      const expiresAt = new Date(now.getTime() + parsed.expiryDays * 24 * 60 * 60 * 1000);

      while (vouchersToInsert.length < count) {
        const code = VoucherService.generateVoucherCode(prefix);
        if (!codes.includes(code)) {
          codes.push(code);
          vouchersToInsert.push({
            code,
            source: 'custom',
            discountType: parsed.discountType,
            value: parsed.value,
            maxDiscountAmount: parsed.maxDiscountAmount,
            minOrderAmount: parsed.minOrderAmount,
            startsAt: now,
            expiresAt,
            usageLimitTotal: parsed.usageLimitTotal ?? 1,
            usageLimitPerCustomer: 1,
            usedCount: 0,
            reservedCount: 0,
            assignedPhone: null,
            assignedUserId: null,
            applicableProducts: [],
            excludedProducts: [],
            ignoreCap: false,
            stackable: false,
            status: 'active',
            note: parsed.note || 'Bulk generated campaign',
            createdBy: adminEmail,
          });
        }
      }

      await Voucher.insertMany(vouchersToInsert);

      await AuditLog.create({
        entityType: 'voucher',
        entityId: vouchersToInsert[0]._id || 'bulk',
        action: 'bulk_create',
        actor: adminEmail,
        toState: { count, prefix, value: parsed.value },
      });

      return res.status(201).json({
        success: true,
        count: vouchersToInsert.length,
        codes,
      });
    } catch (err: any) {
      if (err.name === 'ZodError') {
        return res.status(400).json({ success: false, error: 'Validation failed', details: err.errors });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Update voucher status (pause, resume, void)
   */
  public static async updateVoucherStatus(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { status, reason } = req.body;
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const voucher = await Voucher.findById(id);
      if (!voucher) {
        return res.status(404).json({ success: false, error: 'Voucher not found' });
      }

      if (status === 'voided' && (!reason || reason.trim().length < 3)) {
        return res.status(400).json({ success: false, error: 'A void reason is required.' });
      }

      const oldStatus = voucher.status;
      voucher.status = status;
      if (reason) voucher.voidReason = reason.trim();
      await voucher.save();

      await AuditLog.create({
        entityType: 'voucher',
        entityId: voucher._id,
        action: `status_${status}`,
        actor: adminEmail,
        fromState: { status: oldStatus },
        toState: { status, reason },
      });

      return res.json({ success: true, voucher });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Extend voucher expiration date (audited)
   */
  public static async extendVoucherExpiry(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = ExtendVoucherExpirySchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const voucher = await Voucher.findById(id);
      if (!voucher) {
        return res.status(404).json({ success: false, error: 'Voucher not found' });
      }

      const oldExpiry = voucher.expiresAt;
      if (parsed.newExpiryDate) {
        voucher.expiresAt = new Date(parsed.newExpiryDate);
      } else if (parsed.daysToAdd) {
        const base = voucher.expiresAt > new Date() ? voucher.expiresAt : new Date();
        voucher.expiresAt = new Date(base.getTime() + parsed.daysToAdd * 86400000);
      } else {
        return res.status(400).json({ success: false, error: 'Either newExpiryDate or daysToAdd must be provided' });
      }
      await voucher.save();

      await AuditLog.create({
        entityType: 'voucher',
        entityId: voucher._id,
        action: 'extend_expiry',
        actor: adminEmail,
        fromState: { expiresAt: oldExpiry },
        toState: { expiresAt: voucher.expiresAt, reason: parsed.reason },
      });

      return res.json({ success: true, voucher });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Increase voucher total usage limit (audited)
   */
  public static async increaseUsageLimit(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = IncreaseUsageLimitSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const voucher = await Voucher.findById(id);
      if (!voucher) {
        return res.status(404).json({ success: false, error: 'Voucher not found' });
      }

      const oldLimit = voucher.usageLimitTotal;
      voucher.usageLimitTotal = parsed.newUsageLimit;
      await voucher.save();

      await AuditLog.create({
        entityType: 'voucher',
        entityId: voucher._id,
        action: 'increase_limit',
        actor: adminEmail,
        fromState: { usageLimitTotal: oldLimit },
        toState: { usageLimitTotal: voucher.usageLimitTotal, reason: parsed.reason },
      });

      return res.json({ success: true, voucher });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: List customer loyalty accounts with progress bars
   */
  public static async getCustomers(req: Request, res: Response) {
    try {
      const { search, page = 1, limit = 50 } = req.query;
      const filter: any = {};

      if (search && typeof search === 'string' && search.trim()) {
        const q = search.trim();
        filter.$or = [
          { phone: { $regex: q, $options: 'i' } },
          { name: { $regex: q, $options: 'i' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const total = await LoyaltyAccount.countDocuments(filter);
      const accounts = await LoyaltyAccount.find(filter)
        .sort({ progressBalance: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.json({
        success: true,
        accounts,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Customer detail and ledger history
   */
  public static async getCustomerDetail(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      let account = await LoyaltyAccount.findById(id);
      if (!account) {
        account = await LoyaltyAccount.findOne({ phone: id });
      }
      if (!account) {
        return res.status(404).json({ success: false, error: 'Loyalty account not found' });
      }

      const ledger = await LoyaltyLedger.find({ accountId: account._id }).sort({ createdAt: -1 });
      const vouchers = await Voucher.find({ assignedPhone: account.phone }).sort({ createdAt: -1 });

      return res.json({
        success: true,
        account,
        ledger,
        vouchers,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Link phone account to registered user account
   */
  public static async linkCustomer(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const parsed = LinkCustomerSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      let account = await LoyaltyAccount.findById(id);
      if (!account) {
        account = await LoyaltyAccount.findOne({ phone: id });
      }
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }

      const updated = await LoyaltyService.linkAccountToUser(account.phone, parsed.userId, adminEmail);
      return res.json({ success: true, account: updated });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Unlink user account from phone account
   */
  public static async unlinkCustomer(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      let account = await LoyaltyAccount.findById(id);
      if (!account) {
        account = await LoyaltyAccount.findOne({ phone: id });
      }
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }

      account.userId = undefined;
      await account.save();

      await AuditLog.create({
        entityType: 'loyalty_account',
        entityId: account._id,
        action: 'unlink_user',
        actor: adminEmail,
      });

      return res.json({ success: true, account });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Manual adjustment of progress balance
   */
  public static async manualAdjustment(req: Request, res: Response) {
    try {
      const parsed = ManualAdjustmentSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';

      const idOrPhone = parsed.phone || String(req.params.id);
      let account = await LoyaltyAccount.findOne({ phone: idOrPhone });
      if (!account && Types.ObjectId.isValid(idOrPhone)) {
        account = await LoyaltyAccount.findById(idOrPhone);
      }
      if (!account) {
        return res.status(404).json({ success: false, error: 'Loyalty account not found' });
      }

      const updated = await LoyaltyService.manualAdjustment(
        account._id,
        parsed.amount,
        parsed.reason,
        adminEmail
      );

      return res.json({
        success: true,
        account: updated,
        newBalance: updated.progressBalance,
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Rebuild account balance from ledger source of truth
   */
  public static async rebuildBalance(req: Request, res: Response) {
    try {
      const id = String(req.params.id || req.params.phone);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';
      let account = null;
      if (Types.ObjectId.isValid(id)) {
        account = await LoyaltyAccount.findById(id);
      }
      if (!account) {
        account = await LoyaltyAccount.findOne({ phone: id });
      }
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }

      const rebuilt = await LoyaltyService.rebuildAccountFromLedger(account._id, adminEmail);
      return res.json({ success: true, account: rebuilt });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Import past purchases via CSV/array
   */
  public static async importPurchases(req: Request, res: Response) {
    try {
      const parsed = ImportPurchasesSchema.parse(req.body);
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';
      const batchHash = parsed.batchHash || `import-${Date.now()}`;

      const result = await LoyaltyService.importPastPurchases(parsed.rows, batchHash, adminEmail, parsed.dryRun ?? false);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: List redemptions with search and pagination
   */
  public static async getRedemptions(req: Request, res: Response) {
    try {
      const { voucherId, search, page = 1, limit = 50 } = req.query;
      const filter: any = {};

      if (voucherId) filter.voucherId = voucherId;
      if (search && typeof search === 'string' && search.trim()) {
        const q = search.trim();
        filter.$or = [
          { code: { $regex: q, $options: 'i' } },
          { phone: { $regex: q, $options: 'i' } },
          { orderNo: { $regex: q, $options: 'i' } },
        ];
      }

      const skip = (Number(page) - 1) * Number(limit);
      const total = await VoucherRedemption.countDocuments(filter);
      const redemptions = await VoucherRedemption.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.json({
        success: true,
        redemptions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Release a reserved redemption
   */
  public static async releaseRedemption(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const reason = req.body.reason || 'Admin manual release';

      const redemption = await VoucherRedemption.findById(id);
      if (!redemption) {
        return res.status(404).json({ success: false, error: 'Redemption not found' });
      }

      await VoucherService.releaseVoucher(redemption.orderId, reason);
      const updated = await VoucherRedemption.findById(id);
      return res.json({ success: true, redemption: updated });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Review queue for flagged vouchers and redemptions
   */
  public static async getReviewQueue(req: Request, res: Response) {
    try {
      const flaggedVouchers = await Voucher.find({ status: 'review' }).sort({ updatedAt: -1 });
      const reversedRedemptions = await VoucherRedemption.find({ status: 'reversed' }).sort({
        updatedAt: -1,
      });

      return res.json({
        success: true,
        vouchers: flaggedVouchers,
        queue: {
          vouchers: flaggedVouchers,
          redemptions: reversedRedemptions,
          totalCount: flaggedVouchers.length + reversedRedemptions.length,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Resolve an item in the review queue
   */
  public static async resolveReviewItem(req: Request, res: Response) {
    try {
      const id = String(req.params.id);
      const { action, voidReason } = req.body;
      const voucher = await Voucher.findById(id);
      if (!voucher) {
        return res.status(404).json({ success: false, error: 'Voucher not found' });
      }

      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';
      const oldStatus = voucher.status;

      if (action === 'approve') {
        voucher.status = 'active';
      } else if (action === 'void') {
        voucher.status = 'voided';
        voucher.voidReason = voidReason || 'Voided via review queue resolution';
      }
      await voucher.save();

      await AuditLog.create({
        entityType: 'voucher',
        entityId: voucher._id,
        action: `review_${action}`,
        actor: adminEmail,
        fromState: { status: oldStatus },
        toState: { status: voucher.status, voidReason: voucher.voidReason },
      });

      return res.json({ success: true, voucher });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Overview metrics for loyalty dashboard
   */
  public static async getOverviewMetrics(req: Request, res: Response) {
    try {
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const settings = await LoyaltyService.getSettings();

      const activeVouchersCount = await Voucher.countDocuments({
        status: 'active',
        expiresAt: { $gt: now },
      });

      const expiring7DaysCount = await Voucher.countDocuments({
        status: 'active',
        expiresAt: { $gt: now, $lte: in7Days },
      });

      const reviewQueueCount =
        (await Voucher.countDocuments({ status: 'review' })) +
        (await VoucherRedemption.countDocuments({ status: 'reversed' }));

      const totalLoyaltyAccounts = await LoyaltyAccount.countDocuments();
      const totalVouchersIssued = await Voucher.countDocuments();
      const totalVouchersRedeemed = await VoucherRedemption.countDocuments({ status: 'redeemed' });
      const redemptionsAgg = await VoucherRedemption.aggregate([
        { $match: { status: 'redeemed' } },
        { $group: { _id: null, totalDiscount: { $sum: '$discountAmount' } } },
      ]);
      const totalDiscountGivenTaka = redemptionsAgg[0]?.totalDiscount || 0;

      const activeVouchers = await Voucher.find({ status: 'active', expiresAt: { $gt: now } });
      const outstandingVoucherLiabilityTaka = activeVouchers.reduce(
        (sum, v) => sum + (v.discountType === 'fixed' ? v.value : 0),
        0
      );
      const expiredUnusedCount = await Voucher.countDocuments({
        status: { $in: ['expired', 'active'] },
        expiresAt: { $lte: now },
        usedCount: 0,
      });

      const threshold80 = Math.floor(settings.targetAmount * 0.8);
      const customersClose = await LoyaltyAccount.find({
        progressBalance: { $gte: threshold80, $lt: settings.targetAmount },
      })
        .sort({ progressBalance: -1 })
        .limit(10);

      const expiringSoonList = await Voucher.find({
        status: 'active',
        expiresAt: { $gt: now, $lte: in7Days },
      })
        .sort({ expiresAt: 1 })
        .limit(10);

      return res.json({
        success: true,
        metrics: {
          totalLoyaltyAccounts,
          activeLoyaltyVouchers: activeVouchersCount,
          activeVouchersCount,
          totalVouchersIssued,
          totalVouchersRedeemed,
          totalDiscountGivenTaka,
          outstandingVoucherLiabilityTaka,
          expiredUnusedCount,
          expiring7DaysCount,
          reviewQueueCount,
          vouchersInReviewCount: reviewQueueCount,
          targetAmount: settings.targetAmount,
          rewardAmount: settings.rewardAmount,
          customersClose,
          expiringSoonList,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Loyalty and voucher audit log
   */
  public static async getAuditLogs(req: Request, res: Response) {
    try {
      const { page = 1, limit = 50, entityType } = req.query;
      const filter: any = {
        entityType: entityType || {
          $in: ['loyalty_settings', 'loyalty_account', 'voucher', 'voucher_redemption'],
        },
      };

      const skip = (Number(page) - 1) * Number(limit);
      const total = await AuditLog.countDocuments(filter);
      const logs = await AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.json({
        success: true,
        logs,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: Retroactive Sales Backfill
   */
  public static async backfillDeliveredSales(req: Request, res: Response) {
    try {
      const adminEmail = (req as any).adminEmail || (req as any).user?.email || 'admin';
      const result = await LoyaltyService.backfillDeliveredSales(adminEmail);
      return res.json({
        success: true,
        ...result,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Admin: View SMS/WhatsApp notification queue
   */
  public static async getNotificationQueue(req: Request, res: Response) {
    try {
      const { page = 1, limit = 50, status } = req.query;
      const filter: any = {};
      if (status) filter.status = status;

      const skip = (Number(page) - 1) * Number(limit);
      const total = await NotificationQueue.countDocuments(filter);
      const notifications = await NotificationQueue.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      return res.json({
        success: true,
        notifications,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Customer: Link unlinked past purchases by phone number
   */
  public static async customerLinkPastAccount(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      if (!user?.id) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { phone } = req.body;
      const cleanPhone = phone ? ShipmentService.normalizePhoneNumber(phone) : undefined;
      if (!cleanPhone) {
        return res.status(400).json({ success: false, error: 'Valid phone number required' });
      }

      const account = await LoyaltyAccount.findOne({ phone: cleanPhone });
      if (!account) {
        return res.status(404).json({ success: false, error: 'No account found for this phone number' });
      }

      account.userId = user.id;
      await account.save();

      await AuditLog.create({
        entityType: 'loyalty_account',
        entityId: account._id,
        action: 'customer_link_past_purchases',
        actor: user.email || cleanPhone,
        toState: { userId: user.id },
        metadata: { phone: cleanPhone },
      });

      return res.json({ success: true, account });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}
