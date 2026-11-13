import { z } from 'zod';
import { reviewLeaveRequest } from '../services/leaveReviewService.js';
import { LEAVE_TYPES } from '../config/leavePolicy.js';
import {
  applyForLeave,
  cancelMyLeave,
  createHttpError,
  decideLeave,
  getMyLeaves,
  listAllLeaves,
} from '../services/leaveService.js';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  })
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
};

const applySchema = z
  .object({
    type: z.enum(LEAVE_TYPES),
    fromDate: dateOnlySchema,
    toDate: dateOnlySchema,
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();

const myLeavesQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    ...paginationSchema,
  })
  .strict();

const allLeavesQuerySchema = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    type: z.enum(LEAVE_TYPES).optional(),
    employeeId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
    ...paginationSchema,
  })
  .strict();

const decisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approved'),
    overrideReason: z.string().trim().min(1).max(1000).optional(),
  }).strict(),
  z
    .object({
      decision: z.literal('rejected'),
      rejectionReason: z.string().trim().min(1).max(2000),
    })
    .strict(),
]);

const validationError = () => createHttpError(400, 'Invalid request body or query');

export const applyForLeaveController = async (req, res, next) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return next(validationError());

  try {
    const leave = await applyForLeave({ employeeId: req.user.id, department: req.currentUser.department, ...parsed.data });
    return res.status(201).json({ leave });
  } catch (error) {
    return next(error);
  }
};

export const getMyLeavesController = async (req, res, next) => {
  const parsed = myLeavesQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(validationError());

  try {
    const result = await getMyLeaves({ employeeId: req.user.id, ...parsed.data });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const cancelMyLeaveController = async (req, res, next) => {
  try {
    const leave = await cancelMyLeave({ leaveId: req.params.id, employeeId: req.user.id, department: req.currentUser.department });
    return res.status(200).json({ leave });
  } catch (error) {
    return next(error);
  }
};

export const listAllLeavesController = async (req, res, next) => {
  const parsed = allLeavesQuerySchema.safeParse(req.query);
  if (!parsed.success) return next(validationError());

  try {
    const result = await listAllLeaves(parsed.data);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const decideLeaveController = async (req, res, next) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return next(validationError());

  try {
    const leave = await decideLeave({
      leaveId: req.params.id,
      reviewedBy: req.user.id,
      ...parsed.data,
    });
    return res.status(200).json({ leave });
  } catch (error) {
    return next(error);
  }
};

export const reviewLeaveController = async (req, res, next) => {
  try {
    const analysis = await reviewLeaveRequest({ leaveId: req.params.id, reviewerId: req.user.id });
    return res.status(200).json({ analysis });
  } catch (error) {
    return next(error);
  }
};
