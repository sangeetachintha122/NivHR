import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../models/User.js';

const safeEmployeeFields = 'name email role department joinDate isActive createdAt updatedAt';

export const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toSafeEmployee = (employee) => ({
  id: employee._id.toString(),
  name: employee.name,
  email: employee.email,
  role: employee.role,
  department: employee.department,
  joinDate: employee.joinDate,
  isActive: employee.isActive ?? true,
  createdAt: employee.createdAt,
  updatedAt: employee.updatedAt,
});

const throwDuplicateEmailError = (error) => {
  if (error.code === 11000) {
    throw createHttpError(409, 'Email address is already in use');
  }
  throw error;
};

const validateEmployeeId = (employeeId) => {
  if (!mongoose.isValidObjectId(employeeId)) {
    throw createHttpError(400, 'Invalid employee ID');
  }
};

const findEmployee = async (employeeId) => {
  const employee = await User.findOne({ _id: employeeId, role: 'employee' })
    .select(safeEmployeeFields);
  if (!employee) throw createHttpError(404, 'Employee not found');
  return employee;
};

export const createEmployee = async ({ name, email, password, department, joinDate }) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (await User.exists({ email: normalizedEmail })) {
    throw createHttpError(409, 'Email address is already in use');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const employee = new User({
    name,
    email: normalizedEmail,
    passwordHash,
    role: 'employee',
    department,
    joinDate,
    isActive: true,
  });

  try {
    await employee.save();
    return toSafeEmployee(employee);
  } catch (error) {
    return throwDuplicateEmailError(error);
  }
};

export const listEmployees = async ({ search, department, isActive, page, limit }) => {
  const filter = { role: 'employee' };

  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchExpression = new RegExp(escapedSearch, 'i');
    filter.$or = [{ name: searchExpression }, { email: searchExpression }];
  }
  if (department) {
    const escapedDepartment = department.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.department = new RegExp(`^${escapedDepartment}$`, 'i');
  }
  if (isActive !== undefined) filter.isActive = isActive;

  const [employees, total] = await Promise.all([
    User.find(filter)
      .select(safeEmployeeFields)
      .sort({ name: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  return {
    employees: employees.map(toSafeEmployee),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getEmployeeById = async (employeeId) => {
  validateEmployeeId(employeeId);
  return toSafeEmployee(await findEmployee(employeeId));
};

export const updateEmployee = async (employeeId, updates) => {
  validateEmployeeId(employeeId);
  await findEmployee(employeeId);

  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.email !== undefined) {
    normalizedUpdates.email = normalizedUpdates.email.trim().toLowerCase();
    const existingEmployee = await User.exists({
      email: normalizedUpdates.email,
      _id: { $ne: employeeId },
    });
    if (existingEmployee) throw createHttpError(409, 'Email address is already in use');
  }

  try {
    const employee = await User.findOneAndUpdate(
      { _id: employeeId, role: 'employee' },
      { $set: normalizedUpdates },
      { new: true, runValidators: true },
    ).select(safeEmployeeFields);
    if (!employee) throw createHttpError(404, 'Employee not found');
    return toSafeEmployee(employee);
  } catch (error) {
    return throwDuplicateEmailError(error);
  }
};

export const deactivateEmployee = async (employeeId) => {
  validateEmployeeId(employeeId);
  const employee = await User.findOneAndUpdate(
    { _id: employeeId, role: 'employee' },
    { $set: { isActive: false } },
    { new: true, runValidators: true },
  ).select(safeEmployeeFields);
  if (!employee) throw createHttpError(404, 'Employee not found');
  return toSafeEmployee(employee);
};
