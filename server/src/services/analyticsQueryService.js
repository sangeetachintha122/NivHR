import Attendance from '../models/Attendance.js';
import ActivityEvent from '../models/ActivityEvent.js';
import LeaveBalance from '../models/LeaveBalance.js';
import LeaveRequest from '../models/LeaveRequest.js';
import User from '../models/User.js';
import { LEAVE_TYPES } from '../config/leavePolicy.js';
import { getIndiaDate, isWorkingDay } from '../config/attendanceConfig.js';
import { calculateDepartmentCapacity, getCapacitySettings } from './capacityService.js';
import { resolveDateRange, formatDateRange } from './analyticsPlanService.js';

const MAX_ANALYTICS_RECORDS = 5000;
const MAX_CAPACITY_DAYS = 31;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const EMPLOYEE_SELECT = 'name email department joinDate isActive role';
const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];

export class AnalyticsClarificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalyticsClarificationError';
  }
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactDepartmentRegex = (value) => new RegExp(`^\\s*${escapeRegex(value.trim())}\\s*$`, 'i');
const substringRegex = (value) => new RegExp(escapeRegex(value.trim()), 'i');
const asDateOnly = (value) => new Date(`${value}T00:00:00.000Z`);
const addOneDay = (value) => {
  const date = asDateOnly(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
};
const toDateOnly = (date) => date.toISOString().slice(0, 10);
const formatTimestampIST = (value) => value
  ? new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(value))
  : 'Not recorded';
const nonEmpty = (value) => typeof value === 'string' && value.trim() !== '';

const makeResult = ({ capability, title, summary, columns, rows, chartType = 'none', chartData = [], groups = [] }) => ({
  capability,
  title,
  summary,
  table: { columns, rows },
  chart: { type: chartType, data: chartData },
  groups,
});

const ensureBounded = (records, label) => {
  if (records.length > MAX_ANALYTICS_RECORDS) {
    throw new AnalyticsClarificationError(`This ${label} query matched more than ${MAX_ANALYTICS_RECORDS} records. Please narrow the date range or filters.`);
  }
  return records;
};

const employeeFilter = (filters = {}) => {
  const query = { role: 'employee' };
  if (filters.department) query.department = exactDepartmentRegex(filters.department);
  if (filters.status === 'active') query.isActive = { $ne: false };
  if (filters.status === 'inactive') query.isActive = false;
  if (filters.employee) {
    const pattern = substringRegex(filters.employee);
    query.$or = [{ name: pattern }, { email: pattern }];
  }
  return query;
};

const dateOnlyRangeFilter = (field, range) => range
  ? { [field]: { $gte: asDateOnly(range.from), $lt: addOneDay(range.to) } }
  : {};

export const toIstInstantRange = (range) => range
  ? {
      $gte: new Date(asDateOnly(range.from).getTime() - IST_OFFSET_MS),
      $lt: new Date(addOneDay(range.to).getTime() - IST_OFFSET_MS),
    }
  : {};

const leaveOverlapFilter = (range) => range
  ? { fromDate: { $lt: addOneDay(range.to) }, toDate: { $gte: asDateOnly(range.from) } }
  : {};

const attendanceFilter = (range, filters = {}) => ({
  ...(range ? { date: { $gte: range.from, $lte: range.to } } : {}),
  ...(filters.employeeIds !== undefined ? { employeeId: { $in: filters.employeeIds } } : {}),
});

const resolveEmployee = async (name) => {
  if (!nonEmpty(name)) return null;
  const matches = await User.find({ role: 'employee', ...employeeFilter({ employee: name }) })
    .select(EMPLOYEE_SELECT)
    .sort({ name: 1, _id: 1 })
    .limit(6)
    .lean();
  if (matches.length > 1) {
    const candidateNames = matches.slice(0, 5).map((item) => `${item.name}${item.department ? ` (${item.department})` : ''}`);
    throw new AnalyticsClarificationError(`I found more than one matching employee: ${candidateNames.join(', ')}. Which one do you mean?`);
  }
  return matches[0] || null;
};

const getEmployeeIds = async (filters = {}) => {
  if (!filters.employee) return undefined;
  const employee = await resolveEmployee(filters.employee);
  return employee ? [employee._id] : [];
};

const getAttendanceEmployeeIds = async (filters = {}) => {
  let employeeIds;
  if (filters.employee) employeeIds = await getEmployeeIds(filters);
  if (filters.department) {
    const departmentEmployees = await User.find({
      role: 'employee',
      department: exactDepartmentRegex(filters.department),
    }).select('_id').lean();
    const departmentIds = departmentEmployees.map(({ _id }) => _id);
    employeeIds = employeeIds === undefined
      ? departmentIds
      : employeeIds.filter((id) => departmentIds.some((departmentId) => departmentId.equals(id)));
  }
  return employeeIds;
};

const getEmployeeRows = async ({ filters = {}, range, limit = 20, joined = false }) => {
  const query = employeeFilter(filters);
  if (joined && range) Object.assign(query, dateOnlyRangeFilter('joinDate', range));
  else if (range) Object.assign(query, dateOnlyRangeFilter('joinDate', range));
  const [total, records] = await Promise.all([
    User.countDocuments(query),
    User.find(query).select(EMPLOYEE_SELECT).sort({ name: 1, _id: 1 }).limit(limit).lean(),
  ]);
  const rows = records.map((item) => [
    item.name,
    item.email,
    item.department?.trim() || 'Unassigned',
    item.isActive === false ? 'Inactive' : 'Active',
    item.joinDate ? toDateOnly(item.joinDate) : 'Not recorded',
  ]);
  return { total, records, rows };
};

const queryAttendance = async ({ range, filters = {}, lateOnly = false, incompleteOnly = false, limit = MAX_ANALYTICS_RECORDS }) => {
  const employeeIds = await getAttendanceEmployeeIds(filters);
  const filter = attendanceFilter(range, { employeeIds });
  if (lateOnly) filter.isLate = true;
  if (incompleteOnly) filter.$or = [{ checkOut: { $exists: false } }, { checkOut: null }];
  let query = Attendance.find(filter)
    .populate({ path: 'employeeId', select: EMPLOYEE_SELECT, match: { role: 'employee' } })
    .sort({ date: 1, checkIn: 1, _id: 1 })
    .limit(Math.min(limit, MAX_ANALYTICS_RECORDS) + 1)
    .lean();
  const records = await query;
  return ensureBounded(records.filter((record) => record.employeeId), 'attendance');
};

const queryLeaves = async ({ range, filters = {}, statuses, limit = MAX_ANALYTICS_RECORDS }) => {
  const filter = {
    ...leaveOverlapFilter(range),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.leaveType ? { type: filters.leaveType } : {}),
  };
  if (statuses) filter.status = { $in: statuses };
  let employeeIds;
  if (filters.employee) employeeIds = await getEmployeeIds(filters);
  if (filters.department) {
    const departmentEmployees = await User.find({ role: 'employee', department: exactDepartmentRegex(filters.department) }).select('_id').lean();
    const departmentIds = departmentEmployees.map(({ _id }) => _id.toString());
    employeeIds = employeeIds === undefined
      ? departmentIds
      : employeeIds.filter((id) => departmentIds.includes(id.toString()));
  }
  if (employeeIds !== undefined) filter.employeeId = { $in: employeeIds };
  const records = await LeaveRequest.find(filter)
    .populate({ path: 'employeeId', select: EMPLOYEE_SELECT })
    .sort({ fromDate: 1, _id: 1 })
    .limit(Math.min(limit, MAX_ANALYTICS_RECORDS) + 1)
    .lean();
  return ensureBounded(records, 'leave');
};

const queryActivityEvents = async ({ range, filters = {}, limit = MAX_ANALYTICS_RECORDS }) => {
  const filter = {
    ...(range ? { occurredAt: toIstInstantRange(range) } : {}),
    ...(filters.eventType ? { eventType: filters.eventType } : {}),
    ...(filters.department ? { department: exactDepartmentRegex(filters.department) } : {}),
  };
  if (filters.employee) {
    const employeeIds = await getEmployeeIds(filters);
    filter.$or = [
      { actorUserId: { $in: employeeIds || [] } },
      { subjectUserId: { $in: employeeIds || [] } },
    ];
  }
  return ensureBounded(await ActivityEvent.find(filter)
    .populate({ path: 'actorUserId', select: 'name role' })
    .populate({ path: 'subjectUserId', select: 'name role' })
    .sort({ occurredAt: -1, _id: -1 })
    .limit(Math.min(limit, MAX_ANALYTICS_RECORDS) + 1)
    .lean(), 'activity event');
};

const countWorkingDays = (from, to) => {
  if (from > to) return 0;
  const cursor = asDateOnly(from);
  const end = asDateOnly(to);
  let days = 0;
  while (cursor <= end) {
    if (isWorkingDay(toDateOnly(cursor))) days += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
};

export const approvedLeaveDaysInRange = (leave, range) => {
  if (!range) return leave.totalDays;
  const from = toDateOnly(leave.fromDate) > range.from ? toDateOnly(leave.fromDate) : range.from;
  const to = toDateOnly(leave.toDate) < range.to ? toDateOnly(leave.toDate) : range.to;
  return countWorkingDays(from, to);
};

const displayEmployee = (employee) => employee?.name || 'Unknown employee';
const departmentName = (employee) => employee?.department?.trim() || 'Unassigned';
const groupBy = (records, selector) => {
  const result = new Map();
  for (const record of records) {
    const group = selector(record);
    const current = result.get(group.key) || { key: group.key, label: group.label, value: 0 };
    current.value += group.value ?? 1;
    result.set(group.key, current);
  }
  return [...result.values()];
};

const sortedGroups = (groups) => groups.sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));

export const summarizeHighestLateArrivalsByDepartment = (groups) => {
  const highestCount = Math.max(0, ...groups.map(({ late = 0 }) => late));
  if (highestCount === 0) return 'No late arrivals were recorded.';
  const departments = groups
    .filter(({ late = 0 }) => late === highestCount)
    .map(({ label }) => label)
    .sort((left, right) => left.localeCompare(right));
  const departmentLabel = departments.length > 1 ? 'The departments' : 'The department';
  return `${departmentLabel} ${departments.join(', ')} had the most late arrivals (${highestCount}).`;
};

const executeEmployees = async (operation, range) => {
  const { capability, filters, limit } = operation;
  if (capability === 'employee_count_by_department') {
    const query = employeeFilter({ ...filters, status: 'active' });
    const grouped = await User.aggregate([
      { $match: query },
      { $addFields: { _analyticsDepartment: { $trim: { input: { $ifNull: ['$department', ''] } } } } },
      { $group: { _id: { $cond: [{ $eq: ['$_analyticsDepartment', ''] }, 'Unassigned', '$_analyticsDepartment'] }, value: { $sum: 1 } } },
      { $sort: { value: -1, _id: 1 } },
      { $limit: limit },
    ]);
    const groups = grouped.map(({ _id, value }) => ({ key: _id.toLocaleLowerCase('en'), label: _id, value }));
    return makeResult({ capability, title: 'Active Employees by Department', summary: `Found ${groups.reduce((sum, item) => sum + item.value, 0)} active employees across ${groups.length} departments.`, columns: ['Department', 'Employees'], rows: groups.map(({ label, value }) => [label, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'employee_status_summary') {
    const [active, inactive] = await Promise.all([
      User.countDocuments(employeeFilter({ status: 'active' })),
      User.countDocuments(employeeFilter({ status: 'inactive' })),
    ]);
    const groups = [{ key: 'active', label: 'Active', value: active }, { key: 'inactive', label: 'Inactive', value: inactive }];
    return makeResult({ capability, title: 'Employee Status', summary: `${active} active and ${inactive} inactive employees.`, columns: ['Status', 'Employees'], rows: groups.map(({ label, value }) => [label, value]), chartType: 'pie', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  const joined = capability === 'employees_joined';
  const { total, records, rows } = await getEmployeeRows({ filters, range, limit, joined });
  if (capability === 'employee_list') {
    return makeResult({ capability, title: 'Employees', summary: `${total} matching employees; showing ${rows.length}.`, columns: ['Employee', 'Email', 'Department', 'Status', 'Join date'], rows });
  }
  return makeResult({ capability, title: 'Employees Who Joined', summary: `${total} employees have a recorded join date from ${formatDateRange(range)}; showing ${rows.length}.`, columns: ['Employee', 'Email', 'Department', 'Status', 'Join date'], rows });
};

const executeAttendance = async (operation, range) => {
  const { capability, filters, limit } = operation;
  const dateLabel = formatDateRange(range);

  if (capability === 'employee_attendance') {
    const employee = await resolveEmployee(filters.employee);
    if (!employee) return makeResult({ capability, title: 'Employee Attendance', summary: 'No matching employee was found.', columns: ['Date', 'Check-in', 'Check-out', 'Late'], rows: [] });
    const employeeRecords = await Attendance.find({ ...attendanceFilter(range), employeeId: employee._id })
      .sort({ date: 1, _id: 1 }).limit(limit + 1).lean();
    ensureBounded(employeeRecords, 'attendance');
    const rows = employeeRecords.slice(0, limit).map((record) => [record.date, formatTimestampIST(record.checkIn), formatTimestampIST(record.checkOut), record.isLate ? 'Yes' : 'No']);
    return makeResult({ capability, title: `Attendance for ${employee.name}`, summary: `${employeeRecords.length} attendance records for the matched employee from ${dateLabel}; missing checkouts are shown as not recorded.`, columns: ['Date', 'Check-in', 'Check-out', 'Late'], rows });
  }

  const records = await queryAttendance({
    range,
    filters,
    lateOnly: capability === 'late_arrivals',
    incompleteOnly: capability === 'incomplete_checkouts',
    // Summary and grouped analytics must count the full bounded result set;
    // `limit` controls displayed groups/rows, not the underlying calculation.
    limit: MAX_ANALYTICS_RECORDS,
  });

  if (capability === 'attendance_summary') {
    const late = records.filter((record) => record.isLate).length;
    const checkedOut = records.filter((record) => record.checkOut).length;
    const groups = [
      { key: 'check-ins', label: 'Recorded check-ins', value: records.length },
      { key: 'late', label: 'Late arrivals', value: late },
      { key: 'checked-out', label: 'Checked out', value: checkedOut },
      { key: 'incomplete', label: 'Checked in, no checkout', value: records.length - checkedOut },
    ];
    return makeResult({ capability, title: 'Attendance Summary', summary: `${records.length} recorded check-ins from ${dateLabel}; ${late} were late and ${records.length - checkedOut} have no recorded checkout.`, columns: ['Measure', 'Count'], rows: groups.map(({ label, value }) => [label, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'late_arrivals') {
    const groups = sortedGroups(groupBy(records, (record) => ({
      key: record.employeeId._id.toString(),
      label: `${displayEmployee(record.employeeId)} — ${departmentName(record.employeeId)}`,
    }))).slice(0, limit);
    const counts = new Map(groups.map(({ key, value }) => [key, value]));
    const rows = [...new Map(records.map((record) => [record.employeeId._id.toString(), record.employeeId])).values()]
      .filter((employee) => counts.has(employee._id.toString()))
      .map((employee) => [employee.name, departmentName(employee), counts.get(employee._id.toString())])
      .sort((left, right) => right[2] - left[2] || left[0].localeCompare(right[0]))
      .slice(0, limit);
    return makeResult({ capability, title: 'Late Arrivals', summary: `${records.length} late attendance records from ${dateLabel} across ${groups.length} matching employees.`, columns: ['Employee', 'Department', 'Late check-ins'], rows, chartType: 'bar', chartData: rows.map(([label, _department, value]) => ({ label, value })), groups });
  }

  if (capability === 'incomplete_checkouts') {
    const rows = records.slice(0, limit).map((record) => [record.employeeId.name, departmentName(record.employeeId), record.date, formatTimestampIST(record.checkIn)]);
    return makeResult({ capability, title: 'Check-ins Without a Checkout', summary: `${records.length} records have no recorded checkout from ${dateLabel}.`, columns: ['Employee', 'Department', 'Date', 'Check-in'], rows });
  }

  if (capability === 'attendance_by_department') {
    const groupsMap = new Map();
    for (const record of records) {
      const department = departmentName(record.employeeId);
      const entry = groupsMap.get(department) || { key: department.toLocaleLowerCase('en'), label: department, value: 0, late: 0, checkedOut: 0 };
      entry.value += 1;
      if (record.isLate) entry.late += 1;
      if (record.checkOut) entry.checkedOut += 1;
      groupsMap.set(department, entry);
    }
    const allGroups = [...groupsMap.values()];
    const topLateSummary = summarizeHighestLateArrivalsByDepartment(allGroups);
    const groups = sortedGroups(allGroups).slice(0, limit);
    return makeResult({ capability, title: 'Attendance by Department', summary: `Attendance grouped by department from ${dateLabel}. ${topLateSummary}`, columns: ['Department', 'Check-ins', 'Late', 'Checked out'], rows: groups.map(({ label, value, late, checkedOut }) => [label, value, late, checkedOut]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  const byDate = new Map();
  for (const record of records) {
    const entry = byDate.get(record.date) || { key: record.date, label: record.date, value: 0, late: 0 };
    entry.value += 1;
    if (record.isLate) entry.late += 1;
    byDate.set(record.date, entry);
  }
  const groups = [...byDate.values()].sort((left, right) => left.key.localeCompare(right.key)).slice(0, limit);
  return makeResult({ capability, title: 'Attendance Trend', summary: `${records.length} attendance records across ${groups.length} IST calendar dates from ${dateLabel}.`, columns: ['IST date', 'Check-ins', 'Late'], rows: groups.map(({ label, value, late }) => [label, value, late]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
};

const executeLeaves = async (operation, range) => {
  const { capability, filters, limit } = operation;
  const records = await queryLeaves({ range, filters, limit: MAX_ANALYTICS_RECORDS });
  const selected = records.filter((leave) => leave.employeeId && leave.employeeId.role === 'employee');
  const dateLabel = formatDateRange(range);

  if (capability === 'leave_summary' || capability === 'leave_by_status') {
    const groups = LEAVE_STATUSES.map((status) => ({ key: status, label: status, value: selected.filter((leave) => leave.status === status).length }));
    return makeResult({ capability, title: 'Leave Requests by Status', summary: `${selected.length} requests overlap ${dateLabel}: ${groups.map(({ label, value }) => `${value} ${label}`).join(', ')}.`, columns: ['Status', 'Requests'], rows: groups.map(({ label, value }) => [label, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'approved_leave_by_type') {
    const approved = selected.filter((leave) => leave.status === 'approved');
    const groups = LEAVE_TYPES.map((type) => {
      const matches = approved.filter((leave) => leave.type === type);
      return { key: type, label: type, value: matches.reduce((sum, leave) => sum + approvedLeaveDaysInRange(leave, range), 0), requests: matches.length };
    });
    return makeResult({ capability, title: 'Approved Leave by Type', summary: `${approved.length} approved requests overlap ${dateLabel}; ${groups.reduce((sum, group) => sum + group.value, 0)} approved weekdays fall inside the selected range.`, columns: ['Leave type', 'Approved requests', 'Approved days in range'], rows: groups.map(({ label, requests, value }) => [label, requests, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'leave_usage_by_employee') {
    const approved = selected.filter((leave) => leave.status === 'approved');
    const groupsMap = new Map();
    for (const leave of approved) {
      const employee = leave.employeeId;
      const key = employee._id.toString();
      const entry = groupsMap.get(key) || { key, label: `${employee.name} — ${departmentName(employee)}`, value: 0, name: employee.name, department: departmentName(employee) };
      entry.value += approvedLeaveDaysInRange(leave, range);
      groupsMap.set(key, entry);
    }
    const groups = sortedGroups([...groupsMap.values()]).slice(0, limit);
    return makeResult({ capability, title: 'Approved Leave Usage by Employee', summary: `${approved.length} approved leave requests overlap ${dateLabel}; showing the highest approved weekday usage.`, columns: ['Employee', 'Department', 'Approved days'], rows: groups.map(({ name, department, value }) => [name, department, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'leave_by_department') {
    const approved = selected.filter((leave) => leave.status === 'approved');
    const groupsMap = new Map();
    for (const leave of approved) {
      const department = departmentName(leave.employeeId);
      const key = department.toLocaleLowerCase('en');
      const entry = groupsMap.get(key) || { key, label: department, value: 0, requests: 0 };
      entry.value += approvedLeaveDaysInRange(leave, range);
      entry.requests += 1;
      groupsMap.set(key, entry);
    }
    const groups = sortedGroups([...groupsMap.values()]).slice(0, limit);
    return makeResult({ capability, title: 'Approved Leave by Department', summary: `Approved leave grouped by department for ${dateLabel}.`, columns: ['Department', 'Approved requests', 'Approved weekdays'], rows: groups.map(({ label, requests, value }) => [label, requests, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  if (capability === 'current_leave_balances') {
    const balanceFilter = {};
    if (filters.leaveType) balanceFilter.type = filters.leaveType;
    if (filters.employee) {
      const employeeIds = await getEmployeeIds(filters);
      balanceFilter.employeeId = { $in: employeeIds || [] };
    }
    if (filters.department) {
      const departmentEmployees = await User.find({ role: 'employee', department: exactDepartmentRegex(filters.department) })
        .select('_id')
        .lean();
      const departmentIds = departmentEmployees.map(({ _id }) => _id);
      balanceFilter.employeeId = balanceFilter.employeeId
        ? { $in: balanceFilter.employeeId.$in.filter((id) => departmentIds.some((departmentId) => departmentId.equals(id))) }
        : { $in: departmentIds };
    }
    const balances = ensureBounded(await LeaveBalance.find(balanceFilter)
      .populate({ path: 'employeeId', select: EMPLOYEE_SELECT })
      .sort({ employeeId: 1, type: 1 })
      .limit(MAX_ANALYTICS_RECORDS + 1)
      .lean(), 'leave balance');
    const validBalances = balances.filter((balance) => balance.employeeId?.role === 'employee').slice(0, limit);
    const pending = await LeaveRequest.aggregate([
      { $match: { status: 'pending', employeeId: { $in: validBalances.map(({ employeeId }) => employeeId._id) } } },
      { $group: { _id: { employeeId: '$employeeId', type: '$type' }, days: { $sum: '$totalDays' } } },
    ]);
    const pendingMap = new Map(pending.map(({ _id, days }) => [`${_id.employeeId}:${_id.type}`, days]));
    const rows = validBalances.map((balance) => {
      const reserved = pendingMap.get(`${balance.employeeId._id}:${balance.type}`) || 0;
      return [balance.employeeId.name, departmentName(balance.employeeId), balance.type, balance.total, balance.used, reserved, Math.max(0, balance.total - balance.used - reserved)];
    });
    return makeResult({ capability, title: 'Current Leave Balances', summary: `Current balance snapshot for ${rows.length} employee/type combinations. Pending requests are shown as provisional reservations.`, columns: ['Employee', 'Department', 'Type', 'Total', 'Used', 'Pending reserved', 'Available after pending'], rows });
  }

  const pairs = [];
  const approved = selected.filter((leave) => leave.status === 'approved');
  for (let leftIndex = 0; leftIndex < approved.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < approved.length; rightIndex += 1) {
      const left = approved[leftIndex];
      const right = approved[rightIndex];
      if (left.employeeId._id.equals(right.employeeId._id)) continue;
      if (departmentName(left.employeeId) !== departmentName(right.employeeId)) continue;
      const overlapFrom = toDateOnly(left.fromDate) > toDateOnly(right.fromDate) ? left.fromDate : right.fromDate;
      const overlapTo = toDateOnly(left.toDate) < toDateOnly(right.toDate) ? left.toDate : right.toDate;
      if (overlapFrom <= overlapTo) pairs.push([displayEmployee(left.employeeId), displayEmployee(right.employeeId), departmentName(left.employeeId), toDateOnly(overlapFrom), toDateOnly(overlapTo)]);
    }
  }
  return makeResult({ capability, title: 'Overlapping Approved Leave in Same Department', summary: `${pairs.length} overlapping pairs of approved leave requests in the same department during ${dateLabel}.`, columns: ['Employee 1', 'Employee 2', 'Department', 'Overlap from', 'Overlap through'], rows: pairs.slice(0, limit) });
};

const executeCapacity = async (operation, range, now) => {
  const selectedRange = range || { from: getIndiaDate(now), to: getIndiaDate(now) };
  const fromDate = asDateOnly(selectedRange.from);
  const toDate = asDateOnly(selectedRange.to);
  const calendarDays = Math.floor((toDate - fromDate) / 86400000) + 1;
  if (calendarDays > MAX_CAPACITY_DAYS) {
    throw new AnalyticsClarificationError(`Department capacity can be compared over at most ${MAX_CAPACITY_DAYS} calendar days at once. Please narrow the range.`);
  }
  const { departments } = await getCapacitySettings();
  const filtered = departments.filter((item) => !operation.filters.department || exactDepartmentRegex(operation.filters.department).test(item.department));
  const results = await Promise.all(filtered.slice(0, operation.limit).map(async (item) => {
    if (!item.configured) return { ...item, days: [] };
    const capacity = await calculateDepartmentCapacity({ department: item.department, fromDate, toDate });
    return { ...item, days: capacity.days };
  }));
  const groups = results.map((item) => {
    const peakApproved = Math.max(0, ...item.days.map((day) => day.approved));
    const peakPending = Math.max(0, ...item.days.map((day) => day.pending));
    const remaining = item.configured ? Math.max(0, item.maxSimultaneousAbsent - peakApproved) : null;
    return { key: item.department.toLocaleLowerCase('en'), label: item.department, value: peakApproved, activeHeadcount: item.activeHeadcount, capacity: item.maxSimultaneousAbsent, peakPending, remaining, configured: item.configured };
  });
  const rows = results.flatMap((item) => item.days.length
    ? item.days.map((day) => [item.department, day.date, item.activeHeadcount, item.maxSimultaneousAbsent ?? 'Not configured', day.approved, day.pending, day.remaining ?? 'Not configured', day.exceeded ? 'Yes' : 'No'])
    : [[item.department, selectedRange.from, item.activeHeadcount, item.maxSimultaneousAbsent ?? 'Not configured', 0, 0, item.maxSimultaneousAbsent ?? 'Not configured', 'No working day in range']]);
  return makeResult({ capability: operation.capability, title: 'Department Leave Capacity', summary: `Configured capacity and approved/pending leave reservations from ${formatDateRange(selectedRange)}. “Remaining” follows the existing capacity service calculation; pending requests are displayed separately.`, columns: ['Department', 'IST date', 'Active headcount', 'Limit', 'Approved', 'Pending', 'Remaining after approved', 'Would exceed with one more'], rows, chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
};

const executeActivity = async (operation, range) => {
  const { capability, filters, limit } = operation;
  const types = capability === 'login_activity_summary'
    ? ['login_success', 'login_failed', 'login_rate_limited', 'logout']
    : null;
  const records = await queryActivityEvents({
    range,
    filters,
    limit: MAX_ANALYTICS_RECORDS,
  });
  const selected = types ? records.filter((record) => types.includes(record.eventType)) : records;
  const dateLabel = formatDateRange(range);

  if (capability === 'activity_summary' || capability === 'login_activity_summary') {
    const groupsMap = new Map();
    for (const event of selected) {
      const key = event.eventType;
      groupsMap.set(key, (groupsMap.get(key) || 0) + 1);
    }
    const groups = (types || [...groupsMap.keys()])
      .map((type) => ({ key: type, label: type.replaceAll('_', ' '), value: groupsMap.get(type) || 0 }));
    const orderedGroups = capability === 'login_activity_summary'
      ? ['login_success', 'login_failed', 'login_rate_limited', 'logout'].map((type) => ({ key: type, label: type.replaceAll('_', ' '), value: groupsMap.get(type) || 0 }))
      : sortedGroups(groups);
    return makeResult({
      capability,
      title: capability === 'login_activity_summary' ? 'Login Activity' : 'Recorded HR Activity',
      summary: `Showing only stored event records from ${dateLabel}. Records from before event tracking began are unavailable; failed login events are anonymous.`,
      columns: ['Event', 'Recorded events'],
      rows: orderedGroups.map(({ label, value }) => [label, value]),
      chartType: 'bar',
      chartData: orderedGroups.map(({ label, value }) => ({ label, value })),
      groups: orderedGroups,
    });
  }

  if (capability === 'activity_by_actor') {
    const groupsMap = new Map();
    for (const event of selected) {
      const actor = event.actorUserId;
      const key = actor?._id?.toString() || 'unknown';
      const label = actor?.role === 'hr' ? actor.name : actor?.role === 'employee' ? actor.name : 'Unknown / unauthenticated';
      const entry = groupsMap.get(key) || { key, label, value: 0 };
      entry.value += 1;
      groupsMap.set(key, entry);
    }
    const groups = sortedGroups([...groupsMap.values()]).slice(0, limit);
    return makeResult({ capability, title: 'Activity by Actor', summary: `Recorded events grouped by actor from ${dateLabel}. Failed login attempts are included only in the anonymous group.`, columns: ['Actor', 'Events'], rows: groups.map(({ label, value }) => [label, value]), chartType: 'bar', chartData: groups.map(({ label, value }) => ({ label, value })), groups });
  }

  const visibleEvents = selected.slice(0, limit);
  const rows = visibleEvents.map((event) => [
    formatTimestampIST(event.occurredAt),
    event.eventType.replaceAll('_', ' '),
    event.actorUserId?.name || 'Unknown / unauthenticated',
    event.subjectUserId?.name || '—',
    event.department || 'Not recorded',
    event.leaveType || '—',
    (event.changedFields || []).join(', ') || '—',
  ]);
  const result = makeResult({
    capability,
    title: 'Recorded HR Activity',
    summary: `${selected.length} stored events from ${dateLabel}; only event metadata and changed field names are shown. Earlier events were not recorded.`,
    columns: ['Time (IST)', 'Event', 'Actor', 'Subject', 'Department', 'Leave type', 'Changed fields'],
    rows,
  });
  return {
    ...result,
    _activityMetadata: {
      totalCount: selected.length,
      rowSortKeys: visibleEvents.map((event) => ({
        occurredAt: new Date(event.occurredAt).getTime(),
        id: event._id.toString(),
      })),
    },
  };
};

const executeSingleCapability = async (operation, range, now) => {
  const cap = operation.capability;
  if (['activity_summary', 'login_activity_summary', 'activity_by_actor', 'hr_activity'].includes(cap)) {
    return executeActivity(operation, range);
  }
  if (cap.startsWith('employee_') || cap.startsWith('employees_')) return executeEmployees(operation, range);
  if (cap.startsWith('attendance_') || cap === 'late_arrivals' || cap === 'incomplete_checkouts') return executeAttendance(operation, range);
  if (cap.startsWith('leave_') || cap === 'approved_leave_by_type' || cap === 'current_leave_balances' || cap === 'overlapping_approved_leaves') return executeLeaves(operation, range);
  if (cap === 'department_capacity') return executeCapacity(operation, range, now);
  throw new AnalyticsClarificationError('This analytics operation is not available.');
};

const mergeComparison = (primary, comparison, primaryRange, comparisonRange) => {
  if (!primary.groups || !comparison.groups) throw new AnalyticsClarificationError('This result cannot be compared in a grouped table.');
  const byKey = new Map();
  for (const group of primary.groups) byKey.set(group.key, { label: group.label, primary: group.value, comparison: 0 });
  for (const group of comparison.groups) {
    const value = byKey.get(group.key) || { label: group.label, primary: 0, comparison: 0 };
    value.comparison = group.value;
    byKey.set(group.key, value);
  }
  const rows = [...byKey.values()].map(({ label, primary: current, comparison: prior }) => [label, current, prior, current - prior]);
  return makeResult({
    capability: primary.capability,
    title: `${primary.title}: period comparison`,
    summary: `Compared ${formatDateRange(primaryRange)} with ${formatDateRange(comparisonRange)}. Difference is primary minus comparison.`,
    columns: ['Group', `${primaryRange.from} to ${primaryRange.to}`, `${comparisonRange.from} to ${comparisonRange.to}`, 'Difference'],
    rows,
    chartType: 'bar',
    chartData: rows.map(([label, value]) => ({ label, value })),
    groups: rows.map(([label, value]) => ({ key: String(label).toLocaleLowerCase('en'), label, value })),
  });
};

export const combineGroupedResults = (results, combineBy) => {
  if (!combineBy || results.length < 2) return null;
  const byKey = new Map();
  for (const result of results) {
    for (const group of result.groups || []) {
      const entry = byKey.get(group.key) || { label: group.label, values: Array(results.length).fill(0) };
      entry.values[results.indexOf(result)] = group.value;
      byKey.set(group.key, entry);
    }
  }
  const rows = [...byKey.values()].map(({ label, values }) => [label, ...values]);
  return makeResult({
    capability: 'cross_module_comparison',
    title: `Cross-module comparison by ${combineBy}`,
    summary: `Values from ${results.map((result) => result.title).join('; ')} are grouped by the same ${combineBy}.`,
    columns: [combineBy === 'department' ? 'Department' : 'Employee', ...results.map(({ title }) => title)],
    rows,
    chartType: 'bar',
    chartData: rows.map((row) => ({ label: row[0], value: row[1] })),
  });
};

export const combineEmployeeRecordActivityResults = (operations, results, now = new Date()) => {
  if (operations.length !== 2 || results.length !== 2) return results;

  const createdIndex = operations.findIndex(({ capability, filters, compareRange }) =>
    capability === 'hr_activity' && !compareRange
    && filters.eventType === 'employee_created' && Object.keys(filters).length === 1);
  const updatedIndex = operations.findIndex(({ capability, filters, compareRange }) =>
    capability === 'hr_activity' && !compareRange
    && filters.eventType === 'employee_updated' && Object.keys(filters).length === 1);
  if (createdIndex < 0 || updatedIndex < 0
    || JSON.stringify(operations[createdIndex].range) !== JSON.stringify(operations[updatedIndex].range)) return results;

  const created = results[createdIndex];
  const updated = results[updatedIndex];
  if (!created?._activityMetadata || !updated?._activityMetadata
    || created.capability !== 'hr_activity' || updated.capability !== 'hr_activity'
    || JSON.stringify(created.table?.columns) !== JSON.stringify(updated.table?.columns)) return results;

  const rows = [
    ...created.table.rows.map((row, index) => ({ row, ...created._activityMetadata.rowSortKeys[index] })),
    ...updated.table.rows.map((row, index) => ({ row, ...updated._activityMetadata.rowSortKeys[index] })),
  ].sort((left, right) => right.occurredAt - left.occurredAt || right.id.localeCompare(left.id));
  const totalCreated = created._activityMetadata.totalCount;
  const totalUpdated = updated._activityMetadata.totalCount;
  const range = resolveDateRange(operations[createdIndex].range, now);
  const limit = Math.min(operations[createdIndex].limit, operations[updatedIndex].limit);
  const combined = makeResult({
    capability: 'hr_activity',
    title: 'Recorded HR Activity',
    summary: `${totalCreated + totalUpdated} total events found from ${formatDateRange(range)}: ${totalCreated} employee creation events and ${totalUpdated} employee update events.`,
    columns: created.table.columns,
    rows: rows.slice(0, limit).map(({ row }) => row),
  });
  combined.presentation = 'combined_employee_activity';
  if (totalCreated + totalUpdated === 0) {
    combined.table.emptyMessage = 'No employee creation or update activity was recorded during this period.';
  }
  return [combined];
};

export const executeAnalyticsPlan = async (plan, { now = new Date() } = {}) => {
  const results = [];
  for (const operation of plan.operations) {
    const range = resolveDateRange(operation.range, now);
    const result = await executeSingleCapability(operation, range, now);
    if (operation.compareRange) {
      const comparisonRange = resolveDateRange(operation.compareRange, now);
      const comparison = await executeSingleCapability(operation, comparisonRange, now);
      results.push(mergeComparison(result, comparison, range, comparisonRange));
    } else {
      results.push(result);
    }
  }
  const combined = combineGroupedResults(results, plan.combineBy);
  if (combined) return [combined];
  return combineEmployeeRecordActivityResults(plan.operations, results, now);
};
