import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import AuditLog from '../../src/models/AuditLog.js';
import LeaveBalance from '../../src/models/LeaveBalance.js';
import LeaveRequest from '../../src/models/LeaveRequest.js';
import User from '../../src/models/User.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverDirectory, '.env'), override: true });
const runId = randomUUID().replaceAll('-', '');
const testPassword = randomUUID();
const employeeEmail = `leave-review-employee-${runId}@example.invalid`;
const hrEmail = `leave-review-hr-${runId}@example.invalid`;
const getFutureWeekdayDates = (count) => {
  const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  const cursor = new Date(`${todayParts.year}-${todayParts.month}-${todayParts.day}T00:00:00.000Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 30);
  const dates = [];
  while (dates.length < count) {
    if (cursor.getUTCDay() !== 0 && cursor.getUTCDay() !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};
const createdUserIds = [];
const createdDocumentIds = {
  users: [],
  leaveRequests: [],
  leaveBalances: [],
  auditLogs: [],
};
const results = [];
let testDatabaseConnected = false;
let testServer;
let baseUrl;
let hrToken;
let employeeToken;
let pending;
let approved;
let rejected;
let beforeBalance;

const run = async (label, operation) => {
  try {
    await operation();
    console.log(`PASS ${label}`);
    results.push(true);
  } catch (error) {
    console.log(`FAIL ${label}: ${error.message}`);
    results.push(false);
  }
};

const parseMongoUri = (value, variableName) => {
  if (!value) throw new Error(`${variableName} is required.`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid MongoDB connection URI.`);
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error(`${variableName} must use mongodb:// or mongodb+srv://.`);
  }
  return parsed;
};

const canonicalUri = (uri) => {
  const normalized = new URL(uri.href);
  normalized.searchParams.sort();
  return normalized.href;
};

const getIsolatedMongoUri = () => {
  const testUri = parseMongoUri(process.env.ATTENDANCE_TEST_MONGO_URI, 'ATTENDANCE_TEST_MONGO_URI');
  const productionUri = parseMongoUri(process.env.MONGO_URI, 'MONGO_URI');
  let testDatabase;
  try {
    testDatabase = decodeURIComponent(testUri.pathname.slice(1));
  } catch {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must select the nivhr_test database.');
  }
  if (testDatabase !== 'nivhr_test') {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must select exactly the nivhr_test database.');
  }
  const authSources = [...testUri.searchParams.entries()]
    .filter(([name]) => name.toLowerCase() === 'authsource');
  if (authSources.length !== 1 || authSources[0][1] !== 'admin') {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must include exactly one authSource=admin option.');
  }
  const databaseOverrides = testUri.searchParams.getAll('dbName');
  if (databaseOverrides.some((database) => database !== 'nivhr_test')) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must select exactly the nivhr_test database.');
  }
  if (canonicalUri(testUri) === canonicalUri(productionUri)) {
    throw new Error('ATTENDANCE_TEST_MONGO_URI must be different from MONGO_URI.');
  }
  return testUri.href;
};

const trackIds = (collection, documents) => {
  for (const document of documents) {
    if (document?._id && !createdDocumentIds[collection].some((id) => id.equals(document._id))) {
      createdDocumentIds[collection].push(document._id);
    }
  }
};

const settleCreatedRecords = async (operations) => {
  const settled = await Promise.allSettled(operations);
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return settled.map((result) => result.value);
};

const captureApiCreatedIds = async () => {
  const queries = await Promise.allSettled([
    createdUserIds.length
      ? LeaveBalance.find({ employeeId: { $in: createdUserIds } }).select('_id').lean()
      : [],
    createdUserIds.length ? AuditLog.find({ userId: { $in: createdUserIds } }).select('_id').lean() : [],
  ]);
  if (queries[0].status === 'fulfilled') trackIds('leaveBalances', queries[0].value);
  if (queries[1].status === 'fulfilled') trackIds('auditLogs', queries[1].value);
  if (queries.some((query) => query.status === 'rejected')) throw new Error('Unable to inspect all API-created fixture documents.');
};

const getFreePort = async () => {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
};

const waitForServer = async () => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (testServer.exitCode !== null) throw new Error('The isolated leave-review API server exited before becoming ready.');
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The test server may still be connecting to MongoDB.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The isolated leave-review API server did not become ready in time.');
};

const stopServer = async () => {
  if (!testServer || testServer.exitCode !== null) return;
  const exited = new Promise((resolve) => testServer.once('exit', resolve));
  testServer.kill();
  const timeout = setTimeout(() => testServer.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timeout);
  testServer = null;
};

const request = async (pathname, token, options = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { ...(options.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { response, body: await response.json().catch(() => null) };
};

const login = async (email, password) => {
  const { response, body } = await request('/api/auth/login', null, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok || !body?.token) throw new Error(`Login failed with HTTP ${response.status}`);
  return body.token;
};

const createUser = async ({ email, name, role }) => {
  const user = await User.create({
    name,
    email,
    passwordHash: await bcrypt.hash(testPassword, 8),
    role,
    department: 'Leave Review Smoke Test',
    isActive: true,
  });
  createdUserIds.push(user._id);
  trackIds('users', [user]);
  return user;
};

const createLeave = async ({ employeeId, type, status, date }) => {
  const leave = await LeaveRequest.create({
    employeeId,
    type,
    fromDate: new Date(`${date}T00:00:00.000Z`),
    toDate: new Date(`${date}T00:00:00.000Z`),
    totalDays: 1,
    reason: 'Isolated leave-review smoke fixture',
    status,
  });
  trackIds('leaveRequests', [leave]);
  return leave;
};

const setupIsolatedTestData = async () => {
  const mongoUri = getIsolatedMongoUri();
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  testDatabaseConnected = true;
  await Promise.all([User.init(), LeaveRequest.init(), LeaveBalance.init(), AuditLog.init()]);

  const [hr, employee] = await settleCreatedRecords([
    createUser({ email: hrEmail, name: 'Leave Review Smoke HR', role: 'hr' }),
    createUser({ email: employeeEmail, name: 'Leave Review Smoke Employee', role: 'employee' }),
  ]);
  const [pendingDate, approvedDate, rejectedDate] = getFutureWeekdayDates(3);
  const [pendingFixture, approvedFixture, rejectedFixture] = await settleCreatedRecords([
    createLeave({ employeeId: employee._id, type: 'annual', status: 'pending', date: pendingDate }),
    createLeave({ employeeId: employee._id, type: 'casual', status: 'approved', date: approvedDate }),
    createLeave({ employeeId: employee._id, type: 'sick', status: 'rejected', date: rejectedDate }),
  ]);

  testServer = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(serverDirectory, 'scripts/smoke/capacityMockGemini.js')).href,
      'src/server.js',
    ],
    {
      cwd: serverDirectory,
      env: {
        ...process.env,
        MONGO_URI: mongoUri,
        PORT: String(port),
        JWT_SECRET: randomUUID() + randomUUID(),
        JWT_EXPIRES_IN: '8h',
        GEMINI_API_KEY: 'leave-review-smoke-only',
        GEMINI_EMBED_MODEL: 'leave-review-smoke-embedding',
        GEMINI_TEXT_MODEL: 'leave-review-smoke-text',
        SMTP_HOST: '',
        SMTP_USER: '',
        SMTP_PASS: '',
        SMTP_FROM: '',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );
  await waitForServer();

  [hrToken, employeeToken] = await Promise.all([
    login(hrEmail, testPassword),
    login(employeeEmail, testPassword),
  ]);
  pending = { id: pendingFixture._id.toString(), employeeId: employee._id.toString() };
  approved = { id: approvedFixture._id.toString(), status: 'approved' };
  rejected = { id: rejectedFixture._id.toString(), status: 'rejected' };
};

const cleanup = async () => {
  try {
    await stopServer();
  } catch {
    console.error('Failed to stop the isolated leave-review API server cleanly.');
    process.exitCode = 1;
  }
  if (testDatabaseConnected) {
    try {
      await captureApiCreatedIds();
    } catch {
      console.error('Could not finish tracking leave-review smoke documents for cleanup.');
      process.exitCode = 1;
    }
    for (const [model, ids] of [
      [LeaveRequest, createdDocumentIds.leaveRequests],
      [LeaveBalance, createdDocumentIds.leaveBalances],
      [AuditLog, createdDocumentIds.auditLogs],
      [User, createdDocumentIds.users],
    ]) {
      if (!ids.length) continue;
      try {
        await model.deleteMany({ _id: { $in: ids } });
      } catch {
        console.error(`Cleanup failed for tracked ${model.collection.collectionName} documents.`);
        process.exitCode = 1;
      }
    }
  }
  try {
    await mongoose.disconnect();
  } catch {
    console.error('Failed to close the isolated leave-review test database connection.');
    process.exitCode = 1;
  }
};

try {
  await setupIsolatedTestData();
  console.log('PASS Isolated HR, employee, and leave fixtures created');

  await run('Find smoke leave requests', async () => {
    const { response, body } = await request('/api/leaves?limit=100', hrToken);
    if (!response.ok) throw new Error(`Leave list failed with HTTP ${response.status}`);
    const mine = await request('/api/leaves/mine?limit=100', employeeToken);
    if (!mine.response.ok) throw new Error(`Employee leave list failed with HTTP ${mine.response.status}`);
    const ownPending = mine.body?.leaves?.find((leave) => leave.id === pending.id && leave.status === 'pending');
    const rows = body.leaves || [];
    const approvedRow = rows.find((leave) => leave.id === approved.id && leave.status === 'approved');
    const rejectedRow = rows.find((leave) => leave.id === rejected.id && leave.status === 'rejected');
    if (
      !ownPending || ownPending.employeeId !== pending.employeeId ||
      !approvedRow || approvedRow.employeeId !== pending.employeeId ||
      !rejectedRow || rejectedRow.employeeId !== pending.employeeId
    ) {
      throw new Error('Isolated pending, approved, and rejected fixtures are missing or invalid');
    }
    beforeBalance = mine.body.balances;
  });

  await run('Unauthenticated review returns 401', async () => {
    const { response } = await request('/api/leaves/000000000000000000000000/ai-review', null, { method: 'POST' });
    if (response.status !== 401) throw new Error(`Received HTTP ${response.status}`);
  });
  await run('Employee review returns 403', async () => {
    const { response } = await request(`/api/leaves/${pending.id}/ai-review`, employeeToken, { method: 'POST' });
    if (response.status !== 403) throw new Error(`Received HTTP ${response.status}`);
  });
  await run('Invalid ID returns 400', async () => {
    const { response } = await request('/api/leaves/nope/ai-review', hrToken, { method: 'POST' });
    if (response.status !== 400) throw new Error(`Received HTTP ${response.status}`);
  });
  await run('Missing leave returns 404', async () => {
    const { response } = await request('/api/leaves/000000000000000000000000/ai-review', hrToken, { method: 'POST' });
    if (response.status !== 404) throw new Error(`Received HTTP ${response.status}`);
  });
  for (const [label, leave] of [['Approved leave is refused', approved], ['Rejected leave is refused', rejected]]) {
    await run(label, async () => {
      const { response } = await request(`/api/leaves/${leave.id}/ai-review`, hrToken, { method: 'POST' });
      if (response.status !== 409) throw new Error(`Received HTTP ${response.status}`);
    });
  }
  await run('HR review returns validated advisory analysis without changing leave or balance', async () => {
    const { response, body } = await request(`/api/leaves/${pending.id}/ai-review`, hrToken, { method: 'POST' });
    const analysis = body?.analysis;
    if (!response.ok || !analysis || !['appears_compliant', 'needs_attention', 'insufficient_information'].includes(analysis.recommendation) || !Array.isArray(analysis.policyChecks) || !analysis.disclaimer) {
      throw new Error(`Invalid review response (HTTP ${response.status})`);
    }
    const afterLeave = await request('/api/leaves?status=pending&limit=100', hrToken);
    if (!afterLeave.body?.leaves?.some((leave) => leave.id === pending.id)) throw new Error('Leave status changed');
    const afterMine = await request('/api/leaves/mine?limit=100', employeeToken);
    if (JSON.stringify(afterMine.body?.balances) !== JSON.stringify(beforeBalance)) throw new Error('Leave balance changed');
  });
} catch (error) {
  const safeSetupErrors = new Set([
    'ATTENDANCE_TEST_MONGO_URI is required.',
    'ATTENDANCE_TEST_MONGO_URI must be a valid MongoDB connection URI.',
    'ATTENDANCE_TEST_MONGO_URI must use mongodb:// or mongodb+srv://.',
    'MONGO_URI is required.',
    'MONGO_URI must be a valid MongoDB connection URI.',
    'MONGO_URI must use mongodb:// or mongodb+srv://.',
    'ATTENDANCE_TEST_MONGO_URI must select the nivhr_test database.',
    'ATTENDANCE_TEST_MONGO_URI must select exactly the nivhr_test database.',
    'ATTENDANCE_TEST_MONGO_URI must include exactly one authSource=admin option.',
    'ATTENDANCE_TEST_MONGO_URI must be different from MONGO_URI.',
  ]);
  if (safeSetupErrors.has(error?.message)) console.error(`NOT RUN: ${error.message}`);
  else console.error(`Leave-review smoke setup failed (${error?.name || 'Error'}).`);
  process.exitCode = 1;
} finally {
  await cleanup();
}

if (results.some((passed) => !passed)) process.exitCode = 1;
