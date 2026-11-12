import { z } from 'zod';
import { answerAnalyticsQuestion, createHttpError } from '../services/analyticsService.js';
import { getConversationContext, loadAnalyticsConversation } from '../services/analyticsConversationService.js';

const questionSchema = z.object({
  question: z.string().trim().min(3).max(300),
  conversationId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
}).strict();

export const askAnalyticsController = async (req, res, next) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return next(createHttpError(400, 'Invalid analytics question'));

  try {
    const result = await answerAnalyticsQuestion({ ...parsed.data, userId: req.user.id });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getAnalyticsConversationController = async (req, res, next) => {
  try {
    const conversation = await loadAnalyticsConversation({
      userId: req.user.id,
      conversationId: req.params.id,
    });
    return res.status(200).json({
      conversationId: conversation._id.toString(),
      conversationHistory: getConversationContext(conversation.messages),
    });
  } catch (error) {
    return next(error);
  }
};
