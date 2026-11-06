import mongoose from 'mongoose';
import { LEAVE_TYPES } from '../config/leavePolicy.js';

const leaveBalanceSchema = new mongoose.Schema(
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
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    used: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

leaveBalanceSchema.index({ employeeId: 1, type: 1 }, { unique: true });

const LeaveBalance = mongoose.model('LeaveBalance', leaveBalanceSchema);

export default LeaveBalance;
