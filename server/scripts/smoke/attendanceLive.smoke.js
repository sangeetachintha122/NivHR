import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Attendance from '../../src/models/Attendance.js';
import User from '../../src/models/User.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixedIndiaDate = '2026-11-06';
const fixedCheckIn = '2026-11-06T04:00:01.000Z';
const testRunId = randomUUID().replaceAll('-', '');
const databaseName = `nivhr_attendance_test_${testRunId}`;
const testEmail = (role) => `attendance-${role}-${testRunId}@example.invalid`;
const createdUserIds = [];
let testDatabaseConnected = false;
let testServer;

const requireIsolatedMongoUri = () => {
  const configuredUri = process.env.ATTENDANCE_TEST_MONGO_URI;
  if (!configuredUri) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI is required; no application database fallback is allowed.');
  }

  let parsed;
  try {
    parsed = new URL(configuredUri);
  } catch {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must be a valid MongoDB connection URI.');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must use mongodb:// or mongodb+srv://.');
  }

  const configuredDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] || '');
  if (parsed.username && !parsed.searchParams.get('authSource')) {
    parsed.searchParams.set('authSource', configuredDatabase || 'admin');
  }
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

const getFreePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const waitForTestServer = async (child, healthUrl) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('The isolated attendance API server exited before becoming ready.');
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The isolated server may still be connecting to MongoDB.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The isolated attendance API server did not become ready in time.');
};

const stopTestServer = async () => {
  if (!testServer || testServer.exitCode !== null) return;
  const exited = new Promise((resolve) => testServer.once('exit', resolve));
  testServer.kill();
  const timeout = setTimeout(() => testServer.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout);
  testServer = null;
};

const apiRequest = async (baseUrl, pathname, { method = 'GET', token, body } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
};

const createTestUser = async ({ role, name }) => {
  const password = randomUUID();
  const user = await User.create({
    name,
    email: testEmail(role),
    passwordHash: await bcrypt.hash(password, 8),
    role,
    department: 'Attendance API Test',
    isActive: true,
  });
  createdUserIds.push(user._id);
  return { user, password };
};

const assertPass = (label, assertion) => {
  assertion();
  console.log(`PASS ${label}`);
};

try {
  const mongoUri = requireIsolatedMongoUri();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}/api`;
  const jwtSecret = randomUUID() + randomUUID();

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  testDatabaseConnected = true;
  await Promise.all([User.init(), Attendance.init()]);

  const hr = await createTestUser({ role: 'hr', name: 'Attendance Test HR' });
  const employee = await createTestUser({ role: 'employee', name: 'Attendance Test Employee' });
  const concurrentEmployee = await createTestUser({ role: 'employee', name: 'Attendance Concurrent Test' });

  testServer = spawn(
    process.execPath,
    ['--import', pathToFileURL(path.join(serverDirectory, 'scripts/smoke/attendanceFixedClock.js')).href, 'src/server.js'],
    {
      cwd: serverDirectory,
      env: {
        ...process.env,
        MONGO_URI: mongoUri,
        PORT: String(port),
        JWT_SECRET: jwtSecret,
        JWT_EXPIRES_IN: '8h',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  await waitForTestServer(testServer, `${baseUrl}/health`);

  const [hrLogin, employeeLogin, concurrentLogin] = await Promise.all([
    apiRequest(baseUrl, '/auth/login', { method: 'POST', body: { email: hr.user.email, password: hr.password } }),
    apiRequest(baseUrl, '/auth/login', { method: 'POST', body: { email: employee.user.email, password: employee.password } }),
    apiRequest(baseUrl, '/auth/login', { method: 'POST', body: { email: concurrentEmployee.user.email, password: concurrentEmployee.password } }),
  ]);
  assert.equal(hrLogin.status, 200);
  assert.equal(employeeLogin.status, 200);
  assert.equal(concurrentLogin.status, 200);
  const hrToken = hrLogin.data.token;
  const employeeToken = employeeLogin.data.token;
  const concurrentToken = concurrentLogin.data.token;

  const checkIn = await apiRequest(baseUrl, '/attendance/check-in', {
    method: 'POST',
    token: employeeToken,
    body: { now: '2000-01-01T00:00:00.000Z' },
  });
  assert.equal(checkIn.status, 201);
  assert.equal(checkIn.data.attendance.date, fixedIndiaDate);
  assert.equal(checkIn.data.attendance.isLate, true);
  assert.equal(new Date(checkIn.data.attendance.checkIn).toISOString(), fixedCheckIn);
  console.log('PASS Check-in returns 201 with fixed Friday IST date and late status');

  const duplicateCheckIn = await apiRequest(baseUrl, '/attendance/check-in', { method: 'POST', token: employeeToken });
  assert.equal(duplicateCheckIn.status, 409);
  console.log('PASS Duplicate check-in returns 409');

  const checkOut = await apiRequest(baseUrl, '/attendance/check-out', { method: 'POST', token: employeeToken });
  assert.equal(checkOut.status, 200);
  console.log('PASS Check-out returns 200');

  const duplicateCheckOut = await apiRequest(baseUrl, '/attendance/check-out', { method: 'POST', token: employeeToken });
  assert.equal(duplicateCheckOut.status, 409);
  console.log('PASS Duplicate check-out returns 409');

  const simultaneousCheckIns = await Promise.all([
    apiRequest(baseUrl, '/attendance/check-in', { method: 'POST', token: concurrentToken }),
    apiRequest(baseUrl, '/attendance/check-in', { method: 'POST', token: concurrentToken }),
  ]);
  assert.deepEqual(simultaneousCheckIns.map(({ status }) => status).sort(), [201, 409]);
  const concurrentRecordCount = await Attendance.countDocuments({
    employeeId: concurrentEmployee.user._id,
    date: fixedIndiaDate,
  });
  assert.equal(concurrentRecordCount, 1);
  console.log('PASS Concurrent check-in creates exactly one attendance record');

  const hrCheckIn = await apiRequest(baseUrl, '/attendance/check-in', { method: 'POST', token: hrToken });
  assert.equal(hrCheckIn.status, 403);
  console.log('PASS HR cannot check in');

  const employeeHrList = await apiRequest(baseUrl, '/attendance', { token: employeeToken });
  assert.equal(employeeHrList.status, 403);
  console.log('PASS Employee cannot access the HR attendance list');

  const employeeRecordCount = await Attendance.countDocuments({
    employeeId: employee.user._id,
    date: fixedIndiaDate,
  });
  assertPass('Test attendance records use the fixed Friday IST date', () => {
    assert.equal(employeeRecordCount, 1);
  });
} catch (error) {
  const safeSetupMessages = new Set([
    'ATTENDANCE_TEST_MONGO_URI is required; no application database fallback is allowed.',
    'ATTENDANCE_TEST_MONGO_URI must be a valid MongoDB connection URI.',
    'ATTENDANCE_TEST_MONGO_URI must use mongodb:// or mongodb+srv://.',
  ]);
  if (error instanceof assert.AssertionError || safeSetupMessages.has(error?.message)) {
    console.error(error.message);
  } else {
    console.error(`Isolated attendance API verification failed (${error?.name || 'Error'}).`);
  }
  process.exitCode = 1;
} finally {
  try {
    await stopTestServer();
  } catch {
    console.error('Failed to stop the isolated attendance API server cleanly.');
    process.exitCode = 1;
  }
  if (testDatabaseConnected) {
    try {
      if (createdUserIds.length) {
        await Attendance.deleteMany({ employeeId: { $in: createdUserIds } });
        await User.deleteMany({ _id: { $in: createdUserIds } });
      }
    } catch {
      console.error('Cleanup of temporary attendance test accounts failed.');
      process.exitCode = 1;
    }
    try {
      await mongoose.connection.dropDatabase();
    } catch {
      console.error('Cleanup of the isolated attendance test database failed.');
      process.exitCode = 1;
    }
  }
  try {
    await mongoose.disconnect();
  } catch {
    console.error('Failed to close the isolated attendance test database connection.');
    process.exitCode = 1;
  }
}
