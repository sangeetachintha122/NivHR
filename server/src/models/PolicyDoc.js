import mongoose from 'mongoose';

const policyDocSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    filename: { type: String, required: true, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    chunkCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

const PolicyDoc = mongoose.model('PolicyDoc', policyDocSchema);

export default PolicyDoc;
