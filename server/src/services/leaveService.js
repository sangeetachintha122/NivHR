import mongoose from 'mongoose';
import { LEAVE_ALLOCATIONS, LEAVE_TYPES } from '../config/leavePolicy.js';
import LeaveBalance from '../models/LeaveBalance.js';
import LeaveRequest from '../models/LeaveRequest.js';

export const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const indiaDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const getIndiaCalendarDate = () => {
  const dateParts = Object.fromEntries(
    indiaDateFormatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
};

const validateObjectId = (id, label) => {
  if (!mongoose.isValidObjectId(id)) {
    throw createHttpError(400, `Invalid ${label}`);
  }
};

const toSafeLeave = (leave) => {
  const populatedEmployee = leave.employeeId && typeof leave.employeeId === 'object'
    ? leave.employeeId
    : null;
  const employeeId = populatedEmployee?._id ?? leave.employeeId;

  return {
    id: leave._id.toString(),
    employeeId: employeeId?.toString(),
    ...(populatedEmployee?.name
      ? {
          employee: {
            id: populatedEmployee._id.toString(),
            name: populatedEmployee.name,
            email: populatedEmployee.email,
          },
        }
      : {}),
    type: leave.type,
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    totalDays: leave.totalDays,
    reason: leave.reason,
    status: leave.status,
    reviewedBy: leave.reviewedBy?.toString(),
    reviewedAt: leave.reviewedAt,
    rejectionReason: leave.rejectionReason,
    createdAt: leave.createdAt,
    updatedAt: leave.updatedAt,
  };
};

const ensureBalance = async (employeeId, type) => {
  try {
    return await LeaveBalance.findOneAndUpdate(
      { employeeId, type },
      {
        $setOnInsert: {
          employeeId,
          type,
          total: LEAVE_ALLOCATIONS[type],
          used: 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existingBalance = await LeaveBalance.findOne({ employeeId, type });
    if (!existingBalance) throw error;
    return existingBalance;
  }
};

const getBalances = async (employeeId) => {
  const records = await Promise.all(
    LEAVE_TYPES.map((type) => ensureBalance(employeeId, type)),
  );

  return records.map((balance) => ({
    type: balance.type,
    total: balance.total,
    used: balance.used,
    available: balance.total - balance.used,
  }));
};

const countWorkingDays = (fromDate, toDate) => {
  let totalDays = 0;
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) totalDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return totalDays;
};

const getPendingDays = async (employeeId, type) => {
  const [result] = await LeaveRequest.aggregate([
    { $match: { employeeId: new mongoose.Types.ObjectId(employeeId), type, status: 'pending' } },
    { $group: { _id: null, totalDays: { $sum: '$totalDays' } } },
  ]);
  return result?.totalDays ?? 0;
};

export const applyForLeave = async ({ employeeId, type, fromDate, toDate, reason }) => {
  const fromDateOnly = fromDate.toISOString().slice(0, 10);
  const toDateOnly = toDate.toISOString().slice(0, 10);
  if (fromDateOnly < getIndiaCalendarDate()) {
    throw createHttpError(400, 'Leave dates cannot be in the past');
  }
  if (toDateOnly < fromDateOnly) {
    throw createHttpError(400, 'toDate must be on or after fromDate');
  }

  const totalDays = countWorkingDays(fromDate, toDate);
  if (totalDays === 0) {
    throw createHttpError(400, 'Leave request must include at least one working day');
  }

  const overlappingLeave = await LeaveRequest.findOne({
    employeeId,
    status: { $in: ['pending', 'approved'] },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  }).select('_id');
  if (overlappingLeave) throw createHttpError(409, 'Leave dates overlap an existing request');

  const balance = await ensureBalance(employeeId, type);
  const pendingDays = await getPendingDays(employeeId, type);
  const availableForNewRequest = balance.total - balance.used - pendingDays;
  if (availableForNewRequest < totalDays) {
    throw createHttpError(409, 'Insufficient available leave balance');
  }

  const leave = await LeaveRequest.create({
    employeeId,
    type,
    fromDate,
    toDate,
    totalDays,
    reason,
    status: 'pending',
  });

  // Notification hook: call the notification service here after it is implemented.
  return toSafeLeave(leave);
};

export const getMyLeaves = async ({ employeeId, status, page, limit }) => {
  const [balances, leaves, total] = await Promise.all([
    getBalances(employeeId),
    LeaveRequest.find({ employeeId, ...(status ? { status } : {}) })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments({ employeeId, ...(status ? { status } : {}) }),
  ]);

  return {
    leaves: leaves.map(toSafeLeave),
    balances,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

export const listAllLeaves = async ({ status, type, employeeId, page, limit }) => {
  const filter = {};
  if (status) filter.status = status;
  if (type) filter.type = type;
  if (employeeId) filter.employeeId = employeeId;

  const [leaves, total] = await Promise.all([
    LeaveRequest.find(filter)
      .populate({ path: 'employeeId', select: 'name email' })
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments(filter),
  ]);

  return {
    leaves: leaves.map(toSafeLeave),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const compensateBalanceIncrement = async ({ leaveId, employeeId, type, totalDays }) => {
  try {
    const balance = await LeaveBalance.findOneAndUpdate(
      { employeeId, type, used: { $gte: totalDays } },
      { $inc: { used: -totalDays } },
      { new: true },
    );
    if (!balance) throw new Error('Balance compensation condition did not match');
  } catch {
    console.error('Leave balance compensation failed; manual balance review is required.', {
      leaveRequestId: leaveId.toString(),
      employeeId: employeeId.toString(),
      type,
      totalDays,
    });
  }
};

export const decideLeave = async ({ leaveId, decision, rejectionReason, reviewedBy }) => {
  validateObjectId(leaveId, 'leave request ID');

  const leave = await LeaveRequest.findById(leaveId);
  if (!leave) throw createHttpError(404, 'Leave request not found');
  if (leave.status !== 'pending') throw createHttpError(409, 'Leave request has already been processed');

  const reviewedAt = new Date();
  if (decision === 'rejected') {
    const rejectedLeave = await LeaveRequest.findOneAndUpdate(
      { _id: leaveId, status: 'pending' },
      { $set: { status: 'rejected', rejectionReason, reviewedBy, reviewedAt } },
      { new: true, runValidators: true },
    );
    if (!rejectedLeave) throw createHttpError(409, 'Leave request has already been processed');

    // Notification hook: call the notification service here after it is implemented.
    return toSafeLeave(rejectedLeave);
  }

  const balance = await ensureBalance(leave.employeeId, leave.type);
  const incrementedBalance = await LeaveBalance.findOneAndUpdate(
    {
      _id: balance._id,
      $expr: {
        $lte: [{ $add: ['$used', leave.totalDays] }, '$total'],
      },
    },
    { $inc: { used: leave.totalDays } },
    { new: true },
  );
  if (!incrementedBalance) {
    throw createHttpError(409, 'Insufficient leave balance to approve this request');
  }

  let approvedLeave;
  try {
    approvedLeave = await LeaveRequest.findOneAndUpdate(
      { _id: leaveId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          reviewedBy,
          reviewedAt,
        },
      },
      { new: true, runValidators: true },
    );
  } catch (error) {
    await compensateBalanceIncrement({
      leaveId,
      employeeId: leave.employeeId,
      type: leave.type,
      totalDays: leave.totalDays,
    });
    throw error;
  }

  if (!approvedLeave) {
    await compensateBalanceIncrement({
      leaveId,
      employeeId: leave.employeeId,
      type: leave.type,
      totalDays: leave.totalDays,
    });
    throw createHttpError(409, 'Leave request has already been processed');
  }

  // Notification hook: call the notification service here after it is implemented.
  return toSafeLeave(approvedLeave);
};

export const getBalancesForEmployee = getBalances;
