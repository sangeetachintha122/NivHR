import mongoose from 'mongoose';
import { LEAVE_TYPES } from '../config/leavePolicy.js';

export const ACTIVITY_EVENT_TYPES = Object.freeze([
  'login_success',
  'login_failed',
  'login_rate_limited',
  'logout',
  'employee_created',
  'employee_updated',
  'employee_deactivated',
  'leave_applied',
  'leave_cancelled',
  'leave_approved',
  'leave_rejected',
  'department_capacity_updated',
]);

export const ACTIVITY_CHANGED_FIELDS = Object.freeze([
  'name', 'email', 'department', 'joinDate', 'isActive',
]);

const activityEventSchema = new mongoose.Schema({
  eventType: { type: String, enum: ACTIVITY_EVENT_TYPES, required: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  subjectUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  occurredAt: { type: Date, required: true, default: Date.now },
  department: { type: String, trim: true, maxlength: 100 },
  leaveType: { type: String, enum: LEAVE_TYPES },
  changedFields: [{ type: String, enum: ACTIVITY_CHANGED_FIELDS }],
}, { strict: 'throw', versionKey: false });

activityEventSchema.index({ eventType: 1, occurredAt: -1 });
activityEventSchema.index({ actorUserId: 1, occurredAt: -1 });
activityEventSchema.index({ subjectUserId: 1, occurredAt: -1 });

const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);

export default ActivityEvent;
