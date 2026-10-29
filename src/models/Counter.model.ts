import mongoose, { Schema } from 'mongoose';

export interface ICounter {
  _id: string; // e.g. "batch:GHEE:2610"
  seq: number;
}

const CounterSchema = new Schema<ICounter>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { _id: false, versionKey: false }
);

export const Counter = mongoose.models.Counter || mongoose.model<ICounter>('Counter', CounterSchema);
