import ActivityEvent, { ACTIVITY_CHANGED_FIELDS, ACTIVITY_EVENT_TYPES } from '../models/ActivityEvent.js';

const validEventTypes = new Set(ACTIVITY_EVENT_TYPES);
const validChangedFields = new Set(ACTIVITY_CHANGED_FIELDS);

export const buildActivityEventRecord = (event) => {
  if (!event || !validEventTypes.has(event.eventType)) return null;
  return {
    eventType: event.eventType,
    ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
    ...(event.subjectUserId ? { subjectUserId: event.subjectUserId } : {}),
    ...(event.entityId ? { entityId: event.entityId } : {}),
    ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    ...(typeof event.department === 'string' ? { department: event.department.trim().slice(0, 100) } : {}),
    ...(event.leaveType ? { leaveType: event.leaveType } : {}),
    ...(Array.isArray(event.changedFields)
      ? { changedFields: [...new Set(event.changedFields.filter((field) => validChangedFields.has(field)))] }
      : {}),
  };
};

export const recordActivityEvent = async (event, model = ActivityEvent) => {
  const record = buildActivityEventRecord(event);
  if (!record) return false;
  try {
    await model.create(record);
    return true;
  } catch {
    // Event logging must never undo a successful business operation or expose request data.
    console.error('HR activity event could not be recorded.');
    return false;
  }
};
