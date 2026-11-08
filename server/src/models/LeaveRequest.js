import mongoose from 'mongoose';
import { LEAVE_TYPES } from '../config/leavePolicy.js';

const leaveRequestSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: LEAVE_TYPES,
      required: true,
    },
    fromDate: {
      type: Date,
      required: true,
    },
    toDate: {
      type: Date,
      required: true,
      validate: {
        validator(value) {
          return !this.fromDate || value >= this.fromDate;
        },
        message: 'toDate must be on or after fromDate',
      },
    },
    totalDays: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
      required: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
);

leaveRequestSchema.index({ employeeId: 1, status: 1, fromDate: 1, toDate: 1 });
leaveRequestSchema.index({ employeeId: 1, createdAt: -1 });
leaveRequestSchema.index({ status: 1, createdAt: -1 });

const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);

export default LeaveRequest;
