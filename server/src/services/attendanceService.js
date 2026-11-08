import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import {
  getIndiaDate,
  isLateCheckIn,
  isWorkingDay,
} from '../config/attendanceConfig.js';
import { createHttpError } from './authService.js';

const safeAttendance = (record) => ({
  id: record._id.toString(),
  employeeId: record.employeeId?._id?.toString() ?? record.employeeId?.toString(),
  date: record.date,
  checkIn: record.checkIn,
  checkOut: record.checkOut ?? null,
  isLate: record.isLate,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const pageInfo = (page, limit, total) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

export const checkIn = async ({ employeeId, now = new Date() }) => {
  const date = getIndiaDate(now);
  if (!isWorkingDay(date)) throw createHttpError(400, 'Check-in is not allowed on weekends');

  try {
    const record = await Attendance.create({
      employeeId,
      date,
      checkIn: now,
      isLate: isLateCheckIn(now),
    });
    return safeAttendance(record);
  } catch (error) {
    if (error.code === 11000) throw createHttpError(409, 'Attendance already exists for today');
    throw error;
  }
};

export const checkOut = async ({ employeeId, now = new Date() }) => {
  const date = getIndiaDate(now);
  const existing = await Attendance.findOne({ employeeId, date }).select('_id');
  if (!existing) throw createHttpError(400, 'Check-in is required before check-out');

  const record = await Attendance.findOneAndUpdate(
    { employeeId, date, checkOut: { $exists: false } },
    { $set: { checkOut: now } },
    { new: true, runValidators: true },
  );
  if (!record) throw createHttpError(409, 'Attendance has already been checked out');
  return safeAttendance(record);
};

export const getTodayAttendance = async ({ employeeId, now = new Date() }) => {
  const record = await Attendance.findOne({ employeeId, date: getIndiaDate(now) }).lean();
  return record ? safeAttendance(record) : null;
};

export const getMyAttendance = async ({ employeeId, month, page, limit }) => {
  const filter = { employeeId };
  if (month) {
    const [year, monthNumber] = month.split('-').map(Number);
    const nextMonth = monthNumber === 12
      ? `${year + 1}-01`
      : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
    filter.date = { $gte: `${month}-01`, $lt: `${nextMonth}-01` };
  }

  const [records, total] = await Promise.all([
    Attendance.find(filter)
      .sort({ date: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Attendance.countDocuments(filter),
  ]);

  return {
    attendance: records.map(safeAttendance),
    pagination: pageInfo(page, limit, total),
  };
};

export const getAttendanceForHr = async ({ date, page, limit, now = new Date() }) => {
  const selectedDate = date || getIndiaDate(now);
  const employees = await User.find({ role: 'employee', isActive: true })
    .select('name department email')
    .sort({ name: 1, _id: 1 })
    .lean();
  const employeeIds = employees.map((employee) => employee._id);
  const allRecords = employeeIds.length
    ? await Attendance.find({ date: selectedDate, employeeId: { $in: employeeIds } })
      .populate({ path: 'employeeId', select: 'name department email' })
      .sort({ 'employeeId.name': 1, _id: 1 })
      .lean()
    : [];

  const records = allRecords.slice((page - 1) * limit, page * limit);
  const recordedEmployeeIds = new Set(allRecords.map((record) => record.employeeId._id.toString()));
  const employeesWithoutAttendance = employees
    .filter((employee) => !recordedEmployeeIds.has(employee._id.toString()))
    .map(({ _id, name, department, email }) => ({
      id: _id.toString(), name, department: department || '', email,
    }));

  return {
    date: selectedDate,
    attendance: records.map((record) => ({
      ...safeAttendance(record),
      employee: {
        id: record.employeeId._id.toString(),
        name: record.employeeId.name,
        department: record.employeeId.department || '',
        email: record.employeeId.email,
      },
    })),
    employeesWithoutAttendance,
    summary: {
      totalActiveEmployees: employees.length,
      checkedIn: allRecords.length,
      checkedOut: allRecords.filter((record) => record.checkOut).length,
      noRecord: employeesWithoutAttendance.length,
    },
    pagination: pageInfo(page, limit, allRecords.length),
  };
};
