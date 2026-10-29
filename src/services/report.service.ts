import { Types } from 'mongoose';
import { Product, IProduct, ISellingOption } from '../models/Product.model';
import { StockBatch, IStockBatch, IAttachment } from '../models/StockBatch.model';
import { Sale, ISale, IItemAllocation } from '../models/Sale.model';
import { StockAdjustment, IStockAdjustment } from '../models/StockAdjustment.model';
import { PreOrder, IPreOrder } from '../models/PreOrder.model';

export interface DateRangeQuery {
  from?: string | Date;
  to?: string | Date;
}

export class ReportService {
  /**
   * Generates comprehensive financial and inventory reports
   */
  static async getFinancialReport(range: DateRangeQuery = {}) {
    // 1. Build Date filter for sales and adjustments
    const dateFilter: Record<string, any> = { status: 'completed' };
    if (range.from || range.to) {
      dateFilter.soldAt = {};
      if (range.from) dateFilter.soldAt.$gte = new Date(range.from);
      if (range.to) {
        const toDate = new Date(range.to);
        toDate.setHours(23, 59, 59, 999);
        dateFilter.soldAt.$lte = toDate;
      }
    }

    // 2. Fetch completed sales in date range
    const sales: ISale[] = await Sale.find(dateFilter).sort({ soldAt: -1 });

    const totalRevenue = sales.reduce((acc, s) => acc + s.totalRevenue, 0);
    const totalCogs = sales.reduce((acc, s) => acc + s.totalCogs, 0);
    const totalPackaging = sales.reduce((acc, s) => acc + s.packagingCost, 0);
    const totalCourierCost = sales.reduce((acc, s) => acc + (s.courierCost || 0), 0);
    const totalGrossProfit = totalRevenue - totalCogs - totalPackaging - totalCourierCost;
    const totalGiveawayG = sales.reduce((acc, s) => acc + s.giveawayG, 0);

    // 3. Fetch adjustments in date range
    const adjDateFilter: Record<string, any> = {};
    if (range.from || range.to) {
      adjDateFilter.createdAt = {};
      if (range.from) adjDateFilter.createdAt.$gte = new Date(range.from);
      if (range.to) adjDateFilter.createdAt.$lte = new Date(range.to);
    }
    const adjustments: IStockAdjustment[] = await StockAdjustment.find(adjDateFilter);
    const wastageCost = adjustments
      .filter((a) => a.type === 'wastage' || a.type === 'physical_count')
      .reduce((acc, a) => acc + Math.max(0, a.costImpact), 0);
    const sampleCost = adjustments
      .filter((a) => a.type === 'sample')
      .reduce((acc, a) => acc + Math.max(0, a.costImpact), 0);

    // 4. Products & Stock On Hand
    const products: IProduct[] = await Product.find({ isActive: true });
    const activeBatches: IStockBatch[] = await StockBatch.find({ status: { $ne: 'voided' } }).sort({
      purchasedAt: 1,
      batchNo: 1,
    });

    const stockOnHandPerProduct = products.map((prod) => {
      const prodBatches = activeBatches.filter(
        (b) => String(b.product) === String(prod._id) && b.status === 'active'
      );
      const totalG = prodBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
      const totalCostRemaining = prodBatches.reduce((acc, b) => acc + b.costRemaining, 0);

      // Oldest batch for suggested pricing
      const oldestBatch = prodBatches[0];
      const oldestCostPerG =
        oldestBatch && oldestBatch.receivedQtyG > 0
          ? oldestBatch.totalCost / oldestBatch.receivedQtyG
          : 0;

      // Calculate suggested selling price per selling option
      const suggestedOptions = (prod.sellingOptions || []).map((opt: ISellingOption) => {
        const unitCost = Math.round(oldestCostPerG * opt.qtyG);
        const marginMultiplier = 1 + (prod.marginPercent || 25) / 100;
        const suggestedPrice = Math.round(unitCost * marginMultiplier);
        const isBelowCost = opt.sellingPrice < unitCost;

        return {
          label: opt.label,
          qtyG: opt.qtyG,
          currentPrice: opt.sellingPrice,
          unitCost,
          suggestedPrice,
          isBelowCost,
        };
      });

      const isLowStock = totalG < (prod.lowStockThresholdG || 5000);

      return {
        productId: prod._id,
        code: prod.code,
        name: prod.name,
        slug: prod.slug,
        stockG: totalG,
        stockKg: Number((totalG / 1000).toFixed(3)),
        stockValue: totalCostRemaining,
        lowStockThresholdG: prod.lowStockThresholdG,
        isLowStock,
        suggestedOptions,
      };
    });

    const lowStockAlerts = stockOnHandPerProduct.filter((p) => p.isLowStock);

    // 5. Per-Batch Performance Summary (excluding voided)
    const batchCostingSummary = activeBatches.map((b) => {
      const soldG = b.receivedQtyG - b.qtyRemainingG;
      const cogs = b.totalCost - b.costRemaining;

      // Find revenue attributed to this batch from sales
      let attributedRevenue = 0;
      for (const s of sales) {
        for (const it of s.items) {
          const alloc = (it.allocations || []).find((al: IItemAllocation) => String(al.batchId) === String(b._id));
          if (alloc) {
            // Share of item revenue proportional to allocated grams
            const share = it.qtyG > 0 ? (alloc.qtyG / it.qtyG) * it.sellingPrice : 0;
            attributedRevenue += Math.round(share);
          }
        }
      }

      const profit = attributedRevenue - cogs;
      const marginPercent =
        attributedRevenue > 0 ? Number(((profit / attributedRevenue) * 100).toFixed(1)) : 0;

      return {
        batchId: b._id,
        batchNo: b.batchNo,
        productId: b.product,
        supplierName: b.supplierName,
        purchasedAt: b.purchasedAt,
        receivedQtyG: b.receivedQtyG,
        qtyRemainingG: b.qtyRemainingG,
        totalCost: b.totalCost,
        costRemaining: b.costRemaining,
        costPerKg: b.costPerKg,
        soldG,
        cogs,
        attributedRevenue,
        profit,
        marginPercent,
        status: b.status,
        attachmentCount: (b.attachments || []).filter((a: IAttachment) => !a.removedAt)?.length || 0,
      };
    });

    // 5. Pre-orders Metrics
    const openPreOrders = await PreOrder.find({ status: { $in: ['pending', 'confirmed', 'ready'] } });
    const depositsHeld = openPreOrders.reduce((sum, po) => sum + po.depositTotal, 0);
    const totalOpenPreOrderGrams = openPreOrders.reduce(
      (sum, po) => sum + po.items.reduce((iSum: number, it: any) => iSum + it.qtyG, 0),
      0
    );

    const cancelledWithForfeit = await PreOrder.find({ forfeitedTotal: { $gt: 0 } });
    const totalForfeitedIncome = cancelledWithForfeit.reduce((sum, po) => sum + po.forfeitedTotal, 0);

    const cancelledWithRefund = await PreOrder.find({ refundedTotal: { $gt: 0 } });
    const totalRefundedDeposits = cancelledWithRefund.reduce((sum, po) => sum + po.refundedTotal, 0);

    return {
      dateRange: {
        from: range.from || 'all_time',
        to: range.to || 'now',
      },
      summary: {
        totalRevenue,
        totalCogs,
        totalPackaging,
        totalCourierCost,
        totalGrossProfit,
        netProfitMargin:
          totalRevenue > 0 ? Number(((totalGrossProfit / totalRevenue) * 100).toFixed(1)) : 0,
        totalSalesCount: sales.length,
        totalGiveawayG,
        wastageCost,
        sampleCost,
        depositsHeld,
        otherIncomeForfeited: totalForfeitedIncome,
        totalRefundedDeposits,
      },
      preOrders: {
        openCount: openPreOrders.length,
        depositsHeld,
        totalOpenGrams: totalOpenPreOrderGrams,
        otherIncomeForfeited: totalForfeitedIncome,
        totalRefundedDeposits,
      },
      stockOnHand: stockOnHandPerProduct,
      totalInventoryValue: stockOnHandPerProduct.reduce((acc, p) => acc + p.stockValue, 0),
      lowStockAlerts,
      batchCostingSummary,
    };
  }
}
