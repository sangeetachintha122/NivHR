import AIUsageDaily from '../models/AIUsageDaily.js';

const dayKey = (date) => date.toISOString().slice(0, 10);
const isDuplicateKeyError = (error) => error?.code === 11000;

export const reserveCloudflareRequest = async (dailyLimit, { now = new Date(), model = AIUsageDaily } = {}) => {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || !(now instanceof Date) || Number.isNaN(now.valueOf())) {
    throw new TypeError('Invalid AI usage reservation configuration');
  }

  const filter = { _id: dayKey(now), count: { $lt: dailyLimit } };
  try {
    const reserved = await model.findOneAndUpdate(
      filter,
      { $inc: { count: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
    );
    return Boolean(reserved);
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Another concurrent request created today's row. Retry without upsert so the cap
    // remains enforced by MongoDB's atomic count predicate.
    const reserved = await model.findOneAndUpdate(
      filter,
      { $inc: { count: 1 } },
      { new: true, runValidators: true },
    );
    return Boolean(reserved);
  }
};
