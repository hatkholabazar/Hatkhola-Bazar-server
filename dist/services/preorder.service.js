"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreOrderService = void 0;
const mongoose_1 = require("mongoose");
const crypto_1 = __importDefault(require("crypto"));
const PreOrder_model_1 = require("../models/PreOrder.model");
const Product_model_1 = require("../models/Product.model");
const StockBatch_model_1 = require("../models/StockBatch.model");
const Counter_model_1 = require("../models/Counter.model");
const Settings_model_1 = require("../models/Settings.model");
const inventory_service_1 = require("./inventory.service");
class PreOrderService {
    /**
     * Generates atomic PRE-{YYMM}-{SEQ} number
     */
    static async generatePreOrderNo(date = new Date(), _session) {
        const d = new Date(date);
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yymm = `${yy}${mm}`;
        const counterKey = `preorder:${yymm}`;
        // Atomic increment like a database sequence (e.g. Postgres sequence)
        // Runs outside session to eliminate transaction lock conflict during concurrent inserts
        const counterDoc = await Counter_model_1.Counter.findOneAndUpdate({ _id: counterKey }, { $inc: { seq: 1 } }, { upsert: true, new: true });
        const seqStr = String(counterDoc.seq).padStart(3, '0');
        return `PRE-${yymm}-${seqStr}`;
    }
    /**
     * Total open pre-order grams for a given product
     */
    static async getOpenPreOrderGrams(productId, excludePreOrderId) {
        const query = {
            status: { $in: ['pending', 'confirmed', 'ready'] },
            'items.product': new mongoose_1.Types.ObjectId(String(productId)),
        };
        if (excludePreOrderId) {
            query._id = { $ne: new mongoose_1.Types.ObjectId(excludePreOrderId) };
        }
        const openOrders = await PreOrder_model_1.PreOrder.find(query);
        let totalGrams = 0;
        for (const order of openOrders) {
            for (const item of order.items) {
                if (item.product.toString() === productId.toString()) {
                    totalGrams += item.qtyG;
                }
            }
        }
        return totalGrams;
    }
    /**
     * Create a new Pre-Order (does NOT deduct stock, does NOT run FIFO, creates NO Sale or revenue)
     */
    static async createPreOrder(input, actor = 'admin') {
        if (!input.items || input.items.length === 0) {
            throw new Error('Pre-order must contain at least one product item');
        }
        // Check Global Settings
        const settings = await Settings_model_1.Settings.findOne();
        if (settings && settings.preOrderEnabled === false) {
            throw new Error('Pre-orders are currently globally disabled in settings.');
        }
        // Validate products, availabilityMode, pre-order cutoff and maxQtyG
        const verifiedItems = [];
        let quotedTotal = 0;
        for (const itemInput of input.items) {
            const product = await Product_model_1.Product.findById(itemInput.productId);
            if (!product) {
                throw new Error(`Product not found for ID: ${itemInput.productId}`);
            }
            if (product.availabilityMode !== 'pre_order') {
                throw new Error(`Product "${product.name}" is not open for pre-orders (current mode: ${product.availabilityMode}).`);
            }
            if (product.preOrder?.closesAt && new Date() > new Date(product.preOrder.closesAt)) {
                throw new Error(`Pre-order window for "${product.name}" closed on ${new Date(product.preOrder.closesAt).toLocaleDateString()}.`);
            }
            const itemQtyG = Math.round(Number(itemInput.qtyG));
            const quotedPrice = Math.round(Number(itemInput.quotedPrice));
            if (product.preOrder?.maxQtyG && product.preOrder.maxQtyG > 0) {
                const currentOpenG = await this.getOpenPreOrderGrams(product._id);
                if (currentOpenG + itemQtyG > product.preOrder.maxQtyG) {
                    throw new Error(`Product "${product.name}" pre-order cap reached (${product.preOrder.maxQtyG}g). Current open demand is ${currentOpenG}g, cannot add ${itemQtyG}g.`);
                }
            }
            verifiedItems.push({
                product: product._id,
                productCode: product.code,
                productName: product.name,
                optionLabel: itemInput.optionLabel.trim(),
                qtyG: itemQtyG,
                quotedPrice,
            });
            quotedTotal += quotedPrice;
        }
        return await inventory_service_1.InventoryService.runInTransaction(async (session) => {
            const preOrderNo = await this.generatePreOrderNo(new Date(), session);
            const deposits = [];
            let depositTotal = 0;
            if (input.deposit && input.deposit.amount > 0) {
                const depositAmount = Math.round(Number(input.deposit.amount));
                deposits.push({
                    depositId: crypto_1.default.randomUUID(),
                    amount: depositAmount,
                    method: input.deposit.method,
                    trxId: input.deposit.trxId?.trim(),
                    receivedAt: input.deposit.receivedAt ? new Date(input.deposit.receivedAt) : new Date(),
                    attachment: input.deposit.attachment,
                });
                depositTotal += depositAmount;
            }
            const initialStatus = depositTotal > 0 ? 'confirmed' : 'pending';
            const preOrder = new PreOrder_model_1.PreOrder({
                preOrderNo,
                customerName: input.customerName.trim(),
                customerPhone: input.customerPhone.trim(),
                channel: input.channel || 'whatsapp',
                address: input.address?.trim(),
                items: verifiedItems,
                quotedTotal,
                expectedDate: input.expectedDate ? new Date(input.expectedDate) : undefined,
                note: input.note?.trim(),
                deposits,
                depositTotal,
                refundedTotal: 0,
                forfeitedTotal: 0,
                status: initialStatus,
                statusHistory: [
                    {
                        status: initialStatus,
                        changedAt: new Date(),
                        changedBy: actor,
                        note: depositTotal > 0 ? `Pre-order created with initial deposit ৳${depositTotal}` : 'Pre-order created',
                    },
                ],
                refunds: [],
            });
            if (session) {
                await preOrder.save({ session });
            }
            else {
                await preOrder.save();
            }
            return preOrder;
        });
    }
    /**
     * Add customer deposit (customer deposit liability)
     */
    static async addDeposit(preOrderId, depositInput, actor = 'admin') {
        const amount = Math.round(Number(depositInput.amount));
        if (amount <= 0) {
            throw new Error('Deposit amount must be greater than 0');
        }
        const preOrder = await PreOrder_model_1.PreOrder.findById(preOrderId);
        if (!preOrder) {
            throw new Error('Pre-order not found');
        }
        if (preOrder.status === 'fulfilled' || preOrder.status === 'cancelled' || preOrder.status === 'refunded') {
            throw new Error(`Cannot add deposit to a pre-order with status "${preOrder.status}"`);
        }
        const newDeposit = {
            depositId: crypto_1.default.randomUUID(),
            amount,
            method: depositInput.method,
            trxId: depositInput.trxId?.trim(),
            receivedAt: depositInput.receivedAt ? new Date(depositInput.receivedAt) : new Date(),
            attachment: depositInput.attachment,
        };
        preOrder.deposits.push(newDeposit);
        preOrder.depositTotal += amount;
        // Transition pending -> confirmed upon receiving first deposit
        if (preOrder.status === 'pending') {
            preOrder.status = 'confirmed';
            preOrder.statusHistory.push({
                status: 'confirmed',
                changedAt: new Date(),
                changedBy: actor,
                note: `Status updated to confirmed upon deposit of ৳${amount} via ${depositInput.method}`,
            });
        }
        else {
            preOrder.statusHistory.push({
                status: preOrder.status,
                changedAt: new Date(),
                changedBy: actor,
                note: `Additional deposit of ৳${amount} received via ${depositInput.method}`,
            });
        }
        await preOrder.save();
        return preOrder;
    }
    /**
     * Allocate an incoming or active StockBatch to this pre-order
     */
    static async allocateBatch(preOrderId, batchId, actor = 'admin') {
        const batch = await StockBatch_model_1.StockBatch.findById(batchId);
        if (!batch) {
            throw new Error('StockBatch not found');
        }
        const preOrder = await PreOrder_model_1.PreOrder.findById(preOrderId);
        if (!preOrder) {
            throw new Error('Pre-order not found');
        }
        if (preOrder.status === 'fulfilled' || preOrder.status === 'cancelled' || preOrder.status === 'refunded') {
            throw new Error(`Cannot allocate batch to a pre-order with status "${preOrder.status}"`);
        }
        preOrder.linkedBatchId = batch._id;
        if (preOrder.status === 'pending' || preOrder.status === 'confirmed') {
            preOrder.status = 'ready';
            preOrder.statusHistory.push({
                status: 'ready',
                changedAt: new Date(),
                changedBy: actor,
                note: `Allocated to batch ${batch.batchNo}. Marked ready for fulfilment.`,
            });
        }
        else {
            preOrder.statusHistory.push({
                status: preOrder.status,
                changedAt: new Date(),
                changedBy: actor,
                note: `Linked to batch ${batch.batchNo}.`,
            });
        }
        await preOrder.save();
        return preOrder;
    }
    /**
     * One-click allocation of a batch to open pre-orders for the batch's product
     */
    static async allocateBatchToOpenPreOrders(productId, batchId, actor = 'admin') {
        const batch = await StockBatch_model_1.StockBatch.findById(batchId);
        if (!batch) {
            throw new Error('StockBatch not found');
        }
        const openPreOrders = await PreOrder_model_1.PreOrder.find({
            status: { $in: ['pending', 'confirmed'] },
            'items.product': new mongoose_1.Types.ObjectId(productId),
        }).sort({ createdAt: 1 });
        let allocatedCount = 0;
        let allocatedGrams = 0;
        for (const preOrder of openPreOrders) {
            preOrder.linkedBatchId = batch._id;
            preOrder.status = 'ready';
            preOrder.statusHistory.push({
                status: 'ready',
                changedAt: new Date(),
                changedBy: actor,
                note: `Auto-allocated to incoming batch ${batch.batchNo}. Marked ready.`,
            });
            for (const item of preOrder.items) {
                if (item.product.toString() === productId.toString()) {
                    allocatedGrams += item.qtyG;
                }
            }
            await preOrder.save();
            allocatedCount++;
        }
        return { allocatedCount, allocatedGrams };
    }
    /**
     * Fulfil a Pre-Order inside an ACID Transaction:
     * - Deducts stock using FIFO allocation
     * - Creates Sale record
     * - Applies deposit
     * - Marks pre-order fulfilled & stores fulfilledSaleId
     * - Supports partial fulfillment by creating linked remainder pre-order
     */
    static async fulfilPreOrder(preOrderId, input = {}, actor = 'admin') {
        return await inventory_service_1.InventoryService.runInTransaction(async (session) => {
            const preOrder = await PreOrder_model_1.PreOrder.findById(preOrderId).session(session || null);
            if (!preOrder) {
                throw new Error('Pre-order not found');
            }
            if (preOrder.status === 'fulfilled') {
                throw new Error('Pre-order is already fulfilled');
            }
            if (preOrder.status === 'cancelled' || preOrder.status === 'refunded') {
                throw new Error(`Cannot fulfil a ${preOrder.status} pre-order`);
            }
            // Check if partial fulfilment is requested
            let saleItems = [];
            let remainderItems = [];
            let hasPartial = false;
            if (input.fulfilledItems && input.fulfilledItems.length > 0) {
                for (const item of preOrder.items) {
                    const match = input.fulfilledItems.find((fi) => fi.productId.toString() === item.product.toString());
                    if (match && match.qtyG > 0 && match.qtyG < item.qtyG) {
                        hasPartial = true;
                        saleItems.push({
                            productId: String(item.product),
                            optionLabel: `${item.optionLabel} (Partial ${match.qtyG}g of ${item.qtyG}g)`,
                            qtyG: match.qtyG,
                            sellingPrice: match.quotedPrice,
                        });
                        const remG = item.qtyG - match.qtyG;
                        const remPrice = Math.max(0, item.quotedPrice - match.quotedPrice);
                        remainderItems.push({
                            product: item.product,
                            productCode: item.productCode,
                            productName: item.productName,
                            optionLabel: `${item.optionLabel} (Remaining ${remG}g)`,
                            qtyG: remG,
                            quotedPrice: remPrice,
                        });
                    }
                    else {
                        // Full fulfilment for this item
                        saleItems.push({
                            productId: String(item.product),
                            optionLabel: item.optionLabel,
                            qtyG: item.qtyG,
                            sellingPrice: item.quotedPrice,
                        });
                    }
                }
            }
            else {
                // Standard 100% fulfilment of all items
                saleItems = preOrder.items.map((it) => ({
                    productId: String(it.product),
                    optionLabel: it.optionLabel,
                    qtyG: it.qtyG,
                    sellingPrice: it.quotedPrice,
                }));
            }
            // Create Sale using existing FIFO logic inside same session
            const saleInput = {
                soldAt: new Date(),
                customerName: preOrder.customerName,
                customerPhone: preOrder.customerPhone,
                customerAddress: input.customerAddress || preOrder.address,
                courierName: input.courierName,
                courierCharge: input.courierCharge ? Math.round(Number(input.courierCharge)) : 0,
                courierTrackingId: input.courierTrackingId,
                deliveryNotes: input.deliveryNotes || `Fulfilled from Pre-order ${preOrder.preOrderNo}`,
                paymentMethod: input.paymentMethod || 'cash_on_delivery',
                paymentTrxId: input.paymentTrxId,
                channel: preOrder.channel,
                items: saleItems,
            };
            const sale = await inventory_service_1.InventoryService.createSale(saleInput, session);
            // Update pre-order status
            preOrder.status = 'fulfilled';
            preOrder.fulfilledSaleId = sale._id;
            preOrder.statusHistory.push({
                status: 'fulfilled',
                changedAt: new Date(),
                changedBy: actor,
                note: `Fulfilled via Sale ID ${sale._id}. Deposit ৳${preOrder.depositTotal} applied.`,
            });
            if (session) {
                await preOrder.save({ session });
            }
            else {
                await preOrder.save();
            }
            // Handle remainder pre-order if partial
            let remainingPreOrder;
            if (hasPartial && remainderItems.length > 0) {
                const remainderPreOrderNo = await this.generatePreOrderNo(new Date(), session);
                const remQuotedTotal = remainderItems.reduce((s, it) => s + it.quotedPrice, 0);
                remainingPreOrder = new PreOrder_model_1.PreOrder({
                    preOrderNo: remainderPreOrderNo,
                    customerName: preOrder.customerName,
                    customerPhone: preOrder.customerPhone,
                    channel: preOrder.channel,
                    address: preOrder.address,
                    items: remainderItems,
                    quotedTotal: remQuotedTotal,
                    expectedDate: preOrder.expectedDate,
                    note: `Remainder line from partial fulfillment of ${preOrder.preOrderNo}`,
                    deposits: [],
                    depositTotal: 0,
                    refundedTotal: 0,
                    forfeitedTotal: 0,
                    status: 'pending',
                    statusHistory: [
                        {
                            status: 'pending',
                            changedAt: new Date(),
                            changedBy: actor,
                            note: `Created as remaining portion from ${preOrder.preOrderNo}`,
                        },
                    ],
                });
                if (remainingPreOrder) {
                    if (session) {
                        await remainingPreOrder.save({ session });
                    }
                    else {
                        await remainingPreOrder.save();
                    }
                }
            }
            return { sale, preOrder, remainingPreOrder };
        });
    }
    /**
     * Cancel and process refund or forfeiture of deposits
     */
    static async cancelPreOrder(preOrderId, input, actor = 'admin') {
        if (!input.reason || !input.reason.trim()) {
            throw new Error('Cancellation reason is strictly required');
        }
        const preOrder = await PreOrder_model_1.PreOrder.findById(preOrderId);
        if (!preOrder) {
            throw new Error('Pre-order not found');
        }
        if (preOrder.status === 'fulfilled') {
            throw new Error('Cannot cancel an already fulfilled pre-order');
        }
        if (preOrder.status === 'cancelled' || preOrder.status === 'refunded') {
            throw new Error(`Pre-order is already ${preOrder.status}`);
        }
        let refundAmount = 0;
        let forfeitAmount = 0;
        if (input.refundType === 'full_refund') {
            refundAmount = preOrder.depositTotal;
        }
        else if (input.refundType === 'forfeit') {
            forfeitAmount = preOrder.depositTotal;
        }
        else if (input.refundType === 'partial_refund') {
            refundAmount = Math.max(0, Math.round(Number(input.refundAmount || 0)));
            forfeitAmount = Math.max(0, Math.round(Number(input.forfeitAmount || 0)));
            if (refundAmount + forfeitAmount > preOrder.depositTotal) {
                throw new Error(`Refund (৳${refundAmount}) + Forfeit (৳${forfeitAmount}) cannot exceed total deposit held (৳${preOrder.depositTotal})`);
            }
        }
        const refundRecords = [];
        if (refundAmount > 0) {
            refundRecords.push({
                amount: refundAmount,
                type: 'refund',
                reason: input.reason.trim(),
                processedAt: new Date(),
                processedBy: actor,
                trxId: input.trxId?.trim(),
            });
        }
        if (forfeitAmount > 0) {
            refundRecords.push({
                amount: forfeitAmount,
                type: 'forfeit',
                reason: `Deposit forfeited: ${input.reason.trim()}`,
                processedAt: new Date(),
                processedBy: actor,
                trxId: input.trxId?.trim(),
            });
        }
        preOrder.refundedTotal += refundAmount;
        preOrder.forfeitedTotal += forfeitAmount;
        preOrder.refunds.push(...refundRecords);
        preOrder.cancelReason = input.reason.trim();
        // If 100% of deposit was refunded, mark as refunded; otherwise cancelled
        const finalStatus = preOrder.depositTotal > 0 && refundAmount === preOrder.depositTotal
            ? 'refunded'
            : 'cancelled';
        preOrder.status = finalStatus;
        preOrder.statusHistory.push({
            status: finalStatus,
            changedAt: new Date(),
            changedBy: actor,
            note: `Pre-order cancelled. Reason: ${input.reason}. Refunded: ৳${refundAmount}, Forfeited: ৳${forfeitAmount}`,
        });
        await preOrder.save();
        return preOrder;
    }
    /**
     * Validate and enforce status transitions
     */
    static async changeStatus(preOrderId, newStatus, note, actor = 'admin') {
        const preOrder = await PreOrder_model_1.PreOrder.findById(preOrderId);
        if (!preOrder) {
            throw new Error('Pre-order not found');
        }
        const currentStatus = preOrder.status;
        // Allowed transition map
        const allowedTransitions = {
            pending: ['confirmed', 'ready', 'cancelled'],
            confirmed: ['ready', 'cancelled', 'refunded'],
            ready: ['confirmed', 'cancelled', 'refunded'],
            fulfilled: [], // Terminal
            cancelled: [], // Terminal
            refunded: [], // Terminal
        };
        const validCurrent = currentStatus;
        if (!allowedTransitions[validCurrent] || !allowedTransitions[validCurrent].includes(newStatus)) {
            throw new Error(`Invalid status transition from "${currentStatus}" to "${newStatus}".`);
        }
        preOrder.status = newStatus;
        preOrder.statusHistory.push({
            status: newStatus,
            changedAt: new Date(),
            changedBy: actor,
            note: note || `Status changed from ${currentStatus} to ${newStatus}`,
        });
        await preOrder.save();
        return preOrder;
    }
    /**
     * Filter and list pre-orders
     */
    static async getPreOrders(filter = {}) {
        const query = {};
        if (filter.status && filter.status !== 'all') {
            query.status = filter.status;
        }
        if (filter.productId && filter.productId !== 'all') {
            query['items.product'] = new mongoose_1.Types.ObjectId(filter.productId);
        }
        if (filter.search && filter.search.trim()) {
            const term = filter.search.trim();
            query.$or = [
                { preOrderNo: { $regex: term, $options: 'i' } },
                { customerName: { $regex: term, $options: 'i' } },
                { customerPhone: { $regex: term, $options: 'i' } },
            ];
        }
        const page = Math.max(1, Number(filter.page) || 1);
        const limit = Math.max(1, Math.min(100, Number(filter.limit) || 50));
        const skip = (page - 1) * limit;
        const [preOrders, total] = await Promise.all([
            PreOrder_model_1.PreOrder.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
            PreOrder_model_1.PreOrder.countDocuments(query),
        ]);
        return { preOrders, total };
    }
    /**
     * Pre-order pipeline metrics & inventory shortfall calculation
     */
    static async getPreOrderMetrics() {
        const openPreOrders = await PreOrder_model_1.PreOrder.find({
            status: { $in: ['pending', 'confirmed', 'ready'] },
        });
        const openCount = openPreOrders.length;
        let openGrams = 0;
        let depositsHeld = 0;
        const productGramsMap = {};
        for (const po of openPreOrders) {
            depositsHeld += po.depositTotal;
            for (const item of po.items) {
                openGrams += item.qtyG;
                const pId = item.product.toString();
                if (!productGramsMap[pId]) {
                    productGramsMap[pId] = {
                        name: item.productName,
                        code: item.productCode,
                        grams: 0,
                    };
                }
                productGramsMap[pId].grams += item.qtyG;
            }
        }
        // Forfeited deposit total across all pre-orders (counts as Other Income)
        const cancelledOrders = await PreOrder_model_1.PreOrder.find({
            forfeitedTotal: { $gt: 0 },
        });
        const forfeitedIncome = cancelledOrders.reduce((sum, po) => sum + po.forfeitedTotal, 0);
        // Calculate shortfall against active stock batches
        const productDemands = [];
        for (const [pId, info] of Object.entries(productGramsMap)) {
            const activeBatches = await StockBatch_model_1.StockBatch.find({
                product: new mongoose_1.Types.ObjectId(pId),
                status: 'active',
            });
            const availableStockGrams = activeBatches.reduce((sum, b) => sum + b.qtyRemainingG, 0);
            const shortfallGrams = Math.max(0, info.grams - availableStockGrams);
            productDemands.push({
                productId: pId,
                productName: info.name,
                productCode: info.code,
                openGrams: info.grams,
                availableStockGrams,
                shortfallGrams,
            });
        }
        return {
            openCount,
            openGrams,
            depositsHeld,
            forfeitedIncome,
            productDemands,
        };
    }
}
exports.PreOrderService = PreOrderService;
