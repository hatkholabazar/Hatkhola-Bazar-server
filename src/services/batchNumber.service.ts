import { ClientSession } from 'mongoose';
import { Counter } from '../models/Counter.model';

export class BatchNumberService {
  /**
   * Generates a unique, server-controlled batch number in the format {PRODUCT_CODE}-{YYMM}-{SEQ}
   * e.g., GHEE-2610-001, GUR-2612-002
   * SEQ restarts at 001 for each product every month.
   */
  static async generateBatchNo(
    productCode: string,
    purchasedAtDate: Date = new Date(),
    session?: ClientSession
  ): Promise<string> {
    const cleanCode = productCode.trim().toUpperCase();
    const d = new Date(purchasedAtDate);
    
    // Format YYMM (e.g., 2026-10 -> "2610")
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yymm = `${yy}${mm}`;

    const counterKey = `batch:${cleanCode}:${yymm}`;

    const counterDoc = await Counter.findOneAndUpdate(
      { _id: counterKey },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, session }
    );

    const seqStr = String(counterDoc.seq).padStart(3, '0');
    return `${cleanCode}-${yymm}-${seqStr}`;
  }
}

