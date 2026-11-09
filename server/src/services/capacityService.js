import DepartmentCapacity from '../models/DepartmentCapacity.js';
import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import { isWorkingDay } from '../config/attendanceConfig.js';

const normalizeDepartment = (department) => String(department || '').trim();
const normalizeKey = (department) => normalizeDepartment(department).toLocaleLowerCase('en');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const departmentPattern = (department) => new RegExp(`^\\s*${escapeRegex(normalizeDepartment(department))}\\s*$`, 'i');
const asDateString = (date) => new Date(date).toISOString().slice(0, 10);
export const createCapacityError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const getWorkingDates = (fromDate, toDate) => {
  const dates = [];
  const cursor = new Date(`${asDateString(fromDate)}T00:00:00.000Z`);
  const end = new Date(`${asDateString(toDate)}T00:00:00.000Z`);
  for (; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (isWorkingDay(date)) dates.push(date);
  }
  return dates;
};

const findConfiguredCapacity = async (department) => {
  if (!department) return null;
  return DepartmentCapacity.findOne({ department: normalizeDepartment(department) })
    .collation({ locale: 'en', strength: 2 })
    .lean();
};

export const getCapacitySettings = async () => {
  const [employees, configurations] = await Promise.all([
    User.find({ role: 'employee', department: { $type: 'string', $ne: '' } })
      .select('department isActive')
      .lean(),
    DepartmentCapacity.find().sort({ department: 1 }).lean(),
  ]);
  const departments = new Map();

  for (const employee of employees) {
    const department = normalizeDepartment(employee.department);
    const key = normalizeKey(department);
    if (!key) continue;
    const item = departments.get(key) || { department, activeHeadcount: 0, maxSimultaneousAbsent: null, configured: false };
    if (employee.isActive !== false) item.activeHeadcount += 1;
    departments.set(key, item);
  }

  for (const capacity of configurations) {
    const department = normalizeDepartment(capacity.department);
    const key = normalizeKey(department);
    const item = departments.get(key) || { department, activeHeadcount: 0, maxSimultaneousAbsent: null, configured: false };
    item.maxSimultaneousAbsent = capacity.maxSimultaneousAbsent;
    item.configured = true;
    item.updatedAt = capacity.updatedAt;
    departments.set(key, item);
  }

  return {
    departments: [...departments.values()].sort((left, right) => left.department.localeCompare(right.department)),
  };
};

export const updateDepartmentCapacity = async ({ department: departmentInput, maxSimultaneousAbsent, updatedBy }) => {
  const department = normalizeDepartment(departmentInput);
  if (!department) throw createCapacityError(400, 'Department is required');

  const activeHeadcount = await User.countDocuments({
    role: 'employee',
    isActive: { $ne: false },
    department: departmentPattern(department),
  });
  if (maxSimultaneousAbsent > activeHeadcount) {
    throw createCapacityError(400, `Capacity cannot exceed the active department headcount (${activeHeadcount})`);
  }

  try {
    const capacity = await DepartmentCapacity.findOneAndUpdate(
      { department },
      {
        $set: { maxSimultaneousAbsent, updatedBy },
        $setOnInsert: { department },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).collation({ locale: 'en', strength: 2 });
    return {
      department: capacity.department,
      maxSimultaneousAbsent: capacity.maxSimultaneousAbsent,
      activeHeadcount,
      configured: true,
      updatedAt: capacity.updatedAt,
    };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await findConfiguredCapacity(department);
    if (!existing) throw error;
    const capacity = await DepartmentCapacity.findByIdAndUpdate(
      existing._id,
      { $set: { maxSimultaneousAbsent, updatedBy } },
      { new: true, runValidators: true },
    );
    return {
      department: capacity.department,
      maxSimultaneousAbsent: capacity.maxSimultaneousAbsent,
      activeHeadcount,
      configured: true,
      updatedAt: capacity.updatedAt,
    };
  }
};

export const calculateDepartmentCapacity = async ({
  employeeId,
  fromDate,
  toDate,
  department: knownDepartment,
  excludeLeaveId,
}) => {
  const employee = knownDepartment
    ? { department: knownDepartment }
    : await User.findById(employeeId).select('department').lean();
  const department = normalizeDepartment(employee?.department);
  const dates = getWorkingDates(fromDate, toDate);

  if (!department) {
    return {
      configured: false,
      department: null,
      activeHeadcount: 0,
      maxSimultaneousAbsent: null,
      days: dates.map((date) => ({ date, approved: 0, pending: 0, remaining: null, exceeded: false })),
      exceededDates: [],
    };
  }

  const [capacity, activeEmployees] = await Promise.all([
    findConfiguredCapacity(department),
    User.find({ role: 'employee', isActive: { $ne: false }, department: departmentPattern(department) })
      .select('_id')
      .lean(),
  ]);
  const activeEmployeeIds = activeEmployees.map(({ _id }) => _id);
  const activeIdSet = new Set(activeEmployeeIds.map((id) => id.toString()));
  const employeeIdString = employeeId?.toString();
  const days = dates.length
    ? await LeaveRequest.find({
        employeeId: { $in: activeEmployeeIds },
        status: { $in: ['approved', 'pending'] },
        fromDate: { $lte: new Date(`${dates.at(-1)}T00:00:00.000Z`) },
        toDate: { $gte: new Date(`${dates[0]}T00:00:00.000Z`) },
      }).select('_id employeeId status fromDate toDate').lean()
    : [];

  const configured = Boolean(capacity);
  const maxSimultaneousAbsent = capacity?.maxSimultaneousAbsent ?? null;
  const dailyFacts = dates.map((date) => {
    const approvedIds = new Set();
    const pendingIds = new Set();
    for (const leave of days) {
      const userId = leave.employeeId.toString();
      if (!activeIdSet.has(userId) || asDateString(leave.fromDate) > date || asDateString(leave.toDate) < date) continue;
      if (leave.status === 'approved' && userId !== employeeIdString) approvedIds.add(userId);
      if (leave.status === 'pending' && leave._id.toString() !== excludeLeaveId?.toString()) {
        pendingIds.add(userId);
      }
    }
    const approved = approvedIds.size;
    const pending = pendingIds.size;
    return {
      date,
      approved,
      pending,
      remaining: configured ? Math.max(0, maxSimultaneousAbsent - approved) : null,
      exceeded: configured && approved + 1 > maxSimultaneousAbsent,
    };
  });

  return {
    configured,
    department,
    activeHeadcount: activeEmployees.length,
    maxSimultaneousAbsent,
    days: dailyFacts,
    exceededDates: dailyFacts.filter((day) => day.exceeded).map(({ date }) => date),
  };
};
