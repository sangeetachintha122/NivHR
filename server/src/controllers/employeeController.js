import { z } from 'zod';
import {
  createEmployee,
  createHttpError,
  deactivateEmployee,
  getEmployeeById,
  listEmployees,
  updateEmployee,
} from '../services/employeeService.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const dateSchema = z.string().trim().min(1).pipe(z.coerce.date());

const createEmployeeSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    email: emailSchema,
    password: z.string().min(1),
    department: z.string().trim().max(100).optional(),
    joinDate: dateSchema.optional(),
  })
  .strict();

const updateEmployeeSchema = z
  .object({
    name: z.string().trim().min(1).max(150).optional(),
    email: emailSchema.optional(),
    department: z.string().trim().max(100).optional(),
    joinDate: z.union([dateSchema, z.null()]).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'At least one update field is required');

const listEmployeesSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    department: z.string().trim().max(100).optional(),
    isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(10),
  })
  .strict();

const sendValidationError = (next) => next(createHttpError(400, 'Invalid request body or query'));

export const createEmployeeController = async (req, res, next) => {
  const parsed = createEmployeeSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(next);

  try {
    const employee = await createEmployee(parsed.data);
    return res.status(201).json({ employee });
  } catch (error) {
    return next(error);
  }
};

export const listEmployeesController = async (req, res, next) => {
  const parsed = listEmployeesSchema.safeParse(req.query);
  if (!parsed.success) return sendValidationError(next);

  try {
    const result = await listEmployees(parsed.data);
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
};

export const getEmployeeController = async (req, res, next) => {
  try {
    const employee = await getEmployeeById(req.params.id);
    return res.status(200).json({ employee });
  } catch (error) {
    return next(error);
  }
};

export const updateEmployeeController = async (req, res, next) => {
  const parsed = updateEmployeeSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(next);

  try {
    const employee = await updateEmployee(req.params.id, parsed.data);
    return res.status(200).json({ employee });
  } catch (error) {
    return next(error);
  }
};

export const deactivateEmployeeController = async (req, res, next) => {
  try {
    const employee = await deactivateEmployee(req.params.id);
    return res.status(200).json({ employee });
  } catch (error) {
    return next(error);
  }
};
