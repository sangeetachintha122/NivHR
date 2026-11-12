import mongoose from 'mongoose';

const MESSAGE_LIMIT = 12;

const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true, trim: true, maxlength: 1200 },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: false, strict: 'throw' });

const analyticsConversationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  messages: {
    type: [messageSchema],
    default: [],
    validate: (messages) => messages.length <= MESSAGE_LIMIT,
  },
  expiresAt: { type: Date, required: true, default: () => new Date(Date.now() + 30 * 86400000), expires: 0 },
}, { timestamps: true, strict: 'throw' });

analyticsConversationSchema.index({ userId: 1, updatedAt: -1 });

const AnalyticsConversation = mongoose.model('AnalyticsConversation', analyticsConversationSchema);

export default AnalyticsConversation;
