import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Attendance from '../../src/models/Attendance.js';
import User from '../../src/models/User.js';
import { getIndiaDate, isWorkingDay } from '../../src/config/attendanceConfig.js';
import connectDatabase from '../../src/config/database.js';

const apiBase = (process.env.API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');
const employeePassword = randomUUID();
const accountSuffix = randomUUID();
const createdUserIds = [];
const testEmail = (label) => `attendance-${label}-${accountSuffix}@example.invalid`;
const today = getIndiaDate();
const workingToday = isWorkingDay(today);
const results = [];

const request = async (path, { method = 'GET', token, body, params } = {}) => {
  const url = new URL(`${apiBase}${path}`);
  if (params) Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = {};
  try { data = await response.json(); } catch { /* Keep failure output limited to status. */ }
  return { status: response.status, data };
};

const runCase = async (name, test, { skip = false } = {}) => {
  if (skip) {
    results.push({ name, status: 'SKIP' });
    console.log(`SKIP ${name}`);
    return;
  }
  try {
    await test();
    results.push({ name, status: 'PASS' });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL' });
    console.error(`FAIL ${name}${error.status ? ` (HTTP ${error.status})` : ''}`);
    throw error;
  }
};

const createTestEmployee = async (label) => {
  const user = await User.create({
    name: `Attendance smoke ${label}`,
    email: testEmail(label),
    passwordHash: await bcrypt.hash(employeePassword, 8),
    role: 'employee',
    department: 'Smoke Test',
    isActive: true,
  });
  createdUserIds.push(user._id);
  const login = await request('/auth/login', {
    method: 'POST', body: { email: user.email, password: employeePassword },
  });
  assert.equal(login.status, 200, 'test employee login must succeed');
  return { user, token: login.data.token };
};

let employee;
let noRecordEmployee;
let noCheckInEmployee;
let hrToken;

try {
  if (!process.env.SEED_HR_EMAIL?.trim() || !process.env.SEED_HR_PASSWORD) {
    throw new Error('SEED_HR_EMAIL and SEED_HR_PASSWORD are required to run the attendance smoke test.');
  }
  await connectDatabase();
  await Attendance.init();

  const hrLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: process.env.SEED_HR_EMAIL, password: process.env.SEED_HR_PASSWORD },
  });
  assert.equal(hrLogin.status, 200, 'seeded HR login must succeed');
  hrToken = hrLogin.data.token;

  employee = await createTestEmployee('primary');
  noRecordEmployee = await createTestEmployee('without-record');
  noCheckInEmployee = await createTestEmployee('no-check-in');

  await runCase('Employee check-in returns 201', async () => {
    if (!workingToday) throw Object.assign(new Error('Today is a weekend, so the API correctly rejects check-in.'), { status: 400 });
    const response = await request('/attendance/check-in', { method: 'POST', token: employee.token });
    assert.equal(response.status, 201);
  }, { skip: !workingToday });

  await runCase('Duplicate check-in returns 409', async () => {
    const response = await request('/attendance/check-in', { method: 'POST', token: employee.token });
    assert.equal(response.status, 409);
  }, { skip: !workingToday });

  await runCase('Employee check-out returns 200', async () => {
    const response = await request('/attendance/check-out', { method: 'POST', token: employee.token });
    assert.equal(response.status, 200);
  }, { skip: !workingToday });

  await runCase('Duplicate check-out returns 409', async () => {
    const response = await request('/attendance/check-out', { method: 'POST', token: employee.token });
    assert.equal(response.status, 409);
  }, { skip: !workingToday });

  await runCase('HR check-in is forbidden', async () => {
    const response = await request('/attendance/check-in', { method: 'POST', token: hrToken });
    assert.equal(response.status, 403);
  });

  await runCase('Employee cannot access HR attendance list', async () => {
    const response = await request('/attendance', { token: employee.token });
    assert.equal(response.status, 403);
  });

  await runCase('Unauthenticated attendance request returns 401', async () => {
    const response = await request('/attendance/today');
    assert.equal(response.status, 401);
  });

  await runCase('Employee can retrieve their own attendance', async () => {
    const response = await request('/attendance/mine', { token: employee.token });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.data.attendance));
    assert.ok(response.data.attendance.every((record) => record.employeeId === employee.user._id.toString()));
  });

  await runCase('HR can retrieve attendance for a selected date', async () => {
    const response = await request('/attendance', { token: hrToken, params: { date: today } });
    assert.equal(response.status, 200);
    assert.equal(response.data.date, today);
  });

  await runCase('Invalid date and month filters return 400', async () => {
    const [dateResponse, monthResponse] = await Promise.all([
      request('/attendance', { token: hrToken, params: { date: '2026-02-30' } }),
      request('/attendance/mine', { token: employee.token, params: { month: '2026-13' } }),
    ]);
    assert.equal(dateResponse.status, 400);
    assert.equal(monthResponse.status, 400);
  });

  await runCase('Weekend check-in is rejected', async () => {
    assert.equal(isWorkingDay('2026-11-07'), false);
    if (!workingToday) {
      const response = await request('/attendance/check-in', { method: 'POST', token: employee.token });
      assert.equal(response.status, 400);
    }
  });

  await runCase('Concurrent check-ins cannot create duplicates', async () => {
    if (!workingToday) return;
    const responses = await Promise.all([
      request('/attendance/check-in', { method: 'POST', token: noRecordEmployee.token }),
      request('/attendance/check-in', { method: 'POST', token: noRecordEmployee.token }),
    ]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
  }, { skip: !workingToday });

  await runCase('Check-out without check-in returns 400', async () => {
    const response = await request('/attendance/check-out', { method: 'POST', token: noCheckInEmployee.token });
    assert.equal(response.status, 400);
  });

  await runCase('HR response does not expose passwordHash', async () => {
    const response = await request('/attendance', { token: hrToken, params: { date: today, limit: 100 } });
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(response.data).includes('passwordHash'), false);
  });

  await runCase('Active employee without a record is listed', async () => {
    const response = await request('/attendance', { token: hrToken, params: { date: today, limit: 100 } });
    assert.equal(response.status, 200);
    assert.ok(response.data.employeesWithoutAttendance.some((item) => item.id === noCheckInEmployee.user._id.toString()));
  });

  const failures = results.filter(({ status }) => status === 'FAIL').length;
  const skipped = results.filter(({ status }) => status === 'SKIP').length;
  console.log(`Attendance smoke summary: ${results.length - failures - skipped} passed, ${skipped} skipped, ${failures} failed.`);
} catch (error) {
  console.error(error.message || 'Attendance smoke test failed.');
  process.exitCode = 1;
} finally {
  if (createdUserIds.length > 0) {
    try {
      await Attendance.deleteMany({ employeeId: { $in: createdUserIds } });
      await User.deleteMany({ _id: { $in: createdUserIds } });
    } catch {
      console.error('Attendance smoke cleanup failed for isolated test records.');
      process.exitCode = 1;
    }
  }
  try {
    await mongoose.disconnect();
  } catch {
    console.error('Failed to close the smoke test MongoDB connection cleanly.');
    process.exitCode = 1;
  }
}
