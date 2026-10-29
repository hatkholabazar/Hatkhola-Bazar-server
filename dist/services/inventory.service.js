"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const Product_model_1 = require("../models/Product.model");
const StockBatch_model_1 = require("../models/StockBatch.model");
const Sale_model_1 = require("../models/Sale.model");
const StockAdjustment_model_1 = require("../models/StockAdjustment.model");
const Settings_model_1 = require("../models/Settings.model");
const batchNumber_service_1 = require("./batchNumber.service");
class InventoryService {
    /**
     * Safe helper to run with or without Mongo Replica Set Transactions
     */
    static async runInTransaction(fn, existingSession) {
        if (existingSession !== undefined) {
            return await fn(existingSession);
        }
        let session = null;
        try {
            session = await mongoose_1.default.startSession();
            session.startTransaction();
            const result = await fn(session);
            await session.commitTransaction();
            return result;
        }
        catch (err) {
            if (session) {
                try {
                    await session.abortTransaction();
                }
                catch {
                    // Ignore abort errors
                }
            }
            // If standalone Mongo doesn't support transactions (e.g. test environment)
            if (err?.message?.includes('Transaction numbers are only allowed on a replica set member') ||
                err?.message?.includes('replica set')) {
                return await fn(null);
            }
            throw err;
        }
        finally {
            if (session) {
                session.endSession();
            }
        }
    }
    /**
     * Check for duplicate purchase references from same supplier
     */
    static async checkDuplicateReference(supplierPhone, supplierName, referenceValue) {
        if (!referenceValue || !referenceValue.trim()) {
            return { isDuplicate: false };
        }
        const cleanRef = referenceValue.trim();
        const cleanPhone = supplierPhone.trim();
        const cleanName = supplierName.trim();
        const existing = await StockBatch_model_1.StockBatch.findOne({
            referenceValue: cleanRef,
            status: { $ne: 'voided' },
            $or: [
                { supplierPhone: cleanPhone },
                { supplierName: { $regex: new RegExp(`^${cleanName}$`, 'i') } },
            ],
        }).select('batchNo supplierName supplierPhone referenceValue');
        if (existing) {
            return { isDuplicate: true, existingBatchNo: existing.batchNo };
        }
        return { isDuplicate: false };
    }
    /**
     * Create a new StockBatch
     */
    static async createBatch(input) {
        const product = await Product_model_1.Product.findOne({
            $or: [
                { code: input.productCode.toUpperCase() },
                { _id: mongoose_1.Types.ObjectId.isValid(input.productCode) ? input.productCode : null },
            ],
        });
        if (!product) {
            throw new Error(`Product not found for code: ${input.productCode}`);
        }
        // Check duplicate reference
        if (input.referenceValue && !input.allowDuplicate) {
            const dup = await this.checkDuplicateReference(input.supplierPhone, input.supplierName, input.referenceValue);
            if (dup.isDuplicate) {
                const error = new Error(`A batch (${dup.existingBatchNo}) already exists for supplier '${input.supplierName}' with reference '${input.referenceValue}'. Confirm to save anyway.`);
                error.code = 'DUPLICATE_REFERENCE';
                error.existingBatchNo = dup.existingBatchNo;
                throw error;
            }
        }
        const orderedQtyG = Math.round(Number(input.orderedQtyG));
        const receivedQtyG = Math.round(Number(input.receivedQtyG));
        const productCost = Math.round(Number(input.productCost));
        const courierCharge = Math.round(Number(input.courierCharge || 0));
        const codFee = Math.round(Number(input.codFee || 0));
        const otherExtraCost = Math.round(Number(input.otherExtraCost || 0));
        const extraCost = courierCharge + codFee + otherExtraCost;
        const totalCost = productCost + extraCost;
        return await this.runInTransaction(async (session) => {
            const batchNo = await batchNumber_service_1.BatchNumberService.generateBatchNo(product.code, new Date(input.purchasedAt), session || undefined);
            const batch = new StockBatch_model_1.StockBatch({
                batchNo,
                product: product._id,
                purchasedAt: new Date(input.purchasedAt),
                receivedAt: new Date(input.receivedAt),
                supplierName: input.supplierName.trim(),
                supplierPhone: input.supplierPhone.trim(),
                orderedQtyG,
                receivedQtyG,
                qtyRemainingG: receivedQtyG, // Starts equal to received
                productCost,
                courierCharge,
                codFee,
                otherExtraCost,
                extraCost,
                totalCost,
                costRemaining: totalCost, // Starts equal to totalCost
                paymentMethod: input.paymentMethod || 'cash_on_delivery',
                referenceType: input.referenceType || 'courier_tracking',
                referenceValue: input.referenceValue ? input.referenceValue.trim() : undefined,
                courierName: input.courierName,
                note: input.note,
                status: 'active',
            });
            if (session) {
                await batch.save({ session });
            }
            else {
                await batch.save();
            }
            return batch;
        });
    }
    /**
     * Preview FIFO allocations for an item quantity before saving
     */
    static async previewAllocation(productId, qtyG) {
        const activeBatches = await StockBatch_model_1.StockBatch.find({
            product: productId,
            status: 'active',
            qtyRemainingG: { $gt: 0 },
        }).sort({ purchasedAt: 1, batchNo: 1 });
        const totalAvailable = activeBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
        if (totalAvailable < qtyG) {
            return { allocations: [], totalCost: 0, hasSufficientStock: false };
        }
        let needed = qtyG;
        const allocations = [];
        let totalCost = 0;
        for (const b of activeBatches) {
            if (needed <= 0)
                break;
            const takeQtyG = Math.min(b.qtyRemainingG, needed);
            let cost;
            if (takeQtyG === b.qtyRemainingG) {
                cost = b.costRemaining;
            }
            else {
                cost = Math.round((takeQtyG * b.totalCost) / b.receivedQtyG);
            }
            allocations.push({
                batchId: String(b._id),
                batchNo: b.batchNo,
                qtyG: takeQtyG,
                cost,
            });
            totalCost += cost;
            needed -= takeQtyG;
        }
        return { allocations, totalCost, hasSufficientStock: true };
    }
    /**
     * Record a new sale with strict FIFO multi-batch split allocation & exact closing depletion
     */
    static async createSale(input, existingSession) {
        if (!input.items || input.items.length === 0) {
            throw new Error('Sale must contain at least one product item');
        }
        return await this.runInTransaction(async (session) => {
            // 1. Resolve packaging cost from settings if not supplied
            let packagingCost = input.packagingCost !== undefined ? Math.round(Number(input.packagingCost)) : 0;
            if (input.packagingCost === undefined) {
                const settings = await Settings_model_1.Settings.findOne();
                packagingCost = settings?.packagingCostPerOrder || 25;
            }
            const giveawayG = input.giveawayG ? Math.round(Number(input.giveawayG)) : 0;
            let totalRevenue = 0;
            let totalCogs = 0;
            const processedItems = [];
            // 2. Process each sale item with FIFO split allocation
            for (let idx = 0; idx < input.items.length; idx++) {
                const itemInput = input.items[idx];
                const sellingPrice = Math.round(Number(itemInput.sellingPrice));
                totalRevenue += sellingPrice;
                // If this is the last item, also allocate giveawayG to it
                const itemTotalQty = Math.round(Number(itemInput.qtyG)) + (idx === input.items.length - 1 ? giveawayG : 0);
                const activeBatches = await StockBatch_model_1.StockBatch.find({
                    product: itemInput.productId,
                    status: 'active',
                    qtyRemainingG: { $gt: 0 },
                })
                    .sort({ purchasedAt: 1, batchNo: 1 })
                    .session(session || null);
                const totalAvailableG = activeBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
                if (totalAvailableG < itemTotalQty) {
                    throw new Error(`Insufficient stock for item "${itemInput.optionLabel}". Required: ${itemTotalQty}g, Available: ${totalAvailableG}g`);
                }
                let neededG = itemTotalQty;
                const allocations = [];
                for (const batch of activeBatches) {
                    if (neededG <= 0)
                        break;
                    const takeG = Math.min(batch.qtyRemainingG, neededG);
                    let cost;
                    // Zero-lost-taka rule: if emptying the batch, take exactly costRemaining
                    if (takeG === batch.qtyRemainingG) {
                        cost = batch.costRemaining;
                        batch.qtyRemainingG = 0;
                        batch.costRemaining = 0;
                        batch.status = 'depleted';
                    }
                    else {
                        cost = Math.round((takeG * batch.totalCost) / batch.receivedQtyG);
                        batch.qtyRemainingG -= takeG;
                        batch.costRemaining -= cost;
                    }
                    if (session) {
                        await batch.save({ session });
                    }
                    else {
                        await batch.save();
                    }
                    allocations.push({
                        batchId: batch._id,
                        batchNo: batch.batchNo,
                        qtyG: takeG,
                        cost,
                    });
                    totalCogs += cost;
                    neededG -= takeG;
                }
                processedItems.push({
                    product: new mongoose_1.Types.ObjectId(itemInput.productId),
                    optionLabel: itemInput.optionLabel,
                    qtyG: Math.round(Number(itemInput.qtyG)),
                    sellingPrice,
                    allocations,
                });
            }
            const grossProfit = totalRevenue - totalCogs - packagingCost;
            const sale = new Sale_model_1.Sale({
                soldAt: input.soldAt ? new Date(input.soldAt) : new Date(),
                customerName: input.customerName?.trim(),
                customerPhone: input.customerPhone?.trim(),
                customerAddress: input.customerAddress?.trim(),
                courierName: input.courierName,
                courierCharge: input.courierCharge ? Math.round(Number(input.courierCharge)) : 0,
                courierTrackingId: input.courierTrackingId?.trim(),
                deliveryNotes: input.deliveryNotes?.trim(),
                paymentTrxId: input.paymentTrxId?.trim(),
                channel: input.channel || 'whatsapp',
                paymentMethod: input.paymentMethod || 'cash_on_delivery',
                items: processedItems,
                giveawayG,
                packagingCost,
                totalRevenue,
                totalCogs,
                grossProfit,
                status: 'completed',
            });
            if (session) {
                await sale.save({ session });
            }
            else {
                await sale.save();
            }
            return sale;
        }, existingSession);
    }
    /**
     * Void a sale: writes reversal and restores stock and costs back to original batches
     */
    static async voidSale(saleId, voidReason) {
        if (!voidReason || !voidReason.trim()) {
            throw new Error('Void reason is strictly required');
        }
        return await this.runInTransaction(async (session) => {
            const sale = await Sale_model_1.Sale.findById(saleId).session(session || null);
            if (!sale) {
                throw new Error('Sale not found');
            }
            if (sale.status === 'voided') {
                throw new Error('Sale is already voided');
            }
            // Restore each allocation back to its exact batch
            for (const item of sale.items) {
                for (const alloc of item.allocations) {
                    const batch = await StockBatch_model_1.StockBatch.findById(alloc.batchId).session(session || null);
                    if (batch) {
                        batch.qtyRemainingG += alloc.qtyG;
                        batch.costRemaining += alloc.cost;
                        if (batch.status === 'depleted') {
                            batch.status = 'active';
                        }
                        if (session) {
                            await batch.save({ session });
                        }
                        else {
                            await batch.save();
                        }
                    }
                }
            }
            sale.status = 'voided';
            sale.voidReason = voidReason.trim();
            sale.voidedAt = new Date();
            if (session) {
                await sale.save({ session });
            }
            else {
                await sale.save();
            }
            return sale;
        });
    }
    /**
     * Return a sold item / allocation: restores quantity and cost to original batches
     */
    static async processReturn(saleId, allocationsToReturn, reason) {
        if (!reason || !reason.trim()) {
            throw new Error('Return reason is required');
        }
        return await this.runInTransaction(async (session) => {
            const sale = await Sale_model_1.Sale.findById(saleId).session(session || null);
            if (!sale) {
                throw new Error('Sale not found');
            }
            if (sale.status === 'voided') {
                throw new Error('Cannot process return on a voided sale');
            }
            for (const ret of allocationsToReturn) {
                const batch = await StockBatch_model_1.StockBatch.findById(ret.batchId).session(session || null);
                if (batch) {
                    batch.qtyRemainingG += ret.qtyG;
                    batch.costRemaining += ret.cost;
                    if (batch.status === 'depleted') {
                        batch.status = 'active';
                    }
                    if (session) {
                        await batch.save({ session });
                    }
                    else {
                        await batch.save();
                    }
                    // Create StockAdjustment record for audit trail
                    const adjustment = new StockAdjustment_model_1.StockAdjustment({
                        product: batch.product,
                        batch: batch._id,
                        qtyG: ret.qtyG,
                        type: 'return',
                        costImpact: -ret.cost, // Negative cost impact (restoring stock)
                        reason: `Return from Sale ${saleId}: ${reason}`,
                    });
                    if (session) {
                        await adjustment.save({ session });
                    }
                    else {
                        await adjustment.save();
                    }
                }
            }
            return sale;
        });
    }
    /**
     * Void a batch: allowed only if none of it has been sold
     */
    static async voidBatch(batchId, voidReason) {
        if (!voidReason || !voidReason.trim()) {
            throw new Error('Void reason is strictly required');
        }
        return await this.runInTransaction(async (session) => {
            const batch = await StockBatch_model_1.StockBatch.findById(batchId).session(session || null);
            if (!batch) {
                throw new Error('StockBatch not found');
            }
            if (batch.status === 'voided') {
                throw new Error('Batch is already voided');
            }
            // Must not have been sold
            if (batch.qtyRemainingG !== batch.receivedQtyG) {
                throw new Error(`Cannot void batch ${batch.batchNo}. ${batch.receivedQtyG - batch.qtyRemainingG}g has already been sold. Use a stock correction adjustment instead.`);
            }
            batch.status = 'voided';
            batch.voidReason = voidReason.trim();
            batch.voidedAt = new Date();
            if (session) {
                await batch.save({ session });
            }
            else {
                await batch.save();
            }
            return batch;
        });
    }
    /**
     * Record a StockAdjustment (wastage, sample, correction)
     */
    static async createAdjustment(productId, batchId, qtyG, type, reason) {
        if (!reason || !reason.trim()) {
            throw new Error('Adjustment reason is strictly required');
        }
        return await this.runInTransaction(async (session) => {
            const batch = await StockBatch_model_1.StockBatch.findById(batchId).session(session || null);
            if (!batch) {
                throw new Error('StockBatch not found');
            }
            if (batch.status === 'voided') {
                throw new Error('Cannot adjust a voided batch');
            }
            const adjustQtyG = Math.round(Number(qtyG));
            if (adjustQtyG > batch.qtyRemainingG) {
                throw new Error(`Adjustment quantity (${adjustQtyG}g) exceeds batch remaining stock (${batch.qtyRemainingG}g)`);
            }
            let costImpact;
            if (adjustQtyG === batch.qtyRemainingG) {
                costImpact = batch.costRemaining;
                batch.qtyRemainingG = 0;
                batch.costRemaining = 0;
                batch.status = 'depleted';
            }
            else {
                costImpact = Math.round((adjustQtyG * batch.totalCost) / batch.receivedQtyG);
                batch.qtyRemainingG -= adjustQtyG;
                batch.costRemaining -= costImpact;
            }
            if (session) {
                await batch.save({ session });
            }
            else {
                await batch.save();
            }
            const adjustment = new StockAdjustment_model_1.StockAdjustment({
                product: batch.product,
                batch: batch._id,
                qtyG: adjustQtyG,
                type,
                costImpact,
                reason: reason.trim(),
            });
            if (session) {
                await adjustment.save({ session });
            }
            else {
                await adjustment.save();
            }
            return adjustment;
        });
    }
    /**
     * Physical count reconciliation: calculates difference against system stock and writes physical_count adjustment
     */
    static async reconcilePhysicalCount(productId, actualWeighedQtyG, reason = 'Routine physical inventory count reconciliation') {
        const activeBatches = await StockBatch_model_1.StockBatch.find({
            product: productId,
            status: 'active',
            qtyRemainingG: { $gt: 0 },
        }).sort({ purchasedAt: 1, batchNo: 1 });
        const systemQtyG = activeBatches.reduce((acc, b) => acc + b.qtyRemainingG, 0);
        const actualQtyG = Math.round(Number(actualWeighedQtyG));
        const differenceG = systemQtyG - actualQtyG; // Positive means shortage / wastage
        if (differenceG === 0) {
            return { systemQtyG, actualQtyG, differenceG: 0 };
        }
        if (differenceG > 0) {
            // Shortage: create physical_count adjustment against oldest active batch
            const oldestBatch = activeBatches[0];
            if (!oldestBatch) {
                throw new Error('No active batch found to adjust physical stock count');
            }
            const adjustQtyG = Math.min(differenceG, oldestBatch.qtyRemainingG);
            const adjustment = await this.createAdjustment(productId, String(oldestBatch._id), adjustQtyG, 'physical_count', `${reason} (Weighed: ${actualQtyG}g vs System: ${systemQtyG}g, Shortage: ${differenceG}g)`);
            return { systemQtyG, actualQtyG, differenceG, adjustment };
        }
        return { systemQtyG, actualQtyG, differenceG };
    }
}
exports.InventoryService = InventoryService;
