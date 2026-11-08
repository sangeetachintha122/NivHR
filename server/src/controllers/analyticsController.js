import { z } from 'zod';
import { answerAnalyticsQuestion, createHttpError } from '../services/analyticsService.js';

const questionSchema = z.object({
  question: z.string().trim().min(3).max(300),
}).strict();

export const askAnalyticsController = async (req, res, next) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return next(createHttpError(400, 'Invalid analytics question'));

  try {
    const result = await answerAnalyticsQuestion({ userId: req.user.id, question: parsed.data.question });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
