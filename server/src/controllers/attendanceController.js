import { z } from 'zod';
import { getIndiaDate } from '../config/attendanceConfig.js';
import {
  checkIn,
  checkOut,
  getAttendanceForHr,
  getMyAttendance,
  getTodayAttendance,
} from '../services/attendanceService.js';
import { createHttpError } from '../services/authService.js';

const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
};

const isValidDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dateSchema = z.string().refine(isValidDate);
const myQuerySchema = z.object({
  month: monthSchema.optional(),
  ...paginationSchema,
}).strict();
const hrQuerySchema = z.object({
  date: dateSchema.optional(),
  ...paginationSchema,
}).strict();

const invalidQuery = () => createHttpError(400, 'Invalid request query');

export const checkInController = async (req, res, next) => {
  try {
    const attendance = await checkIn({ employeeId: req.user.id });
    return res.status(201).json({ attendance });
  } catch (error) {
    return next(error);
  }
};

export const checkOutController = async (req, res, next) => {
  try {
    const attendance = await checkOut({ employeeId: req.user.id });
    return res.status(200).json({ attendance });
  } catch (error) {
    return next(error);
  }
};

export const todayAttendanceController = async (req, res, next) => {
  try {
    const attendance = await getTodayAttendance({ employeeId: req.user.id });
    return res.status(200).json({ date: getIndiaDate(), attendance });
  } catch (error) {
    return next(error);
  }
};

export const myAttendanceController = async (req, res, next) => {
  const parsed = myQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(invalidQuery());
  try {
    const result = await getMyAttendance({ employeeId: req.user.id, ...parsed.data });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const hrAttendanceController = async (req, res, next) => {
  const parsed = hrQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(invalidQuery());
  try {
    const result = await getAttendanceForHr({ ...parsed.data });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};
