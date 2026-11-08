import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, required: true },
    intent: { type: String, trim: true },
    status: { type: String, required: true },
    latencyMs: { type: Number, required: true, min: 0 },
    metadata: {
      topSimilarityScore: Number,
      retrievedChunkCount: Number,
      found: Boolean,
      recommendation: String,
    },
  },
  { timestamps: true },
);

auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ feature: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;
