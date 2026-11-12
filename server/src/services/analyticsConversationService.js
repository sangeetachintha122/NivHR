import mongoose from 'mongoose';
import AnalyticsConversation from '../models/AnalyticsConversation.js';

export const MAX_CONVERSATION_TURNS = 6;
export const MAX_CONVERSATION_MESSAGES = MAX_CONVERSATION_TURNS * 2;
const CONVERSATION_TTL_MS = 30 * 86400000;

export const appendAnalyticsTurn = (messages, question, answer, createdAt = new Date()) => [
  ...messages,
  { role: 'user', content: question.slice(0, 300), createdAt },
  { role: 'assistant', content: answer.slice(0, 1200), createdAt },
].slice(-MAX_CONVERSATION_MESSAGES);

export const getConversationContext = (messages = []) => messages
  .slice(-MAX_CONVERSATION_MESSAGES)
  .map(({ role, content }) => ({ role, content }));

export const loadAnalyticsConversation = async ({ userId, conversationId }) => {
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) {
      throw Object.assign(new Error('Invalid conversation ID'), { statusCode: 400 });
    }
    const existing = await AnalyticsConversation.findOne({ _id: conversationId, userId });
    if (!existing) throw Object.assign(new Error('Analytics conversation not found'), { statusCode: 404 });
    return existing;
  }

  return AnalyticsConversation.create({
    userId,
    messages: [],
    expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
  });
};

export const saveAnalyticsTurn = async (conversation, question, answer, createdAt = new Date()) => {
  conversation.messages = appendAnalyticsTurn(conversation.messages, question, answer, createdAt);
  conversation.expiresAt = new Date(createdAt.getTime() + CONVERSATION_TTL_MS);
  await conversation.save();
  return getConversationContext(conversation.messages);
};
