import { Types } from 'mongoose';
import cron from 'node-cron';
import { Shipment, IShipment, ShipmentOrderType, ShipmentStatus } from '../models/Shipment.model';
import { Sale, ISale } from '../models/Sale.model';
import { PreOrder, IPreOrder } from '../models/PreOrder.model';
import { PathaoService, PathaoCreateOrderPayload, resolvePathaoStatus } from './pathao.service';
import { LoyaltyService } from './loyalty.service';
import { VoucherService } from './voucher.service';
import { env } from '../config/env';

export interface DispatchToPathaoInput {
  recipientName: string;
  recipientPhone: string;
  recipientSecondaryPhone?: string;
  recipientAddress: string;
  recipientCity: number;
  recipientZone: number;
  recipientArea: number;
  recipientCityName?: string;
  recipientZoneName?: string;
  recipientAreaName?: string;
  storeId?: number;
  deliveryType?: 48 | 12;
  itemType?: 1 | 2;
  specialInstruction?: string;
  weightOverride?: number;
}

export interface PublicTrackingResponse {
  success: boolean;
  statusLabel: {
    en: string;
    bn: string;
  };
  step: 'Confirmed' | 'Sent to courier' | 'Out for delivery' | 'Delivered' | 'Returned';
  updatedAt: string | Date;
}

export class ShipmentService {
  private static cronJobInitialized = false;

  /**
   * Helper to normalize Bangladeshi phone numbers for safe matching
   * e.g. "+8801711223344", "8801711223344", "01711-223344" -> "01711223344"
   */
  public static normalizePhoneNumber(phone?: string): string {
    if (!phone) return '';
    let digits = phone.replace(/[^\d]/g, '');
    if (digits.startsWith('880')) {
      digits = digits.slice(2);
    }
    return digits;
  }

  /**
   * Calculates billable weight from grams plus packaging allowance (0.2 kg / 200g),
   * rounded up to nearest 0.5 kg, min 0.5 kg, max 10 kg.
   */
  public static calculateBillableWeightKg(totalGrams: number, override?: number): number {
    if (override && override >= 0.5 && override <= 10) {
      return Number(override.toFixed(1));
    }
    const totalG = Math.max(0, totalGrams) + 200; // 200g packaging allowance
    const rawKg = totalG / 1000;
    // Round up to nearest 0.5 kg
    const roundedKg = Math.ceil(rawKg * 2) / 2;
    // Bound within 0.5 kg and 10.0 kg
    return Math.min(10.0, Math.max(0.5, roundedKg));
  }

  /**
   * Computes amount to collect strictly on server.
   * Ignores any client-supplied amount.
   */
  public static calculateAmountToCollect(orderType: ShipmentOrderType, order: any): number {
    if (orderType === 'sale') {
      const sale = order as ISale;
      // If customer paid via online/advance payment (not cash on delivery), collection is 0
      if (sale.paymentMethod !== 'cash_on_delivery') {
        return 0;
      }
      const totalPayable = sale.totalRevenue + (sale.courierCharge || 0);
      return Math.max(0, Math.round(totalPayable));
    } else {
      const preOrder = order as IPreOrder;
      const remainingDue = preOrder.quotedTotal - (preOrder.depositTotal || 0);
      return Math.max(0, Math.round(remainingDue));
    }
  }

  /**
   * Validates location hierarchy and home delivery capability before dispatch
   */
  public static async validateDeliveryLocation(cityId: number, zoneId: number, areaId: number) {
    if (!cityId || !zoneId || !areaId) {
      throw new Error('City, Zone, and Area must all be selected for Pathao dispatch.');
    }

    const zones = await PathaoService.getZones(cityId);
    const matchedZone = zones.find((z) => z.id === zoneId);
    if (!matchedZone) {
      throw new Error('Selected zone does not belong to the chosen city.');
    }

    const areas = await PathaoService.getAreas(zoneId);
    const matchedArea = areas.find((a) => a.id === areaId);
    if (!matchedArea) {
      throw new Error('Selected area does not belong to the chosen zone.');
    }

    if (!matchedArea.homeDeliveryAvailable) {
      throw new Error('Selected area does not support home delivery. Please select an eligible area.');
    }

    return { matchedZone, matchedArea };
  }

  /**
   * Dispatches an order to Pathao.
   * Guarantees manual execution, strict locking, and never auto-retries on timeout.
   */
  public static async dispatchOrderToPathao(
    orderType: ShipmentOrderType,
    orderId: string | Types.ObjectId,
    input: DispatchToPathaoInput,
    adminEmail = 'admin'
  ): Promise<{ shipment: IShipment; order: any }> {
    // 1. Fetch Order and validate status
    let order: ISale | IPreOrder | null = null;
    let orderNo = '';
    let totalGrams = 0;
    let defaultDescription = 'Hatkhola Bazar Pure Agro Products';

    if (orderType === 'sale') {
      const sale = (await Sale.findById(orderId)) as ISale | null;
      if (!sale) throw new Error('Sale not found');
      if (sale.status === 'voided') throw new Error('Cannot ship a voided sale');
      order = sale;
      orderNo = `ORD-${String(sale._id).slice(-6).toUpperCase()}`;
      totalGrams = (sale.items || []).reduce((sum: number, it: any) => sum + it.qtyG, 0) + (sale.giveawayG || 0);
      defaultDescription = (sale.items || []).map((it: any) => it.optionLabel).join(', ') || defaultDescription;
    } else if (orderType === 'preorder') {
      const preOrder = (await PreOrder.findById(orderId)) as IPreOrder | null;
      if (!preOrder) throw new Error('Pre-order not found');
      if (preOrder.status === 'cancelled' || preOrder.status === 'refunded') {
        throw new Error(`Cannot ship a ${preOrder.status} pre-order`);
      }
      order = preOrder;
      orderNo = preOrder.preOrderNo;
      totalGrams = (preOrder.items || []).reduce((sum: number, it: any) => sum + it.qtyG, 0);
      defaultDescription = (preOrder.items || []).map((it: any) => `${it.productName} (${it.optionLabel})`).join(', ') || defaultDescription;
    } else {
      throw new Error(`Invalid order type: ${orderType}`);
    }

    if (!order) throw new Error('Order not found');

    // 2. Concurrency Check: Verify no existing active shipment
    const existingActive = await Shipment.findOne({
      orderType,
      orderId: order._id,
      status: { $in: ['creating', 'created'] },
    });

    if (existingActive) {
      throw new Error(
        `Order already has an active Pathao shipment (${existingActive.status}) with consignment ID: ${
          existingActive.consignmentId || 'pending'
        }`
      );
    }

    // 3. Validate Location Hierarchy & Home Delivery Availability
    await this.validateDeliveryLocation(
      Number(input.recipientCity),
      Number(input.recipientZone),
      Number(input.recipientArea)
    );

    // 4. Compute Weight and Amount to Collect strictly on server
    const itemWeightKg = this.calculateBillableWeightKg(totalGrams, input.weightOverride);
    const amountToCollect = this.calculateAmountToCollect(orderType, order);

    // 5. Resolve Store ID
    let storeId = input.storeId;
    if (!storeId && env.PATHAO_STORE_ID) {
      storeId = Number(env.PATHAO_STORE_ID);
    }
    if (!storeId) {
      try {
        const stores = await PathaoService.getStores();
        if (stores.length > 0) {
          storeId = stores[0].store_id;
        }
      } catch (err: any) {
        throw new Error(`Failed to determine Pathao store ID: ${PathaoService.sanitizeError(err.message)}`);
      }
    }
    if (!storeId) {
      throw new Error('No Pathao store ID found. Please configure a store in Pathao merchant panel.');
    }

    // Build Pathao order payload
    const pathaoPayload: PathaoCreateOrderPayload = {
      store_id: storeId,
      merchant_order_id: orderNo,
      recipient_name: input.recipientName.trim(),
      recipient_phone: input.recipientPhone.trim(),
      recipient_secondary_phone: input.recipientSecondaryPhone?.trim() || undefined,
      recipient_address: input.recipientAddress.trim(),
      recipient_city: Number(input.recipientCity),
      recipient_zone: Number(input.recipientZone),
      recipient_area: Number(input.recipientArea),
      delivery_type: input.deliveryType || 48,
      item_type: input.itemType || 2,
      special_instruction: input.specialInstruction?.trim(),
      item_quantity: 1,
      item_weight: itemWeightKg,
      item_description: defaultDescription.slice(0, 100),
      amount_to_collect: amountToCollect,
    };

    // 6. Create 'creating' Shipment as an atomic lock
    const shipment = new Shipment({
      orderType,
      orderId: order._id,
      orderNo,
      courier: 'pathao',
      merchantOrderId: orderNo,
      request: pathaoPayload,
      amountToCollect,
      itemWeightKg,
      deliveryFee: 0,
      codFee: 0,
      pathaoStatus: 'Pending',
      pathaoStatusSlug: 'pending',
      finalStatus: false,
      status: 'creating',
      createdBy: adminEmail,
      statusHistory: [
        {
          status: 'creating',
          pathaoStatus: 'Initiated',
          slug: 'pending',
          label: 'Pending Courier Pickup',
          note: `Manual dispatch initiated by ${adminEmail}`,
          fetchedAt: new Date(),
          timestamp: new Date(),
        },
      ],
    });

    try {
      await shipment.save();
    } catch (saveErr: any) {
      if (saveErr.code === 11000) {
        throw new Error('Order is currently being dispatched by another request. Duplicate creation blocked.');
      }
      throw saveErr;
    }

    // 7. Invoke Pathao API (NEVER auto-retry)
    try {
      const result = await PathaoService.createOrder(pathaoPayload);

      const statusInfo = resolvePathaoStatus(result.order_status);

      shipment.status = 'created';
      shipment.consignmentId = result.consignment_id;
      shipment.deliveryFee = result.delivery_fee;
      shipment.pathaoStatus = result.order_status || 'Pending';
      shipment.pathaoStatusSlug = statusInfo.slug;
      shipment.finalStatus = statusInfo.isFinal;
      shipment.trackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${result.consignment_id}`;
      shipment.statusHistory.push({
        status: 'created',
        pathaoStatus: result.order_status || 'Pending',
        slug: statusInfo.slug,
        label: statusInfo.labelEn,
        note: `Pathao accepted consignment: ${result.consignment_id}`,
        fetchedAt: new Date(),
        timestamp: new Date(),
      });
      await shipment.save();

      // Update Order with delivery info and courier cost
      order.courierCost = result.delivery_fee;
      order.recipientName = input.recipientName;
      order.recipientPhone = input.recipientPhone;
      order.recipientAddress = input.recipientAddress;
      order.pathaoCityId = input.recipientCity;
      order.pathaoZoneId = input.recipientZone;
      order.pathaoAreaId = input.recipientArea;
      order.pathaoCityName = input.recipientCityName || undefined;
      order.pathaoZoneName = input.recipientZoneName || undefined;
      order.pathaoAreaName = input.recipientAreaName || undefined;

      if (orderType === 'sale') {
        const sale = order as ISale;
        sale.courierName = 'Pathao';
        sale.courierTrackingId = result.consignment_id;
        sale.grossProfit = sale.totalRevenue - sale.totalCogs - sale.packagingCost - (sale.courierCost || 0);
      }
      await order.save();

      return { shipment, order };
    } catch (apiErr: any) {
      const isTimeout =
        apiErr.message?.toLowerCase().includes('timeout') ||
        apiErr.message?.toLowerCase().includes('timed out');

      if (isTimeout) {
        shipment.status = 'unknown';
        shipment.errorMessage = 'Request timed out. Verify in Pathao merchant panel before retrying.';
        shipment.statusHistory.push({
          status: 'unknown',
          note: shipment.errorMessage,
          timestamp: new Date(),
        });
        await shipment.save();
        throw new Error(shipment.errorMessage);
      } else {
        shipment.status = 'failed';
        shipment.errorMessage = PathaoService.sanitizeError(apiErr.message);
        shipment.statusHistory.push({
          status: 'failed',
          note: shipment.errorMessage,
          timestamp: new Date(),
        });
        await shipment.save();
        throw new Error(`Pathao dispatch failed: ${shipment.errorMessage}`);
      }
    }
  }

  /**
   * Refreshes status from Pathao for an active consignment.
   * - force = true bypasses 45s cache but enforces 10-second manual rate limit.
   * - force = false uses 45s cache and does not enforce 10s rate limit.
   */
  public static async refreshShipment(shipmentId: string, force = true): Promise<IShipment> {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new Error('Shipment not found');
    if (!shipment.consignmentId) {
      throw new Error('Shipment does not have a Pathao consignment ID yet');
    }

    // Rate limiting for manual forced refresh: max once per 10 seconds per shipment
    if (force && shipment.lastRefreshedAt) {
      const elapsed = Date.now() - new Date(shipment.lastRefreshedAt).getTime();
      if (elapsed < 10000) {
        throw new Error(
          `Refresh rate-limited. Please wait at least ${Math.ceil((10000 - elapsed) / 1000)}s before refreshing again.`
        );
      }
    }

    const info = await PathaoService.getOrderInfo(shipment.consignmentId, force);
    const statusInfo = resolvePathaoStatus(info.order_status_slug || info.order_status);

    const lastHistory = shipment.statusHistory[shipment.statusHistory.length - 1];
    const isStatusChanged =
      !lastHistory ||
      lastHistory.slug !== statusInfo.slug ||
      (info.updated_at && lastHistory.pathaoUpdatedAt !== info.updated_at);

    shipment.pathaoStatus = info.order_status;
    shipment.pathaoStatusSlug = statusInfo.slug;
    shipment.pathaoUpdatedAt = info.updated_at || shipment.pathaoUpdatedAt;
    shipment.finalStatus = statusInfo.isFinal;
    shipment.lastRefreshedAt = new Date();

    if (info.delivery_fee && info.delivery_fee > 0) {
      shipment.deliveryFee = info.delivery_fee;
    }

    if (isStatusChanged) {
      shipment.statusHistory.push({
        status: shipment.status,
        pathaoStatus: info.order_status,
        slug: statusInfo.slug,
        label: statusInfo.labelEn,
        pathaoUpdatedAt: info.updated_at,
        fetchedAt: new Date(),
        note: `Status updated to ${info.order_status}`,
        timestamp: new Date(),
      });
    }

    await shipment.save();
    await this.handleStatusSideEffects(shipment, 'cancelled');
    return shipment;
  }

  /**
   * Manually cancels an active shipment in local records
   */
  public static async cancelShipmentManually(
    shipmentId: string,
    reason: string,
    adminEmail = 'admin'
  ): Promise<IShipment> {
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw new Error('Shipment not found');

    shipment.status = 'cancelled_manually';
    shipment.finalStatus = true;
    shipment.errorMessage = reason;
    shipment.statusHistory.push({
      status: 'cancelled_manually',
      pathaoStatus: 'Cancelled',
      slug: 'cancelled',
      label: 'Consignment Cancelled',
      note: `Shipment cancelled manually by ${adminEmail}: ${reason}`,
      fetchedAt: new Date(),
      timestamp: new Date(),
    });

    await shipment.save();
    await this.handleStatusSideEffects(shipment, 'cancelled');
    return shipment;
  }

  /**
   * Webhook handler for Pathao order status callbacks.
   * Idempotent: avoids adding duplicate status updates.
   */
  public static async handleWebhook(payload: Record<string, any>): Promise<{ processed: boolean; message: string }> {
    const consignmentId = payload.consignment_id || payload.consignmentId;
    const merchantOrderId = payload.merchant_order_id || payload.merchantOrderId;
    const orderStatus = payload.order_status || payload.orderStatus;
    const orderStatusSlug = payload.order_status_slug || payload.orderStatusSlug || orderStatus;
    const updatedAt = payload.updated_at || payload.updatedAt;

    if (!consignmentId && !merchantOrderId) {
      return { processed: false, message: 'Missing consignment_id or merchant_order_id' };
    }

    const filter: Record<string, any> = {};
    if (consignmentId) filter.consignmentId = consignmentId;
    else if (merchantOrderId) filter.merchantOrderId = merchantOrderId;

    const shipment = await Shipment.findOne(filter);
    if (!shipment) {
      return { processed: false, message: 'Matching shipment not found in system' };
    }

    const statusInfo = resolvePathaoStatus(orderStatusSlug);
    const lastStatus = shipment.statusHistory[shipment.statusHistory.length - 1];

    if (lastStatus && lastStatus.slug === statusInfo.slug && lastStatus.pathaoUpdatedAt === updatedAt) {
      return { processed: true, message: 'Status already up-to-date (idempotent)' };
    }

    shipment.pathaoStatus = orderStatus;
    shipment.pathaoStatusSlug = statusInfo.slug;
    shipment.pathaoUpdatedAt = updatedAt || shipment.pathaoUpdatedAt;
    shipment.finalStatus = statusInfo.isFinal;
    shipment.statusHistory.push({
      status: shipment.status,
      pathaoStatus: orderStatus,
      slug: statusInfo.slug,
      label: statusInfo.labelEn,
      pathaoUpdatedAt: updatedAt,
      fetchedAt: new Date(),
      note: `Webhook status update: ${orderStatus}`,
      timestamp: new Date(),
    });

    await shipment.save();
    await this.handleStatusSideEffects(shipment, statusInfo.slug);
    return { processed: true, message: `Updated shipment to status ${orderStatus}` };
  }

  /**
   * Internal trigger for loyalty delivery earning and reversals based on courier status
   */
  private static async handleStatusSideEffects(shipment: IShipment, slug: string): Promise<void> {
    try {
      if (slug === 'delivered' || slug === 'partial_delivered') {
        const orderModel = shipment.orderType === 'sale' ? Sale : PreOrder;
        const order = await orderModel.findById(shipment.orderId);
        if (order) {
          await LoyaltyService.recordOrderDelivery(order, shipment.orderType);
          await VoucherService.redeemVoucher(shipment.orderId);
        }
      } else if (slug === 'returned' || slug === 'cancelled') {
        await LoyaltyService.handleOrderReversal(shipment.orderId, shipment.orderType, `Courier status: ${slug}`);
        await VoucherService.reverseVoucher(shipment.orderId, `Courier status: ${slug}`);
      }
    } catch (err: any) {
      console.warn('Loyalty delivery trigger notice:', err.message);
    }
  }

  /**
   * Public Order Tracking:
   * - Strict privacy-safe response: NO amounts, costs, address, or consignment ID
   * - Checks order number AND matching phone number
   * - Generic error on any mismatch to prevent enumeration
   */
  public static async getPublicTracking(orderNoInput: string, phoneInput: string): Promise<PublicTrackingResponse> {
    if (!env.PUBLIC_TRACKING_ENABLED) {
      throw new Error('Public order tracking is currently disabled.');
    }

    const cleanOrderNo = (orderNoInput || '').trim().toUpperCase();
    const cleanPhone = this.normalizePhoneNumber(phoneInput);

    if (!cleanOrderNo || cleanPhone.length < 10) {
      // Artificial delay to prevent timing attacks
      await new Promise((r) => setTimeout(r, 300));
      throw new Error('No order found with these details.');
    }

    // 1. Search PreOrder
    let matchedOrder: any = null;
    let matchedOrderType: ShipmentOrderType = 'preorder';

    const preOrder = await PreOrder.findOne({ preOrderNo: cleanOrderNo });
    if (preOrder) {
      const orderPhone = this.normalizePhoneNumber(preOrder.customerPhone || preOrder.recipientPhone);
      if (orderPhone && (orderPhone === cleanPhone || orderPhone.endsWith(cleanPhone) || cleanPhone.endsWith(orderPhone))) {
        matchedOrder = preOrder;
        matchedOrderType = 'preorder';
      }
    }

    // 2. Search Sale if not found
    if (!matchedOrder) {
      let sale: any = null;
      if (Types.ObjectId.isValid(cleanOrderNo.replace(/^ORD-/, ''))) {
        sale = await Sale.findById(cleanOrderNo.replace(/^ORD-/, ''));
      }
      if (!sale) {
        // Find by last 6 digits of ID
        const allSales = await Sale.find().sort({ createdAt: -1 }).limit(100);
        sale = allSales.find((s) => `ORD-${String(s._id).slice(-6).toUpperCase()}` === cleanOrderNo);
      }

      if (sale) {
        const salePhone = this.normalizePhoneNumber(sale.customerPhone || sale.recipientPhone);
        if (salePhone && (salePhone === cleanPhone || salePhone.endsWith(cleanPhone) || cleanPhone.endsWith(salePhone))) {
          matchedOrder = sale;
          matchedOrderType = 'sale';
        }
      }
    }

    // 3. Generic error on failure
    if (!matchedOrder) {
      await new Promise((r) => setTimeout(r, 300));
      throw new Error('No order found with these details.');
    }

    // 4. Find Shipment for order
    const shipment = await Shipment.findOne({
      orderType: matchedOrderType,
      orderId: matchedOrder._id,
    }).sort({ createdAt: -1 });

    // 5. If not yet sent to Pathao
    if (!shipment || shipment.status === 'creating' || shipment.status === 'failed') {
      return {
        success: true,
        statusLabel: {
          en: 'Your order is confirmed and being prepared',
          bn: 'আপনার অর্ডারটি নিশ্চিত করা হয়েছে এবং প্রস্তুত করা হচ্ছে',
        },
        step: 'Confirmed',
        updatedAt: matchedOrder.updatedAt || matchedOrder.createdAt,
      };
    }

    // 6. If shipment is active and not final, fetch cached status (using 45s TTL)
    if (!shipment.finalStatus && shipment.consignmentId) {
      try {
        await this.refreshShipment(shipment._id.toString(), false);
      } catch {
        // Non-fatal, serve current status
      }
    }

    const statusInfo = resolvePathaoStatus(shipment.pathaoStatusSlug || shipment.pathaoStatus);

    return {
      success: true,
      statusLabel: {
        en: statusInfo.labelEn,
        bn: statusInfo.labelBn,
      },
      step: statusInfo.progressStep,
      updatedAt: shipment.pathaoUpdatedAt || shipment.updatedAt || shipment.createdAt,
    };
  }

  /**
   * Initializes lightweight background synchronization (runs every 10 min)
   */
  public static initBackgroundSync() {
    if (this.cronJobInitialized) return;
    this.cronJobInitialized = true;

    // Run every 10 minutes: */10 * * * *
    cron.schedule('*/10 * * * *', async () => {
      if (!env.PATHAO_SYNC_ENABLED) return;

      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const activeShipments = await Shipment.find({
          status: 'created',
          finalStatus: { $ne: true },
          createdAt: { $gte: thirtyDaysAgo },
          consignmentId: { $exists: true, $ne: '' },
        }).limit(50);

        // Process in small batches with delays to respect Pathao rate limits
        for (const s of activeShipments) {
          try {
            await this.refreshShipment(s._id.toString(), false);
            // 500ms delay between calls
            await new Promise((r) => setTimeout(r, 500));
          } catch {}
        }
      } catch {}
    });
  }

  /**
   * List shipments with filters and pagination
   */
  public static async listShipments(query: {
    status?: ShipmentStatus;
    orderType?: ShipmentOrderType;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const filter: Record<string, any> = {};

    if (query.status) {
      filter.status = query.status;
    }
    if (query.orderType) {
      filter.orderType = query.orderType;
    }
    if (query.search) {
      const searchRegex = new RegExp(query.search.trim(), 'i');
      filter.$or = [
        { consignmentId: searchRegex },
        { merchantOrderId: searchRegex },
        { orderNo: searchRegex },
        { 'request.recipient_name': searchRegex },
        { 'request.recipient_phone': searchRegex },
      ];
    }

    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
    const skip = (page - 1) * limit;

    const [shipments, total] = await Promise.all([
      Shipment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Shipment.countDocuments(filter),
    ]);

    return {
      shipments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Generates CSV export for shipments
   */
  public static async exportShipmentsCsv(query: {
    status?: ShipmentStatus;
    orderType?: ShipmentOrderType;
  }): Promise<string> {
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.orderType) filter.orderType = query.orderType;

    const shipments: IShipment[] = await Shipment.find(filter).sort({ createdAt: -1 });

    const headers = [
      'Date',
      'Order No',
      'Order Type',
      'Consignment ID',
      'Status',
      'Pathao Status',
      'Pathao Slug',
      'Recipient Name',
      'Recipient Phone',
      'Recipient Address',
      'Weight (kg)',
      'Amount to Collect (Tk)',
      'Delivery Fee (Tk)',
      'Tracking URL',
      'Created By',
    ];

    const rows = shipments.map((s) => [
      s.createdAt ? new Date(s.createdAt).toISOString().split('T')[0] : '',
      `"${s.orderNo || ''}"`,
      `"${s.orderType}"`,
      `"${s.consignmentId || ''}"`,
      `"${s.status}"`,
      `"${s.pathaoStatus || ''}"`,
      `"${s.pathaoStatusSlug || ''}"`,
      `"${(s.request?.recipient_name || '').replace(/"/g, '""')}"`,
      `"${s.request?.recipient_phone || ''}"`,
      `"${(s.request?.recipient_address || '').replace(/"/g, '""')}"`,
      s.itemWeightKg,
      s.amountToCollect,
      s.deliveryFee,
      `"${s.trackingUrl || ''}"`,
      `"${s.createdBy || ''}"`,
    ]);

    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
