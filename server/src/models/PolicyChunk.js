import mongoose from 'mongoose';

const policyChunkSchema = new mongoose.Schema(
  {
    docId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PolicyDoc',
      required: true,
      index: true,
    },
    chunkIndex: { type: Number, required: true, min: 0 },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true, select: false, default: undefined },
  },
  { timestamps: true },
);

policyChunkSchema.index({ docId: 1, chunkIndex: 1 }, { unique: true });

const PolicyChunk = mongoose.model('PolicyChunk', policyChunkSchema);

export default PolicyChunk;
