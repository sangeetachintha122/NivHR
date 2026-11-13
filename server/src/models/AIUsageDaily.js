import mongoose from 'mongoose';

const aiUsageDailySchema = new mongoose.Schema({
  _id: { type: String, required: true },
  count: { type: Number, required: true, min: 0, default: 0 },
}, { versionKey: false, strict: 'throw' });

const AIUsageDaily = mongoose.model('AIUsageDaily', aiUsageDailySchema);

export default AIUsageDaily;
