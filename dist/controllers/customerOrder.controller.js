"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomerOrderController = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const customerOrder_validator_1 = require("../validators/customerOrder.validator");
const Product_model_1 = require("../models/Product.model");
const Sale_model_1 = require("../models/Sale.model");
const PreOrder_model_1 = require("../models/PreOrder.model");
const Settings_model_1 = require("../models/Settings.model");
const pathao_service_1 = require("../services/pathao.service");
const inventory_service_1 = require("../services/inventory.service");
class CustomerOrderController {
    /**
     * Create customer order (idempotent, server-calculated prices, availability enforcement)
     */
    static async createOrder(req, res) {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ error: 'Customer authentication required' });
            }
            const parseResult = customerOrder_validator_1.CustomerCreateOrderSchema.safeParse(req.body);
            if (!parseResult.success) {
                const firstError = parseResult.error.errors[0]?.message || 'Invalid order data';
                return res.status(400).json({ error: firstError });
            }
            const data = parseResult.data;
            const idempotencyKey = data.idempotencyKey;
            const db = mongoose_1.default.connection.db;
            // 1. Idempotency Check: look up existing order by userId + idempotencyKey
            if (db) {
                const existingOrder = await db.collection('orders').findOne({
                    userId: user.id,
                    idempotencyKey,
                });
                if (existingOrder) {
                    return res.status(200).json({
                        success: true,
                        orderId: existingOrder.orderId,
                        isIdempotentReplay: true,
                        message: 'Order already placed',
                    });
                }
            }
            const existingSale = await Sale_model_1.Sale.findOne({ userId: user.id, idempotencyKey });
            if (existingSale) {
                return res.status(200).json({
                    success: true,
                    orderId: `HB-${existingSale._id.toString().slice(-6).toUpperCase()}`,
                    isIdempotentReplay: true,
                });
            }
            const existingPreOrder = await PreOrder_model_1.PreOrder.findOne({ userId: user.id, idempotencyKey });
            if (existingPreOrder) {
                return res.status(200).json({
                    success: true,
                    orderId: existingPreOrder.preOrderNo,
                    isIdempotentReplay: true,
                });
            }
            // 2. Server price recalculation and catalog verification
            const verifiedItems = [];
            let hasPreOrder = false;
            let itemsSubtotal = 0;
            for (const item of data.items) {
                let product = null;
                if (mongoose_1.default.Types.ObjectId.isValid(item.productId)) {
                    product = await Product_model_1.Product.findById(item.productId);
                }
                if (!product) {
                    product = await Product_model_1.Product.findOne({
                        $or: [{ code: item.productId.toUpperCase() }, { slug: item.productId }],
                    });
                }
                if (!product || !product.isActive) {
                    return res.status(400).json({
                        error: 'One or more items in your cart are no longer available.',
                    });
                }
                const mode = product.availabilityMode || 'in_stock';
                if (mode === 'out_of_stock') {
                    return res.status(400).json({
                        error: `Product "${product.name}" is currently out of stock.`,
                    });
                }
                const matchedOption = product.sellingOptions?.find((opt) => opt.label.toLowerCase() === item.optionLabel.toLowerCase() ||
                    (opt.qtyG === item.qtyG && opt.label.toLowerCase().includes(item.optionLabel.toLowerCase())) ||
                    opt.qtyG === item.qtyG);
                if (!matchedOption) {
                    return res.status(400).json({
                        error: `Selected weight/option for "${product.name}" is invalid.`,
                    });
                }
                const unitPrice = Math.round(Number(matchedOption.sellingPrice));
                const quantity = item.quantity > 0 ? item.quantity : 1;
                const lineTotal = unitPrice * quantity;
                itemsSubtotal += lineTotal;
                const isItemPreOrder = mode === 'pre_order';
                if (isItemPreOrder)
                    hasPreOrder = true;
                verifiedItems.push({
                    product,
                    optionLabel: matchedOption.label,
                    qtyG: matchedOption.qtyG,
                    quantity,
                    unitPrice,
                    lineTotal,
                    isPreOrder: isItemPreOrder,
                });
            }
            // 3. Delivery calculation (Integer Taka)
            let deliveryCharge = 60;
            if (data.deliveryArea === 'outside' ||
                (data.cityName &&
                    !data.cityName.toLowerCase().includes('chittagong') &&
                    !data.cityName.toLowerCase().includes('chattogram'))) {
                deliveryCharge = 120;
            }
            const grandTotal = itemsSubtotal + deliveryCharge;
            const orderTimestamp = Date.now();
            const orderId = `HB-${orderTimestamp.toString().slice(-6)}`;
            let mappedPaymentMethod = 'cash_on_delivery';
            if (data.paymentMethod === 'bkash')
                mappedPaymentMethod = 'bkash';
            else if (data.paymentMethod === 'nagad')
                mappedPaymentMethod = 'nagad';
            let createdRecordType = 'sale';
            if (hasPreOrder) {
                createdRecordType = 'pre_order';
                const preOrderNo = `PRE-${orderTimestamp.toString().slice(-6)}`;
                const preOrderItems = verifiedItems.map((vi) => ({
                    product: vi.product._id,
                    productCode: vi.product.code,
                    productName: vi.product.name,
                    optionLabel: vi.optionLabel,
                    qtyG: vi.qtyG * vi.quantity,
                    quotedPrice: vi.lineTotal,
                }));
                const deposits = [];
                let depositTotal = 0;
                if (data.paymentMethod === 'bkash' || data.paymentMethod === 'nagad') {
                    depositTotal = grandTotal;
                    deposits.push({
                        depositId: `DEP-${Date.now().toString().slice(-6)}`,
                        amount: grandTotal,
                        method: data.paymentMethod,
                        trxId: data.trxId,
                        receivedAt: new Date(),
                    });
                }
                await PreOrder_model_1.PreOrder.create({
                    preOrderNo,
                    userId: user.id,
                    idempotencyKey,
                    customerName: data.fullName,
                    customerPhone: data.phone,
                    channel: 'other',
                    address: data.address,
                    recipientName: data.fullName,
                    recipientPhone: data.phone,
                    recipientAddress: data.address,
                    pathaoCityId: data.cityId,
                    pathaoZoneId: data.zoneId,
                    pathaoAreaId: data.areaId,
                    pathaoCityName: data.cityName,
                    pathaoZoneName: data.zoneName,
                    pathaoAreaName: data.areaName,
                    courierCost: 0,
                    items: preOrderItems,
                    quotedTotal: grandTotal,
                    deposits,
                    depositTotal,
                    refundedTotal: 0,
                    forfeitedTotal: 0,
                    status: 'confirmed',
                    statusHistory: [
                        {
                            status: 'confirmed',
                            changedAt: new Date(),
                            changedBy: user.email,
                            note: 'Online checkout order submitted',
                        },
                    ],
                    note: data.notes,
                });
            }
            else {
                const settings = await Settings_model_1.Settings.findOne();
                const packagingCost = settings?.packagingCostPerOrder || 25;
                const saleItemsInput = verifiedItems.map((vi) => ({
                    productId: vi.product._id.toString(),
                    optionLabel: vi.optionLabel,
                    qtyG: vi.qtyG * vi.quantity,
                    sellingPrice: vi.lineTotal,
                }));
                try {
                    const createdSale = await inventory_service_1.InventoryService.createSale({
                        soldAt: new Date(),
                        customerName: data.fullName,
                        customerPhone: data.phone,
                        customerAddress: data.address,
                        channel: 'other',
                        paymentMethod: mappedPaymentMethod,
                        items: saleItemsInput,
                        courierCharge: deliveryCharge,
                        packagingCost,
                    });
                    createdSale.userId = user.id;
                    createdSale.idempotencyKey = idempotencyKey;
                    createdSale.recipientName = data.fullName;
                    createdSale.recipientPhone = data.phone;
                    createdSale.recipientAddress = data.address;
                    createdSale.pathaoCityId = data.cityId;
                    createdSale.pathaoZoneId = data.zoneId;
                    createdSale.pathaoAreaId = data.areaId;
                    createdSale.pathaoCityName = data.cityName;
                    createdSale.pathaoZoneName = data.zoneName;
                    createdSale.pathaoAreaName = data.areaName;
                    if (data.notes)
                        createdSale.deliveryNotes = data.notes;
                    if (data.trxId)
                        createdSale.paymentTrxId = data.trxId;
                    await createdSale.save();
                }
                catch {
                    // If FIFO batch allocation fails (e.g. initial dev state or partial batches), create unallocated Sale record
                    await Sale_model_1.Sale.create({
                        soldAt: new Date(),
                        userId: user.id,
                        idempotencyKey,
                        customerName: data.fullName,
                        customerPhone: data.phone,
                        customerAddress: data.address,
                        recipientName: data.fullName,
                        recipientPhone: data.phone,
                        recipientAddress: data.address,
                        pathaoCityId: data.cityId,
                        pathaoZoneId: data.zoneId,
                        pathaoAreaId: data.areaId,
                        pathaoCityName: data.cityName,
                        pathaoZoneName: data.zoneName,
                        pathaoAreaName: data.areaName,
                        deliveryNotes: data.notes,
                        paymentTrxId: data.trxId,
                        channel: 'other',
                        paymentMethod: mappedPaymentMethod,
                        items: verifiedItems.map((vi) => ({
                            product: vi.product._id,
                            optionLabel: vi.optionLabel,
                            qtyG: vi.qtyG * vi.quantity,
                            sellingPrice: vi.lineTotal,
                            allocations: [],
                        })),
                        giveawayG: 0,
                        packagingCost,
                        totalRevenue: grandTotal,
                        totalCogs: 0,
                        grossProfit: grandTotal - packagingCost,
                        courierCharge: deliveryCharge,
                        status: 'completed',
                    });
                }
            }
            // Persist snapshot to orders collection for customer dashboard tracking
            if (db) {
                await db.collection('orders').insertOne({
                    orderId,
                    userId: user.id,
                    idempotencyKey,
                    customer: {
                        name: data.fullName,
                        phone: data.phone,
                        address: data.address,
                        email: user.email,
                        notes: data.notes,
                    },
                    pathao: {
                        cityId: data.cityId,
                        cityName: data.cityName,
                        zoneId: data.zoneId,
                        zoneName: data.zoneName,
                        areaId: data.areaId,
                        areaName: data.areaName,
                    },
                    items: verifiedItems.map((vi) => ({
                        productId: vi.product._id.toString(),
                        productName: vi.product.name,
                        optionLabel: vi.optionLabel,
                        qtyG: vi.qtyG,
                        quantity: vi.quantity,
                        sellingPrice: vi.unitPrice,
                        lineTotal: vi.lineTotal,
                    })),
                    subtotal: itemsSubtotal,
                    deliveryCharge,
                    grandTotal,
                    paymentMethod: data.paymentMethod,
                    paymentDetails: data.trxId || data.senderNumber
                        ? { senderNumber: data.senderNumber, trxId: data.trxId }
                        : undefined,
                    status: 'Confirmed',
                    orderType: createdRecordType,
                    createdAt: new Date(),
                });
            }
            return res.status(201).json({
                success: true,
                orderId,
                orderType: createdRecordType,
                total: grandTotal,
                message: 'Order placed successfully',
            });
        }
        catch (err) {
            return res.status(500).json({ error: err.message || 'Failed to place order' });
        }
    }
    /**
     * Customer order history list (safe fields only)
     */
    static async getMyOrders(req, res) {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            const db = mongoose_1.default.connection.db;
            const ordersList = [];
            if (db) {
                const dbOrders = await db
                    .collection('orders')
                    .find({ userId: user.id })
                    .sort({ createdAt: -1 })
                    .toArray();
                for (const o of dbOrders) {
                    ordersList.push({
                        id: o._id.toString(),
                        orderNo: o.orderId || `HB-${o._id.toString().slice(-6)}`,
                        orderType: o.orderType || 'sale',
                        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : new Date().toISOString(),
                        items: (o.items || []).map((it) => ({
                            productName: it.productName || 'Handcrafted Item',
                            optionLabel: it.optionLabel || '',
                            qtyG: it.qtyG || 0,
                            sellingPrice: it.sellingPrice || it.lineTotal || 0,
                        })),
                        totalAmount: o.grandTotal || o.total || 0,
                        paymentMethod: o.paymentMethod || 'COD',
                        status: o.status || 'Confirmed',
                        statusLabel: {
                            en: o.status || 'Confirmed',
                            bn: 'নিশ্চিত করা হয়েছে',
                        },
                    });
                }
            }
            const preOrders = await PreOrder_model_1.PreOrder.find({ userId: user.id }).sort({ createdAt: -1 });
            for (const po of preOrders) {
                if (!ordersList.some((o) => o.orderNo === po.preOrderNo)) {
                    ordersList.push({
                        id: po._id.toString(),
                        orderNo: po.preOrderNo,
                        orderType: 'preorder',
                        createdAt: po.createdAt.toISOString(),
                        items: (po.items || []).map((it) => ({
                            productName: it.productName,
                            optionLabel: it.optionLabel,
                            qtyG: it.qtyG,
                            sellingPrice: it.quotedPrice,
                        })),
                        totalAmount: po.quotedTotal,
                        paymentMethod: po.deposits.length > 0 ? po.deposits[0].method.toUpperCase() : 'COD',
                        status: po.status === 'confirmed' ? 'Confirmed' : po.status,
                        statusLabel: {
                            en: po.status,
                            bn: po.status === 'confirmed' ? 'নিশ্চিত করা হয়েছে' : po.status,
                        },
                    });
                }
            }
            ordersList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            return res.json({ success: true, orders: ordersList });
        }
        catch (err) {
            return res.status(500).json({ error: 'Failed to retrieve orders' });
        }
    }
    /**
     * Public Pathao location lookup (cities)
     */
    static async getPublicCities(req, res) {
        try {
            const cities = await pathao_service_1.PathaoService.getCities();
            return res.json({ success: true, cities });
        }
        catch (err) {
            return res.status(500).json({ error: pathao_service_1.PathaoService.sanitizeError(err.message) });
        }
    }
    /**
     * Public Pathao location lookup (zones)
     */
    static async getPublicZones(req, res) {
        try {
            const cityId = parseInt(req.params.cityId, 10);
            if (isNaN(cityId) || cityId <= 0) {
                return res.status(400).json({ error: 'Valid city ID is required' });
            }
            const zones = await pathao_service_1.PathaoService.getZones(cityId);
            return res.json({ success: true, zones });
        }
        catch (err) {
            return res.status(500).json({ error: pathao_service_1.PathaoService.sanitizeError(err.message) });
        }
    }
    /**
     * Public Pathao location lookup (areas)
     */
    static async getPublicAreas(req, res) {
        try {
            const zoneId = parseInt(req.params.zoneId, 10);
            if (isNaN(zoneId) || zoneId <= 0) {
                return res.status(400).json({ error: 'Valid zone ID is required' });
            }
            const areas = await pathao_service_1.PathaoService.getAreas(zoneId);
            return res.json({ success: true, areas });
        }
        catch (err) {
            return res.status(500).json({ error: pathao_service_1.PathaoService.sanitizeError(err.message) });
        }
    }
}
exports.CustomerOrderController = CustomerOrderController;
