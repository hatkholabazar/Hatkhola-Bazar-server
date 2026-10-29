"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchNumberService = void 0;
const Counter_model_1 = require("../models/Counter.model");
class BatchNumberService {
    /**
     * Generates a unique, server-controlled batch number in the format {PRODUCT_CODE}-{YYMM}-{SEQ}
     * e.g., GHEE-2610-001, GUR-2612-002
     * SEQ restarts at 001 for each product every month.
     */
    static async generateBatchNo(productCode, purchasedAtDate = new Date(), session) {
        const cleanCode = productCode.trim().toUpperCase();
        const d = new Date(purchasedAtDate);
        // Format YYMM (e.g., 2026-10 -> "2610")
        const yy = String(d.getFullYear()).slice(-2);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yymm = `${yy}${mm}`;
        const counterKey = `batch:${cleanCode}:${yymm}`;
        const counterDoc = await Counter_model_1.Counter.findOneAndUpdate({ _id: counterKey }, { $inc: { seq: 1 } }, { upsert: true, new: true, session });
        const seqStr = String(counterDoc.seq).padStart(3, '0');
        return `${cleanCode}-${yymm}-${seqStr}`;
    }
}
exports.BatchNumberService = BatchNumberService;
