import dotenv from 'dotenv';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import ActivityEvent from '../../src/models/ActivityEvent.js';
import AuditLog from '../../src/models/AuditLog.js';
import DepartmentCapacity from '../../src/models/DepartmentCapacity.js';
import LeaveBalance from '../../src/models/LeaveBalance.js';
import LeaveRequest from '../../src/models/LeaveRequest.js';
import User from '../../src/models/User.js';
import { validateIsolatedMongoUri } from './databaseIdentityGuard.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverDirectory, '.env'), override: true });
const runId = randomUUID().replaceAll('-', '');
const jwtSecret = randomUUID() + randomUUID();
const testPassword = randomUUID();
const emailFor = (key) => `capacity-${key}-${runId}@example.invalid`;
const developmentDepartment = `Development ${runId}`;
const testingDepartment = `Testing ${runId}`;
const testDate = '2027-01-11';
const createdUserIds = [];
const createdDocumentIds = {
  users: [],
  leaveRequests: [],
  leaveBalances: [],
  departmentCapacities: [],
  activityEvents: [],
  auditLogs: [],
};
let testDatabaseConnected = false;
let testServer;
let baseUrl;

const isolatedMongoUri = () => {
  return validateIsolatedMongoUri(process.env.ATTENDANCE_TEST_MONGO_URI, process.env.MONGO_URI);
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
    createdUserIds.length
      ? ActivityEvent.find({ $or: [
        { actorUserId: { $in: createdUserIds } },
        { subjectUserId: { $in: createdUserIds } },
      ] }).select('_id').lean()
      : [],
    createdUserIds.length ? AuditLog.find({ userId: { $in: createdUserIds } }).select('_id').lean() : [],
  ]);
  if (queries[0].status === 'fulfilled') trackIds('leaveBalances', queries[0].value);
  if (queries[1].status === 'fulfilled') trackIds('activityEvents', queries[1].value);
  if (queries[2].status === 'fulfilled') trackIds('auditLogs', queries[2].value);
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
    if (testServer.exitCode !== null) throw new Error('The isolated capacity API server exited before becoming ready.');
    try {
      const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // The isolated server may still be connecting to MongoDB.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The isolated capacity API server did not become ready in time.');
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

const request = async (pathname, token, { method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
};

const createUser = async ({ key, name, role = 'employee', department, isActive = true }) => {
  const user = await User.create({
    name,
    email: emailFor(key),
    passwordHash: await bcrypt.hash(testPassword, 8),
    role,
    ...(department ? { department } : {}),
    isActive,
  });
  createdUserIds.push(user._id);
  trackIds('users', [user]);
  return user;
};

const tokenFor = (user) => jwt.sign(
  { role: user.role },
  jwtSecret,
  { algorithm: 'HS256', subject: user._id.toString(), expiresIn: '1h' },
);

const createLeave = async (employeeId, status, date = testDate) => {
  const leave = await LeaveRequest.create({
    employeeId,
    type: 'annual',
    fromDate: new Date(`${date}T00:00:00.000Z`),
    toDate: new Date(`${date}T00:00:00.000Z`),
    totalDays: 1,
    reason: 'Isolated department capacity smoke fixture',
    status,
  });
  trackIds('leaveRequests', [leave]);
  return leave;
};

const pass = (label) => console.log(`PASS ${label}`);
const assertStatus = (result, expected, label) => {
  assert.equal(result.status, expected, `${label}: received HTTP ${result.status}`);
  pass(label);
};

try {
  const mongoUri = isolatedMongoUri();
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
  testDatabaseConnected = true;
  await Promise.all([
    User.init(),
    LeaveRequest.init(),
    LeaveBalance.init(),
    DepartmentCapacity.init(),
    AuditLog.init(),
  ]);

  const hr = await createUser({ key: 'hr', name: 'Capacity Smoke HR', role: 'hr' });
  const developmentEmployees = [];
  for (let index = 0; index < 5; index += 1) {
    developmentEmployees.push(await createUser({
      key: `development-${index}`,
      name: `Development Test ${index}`,
      department: developmentDepartment,
    }));
  }
  await createUser({ key: 'development-inactive', name: 'Inactive Development Test', department: developmentDepartment, isActive: false });
  const testingEmployees = await settleCreatedRecords([
    createUser({ key: 'testing-1', name: 'Testing One', department: testingDepartment }),
    createUser({ key: 'testing-2', name: 'Testing Two', department: testingDepartment }),
  ]);
  const employeeTokens = new Map([...developmentEmployees, ...testingEmployees].map((user) => [user._id.toString(), tokenFor(user)]));
  const hrToken = tokenFor(hr);

  for (const employee of [...developmentEmployees, ...testingEmployees]) {
    const balance = await LeaveBalance.create({ employeeId: employee._id, type: 'annual', total: 18, used: 0 });
    trackIds('leaveBalances', [balance]);
  }
  for (const department of [developmentDepartment, testingDepartment]) {
    const capacity = await DepartmentCapacity.create({ department, maxSimultaneousAbsent: 1, updatedBy: hr._id });
    trackIds('departmentCapacities', [capacity]);
  }

  const [targetLeave, approvedFixture, pendingFixture, rejectedFixture, cancelledFixture] = await settleCreatedRecords([
    createLeave(developmentEmployees[0]._id, 'pending'),
    createLeave(developmentEmployees[1]._id, 'approved'),
    createLeave(developmentEmployees[2]._id, 'pending'),
    createLeave(developmentEmployees[3]._id, 'rejected'),
    createLeave(developmentEmployees[4]._id, 'cancelled'),
  ]);

  testServer = spawn(
    process.execPath,
    ['--import', pathToFileURL(path.join(serverDirectory, 'scripts/smoke/capacityMockGemini.js')).href, 'src/server.js'],
    {
      cwd: serverDirectory,
      env: {
        ...process.env,
        MONGO_URI: mongoUri,
        PORT: String(port),
        JWT_SECRET: jwtSecret,
        JWT_EXPIRES_IN: '8h',
        GEMINI_API_KEY: 'capacity-smoke-only',
        GEMINI_EMBED_MODEL: 'capacity-smoke-embedding',
        GEMINI_TEXT_MODEL: 'capacity-smoke-text',
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

  const hrSettings = await request('/capacity', hrToken);
  assertStatus(hrSettings, 200, 'HR can retrieve department capacity settings');
  const developmentSetting = hrSettings.body.departments.find((item) => item.department === developmentDepartment);
  assert.equal(developmentSetting.activeHeadcount, 5);
  assert.equal(developmentSetting.maxSimultaneousAbsent, 1);
  assert.equal(hrSettings.body.departments.find((item) => item.department === testingDepartment).activeHeadcount, 2);

  assertStatus(await request('/capacity', employeeTokens.get(developmentEmployees[0]._id.toString())), 403, 'Employee receives 403 on capacity GET');
  assertStatus(await request(`/capacity/${encodeURIComponent(developmentDepartment)}`, employeeTokens.get(developmentEmployees[0]._id.toString()), {
    method: 'PUT', body: { maxSimultaneousAbsent: 1 },
  }), 403, 'Employee receives 403 on capacity PUT');

  for (const invalidValue of [-1, 1.5, '1']) {
    assertStatus(await request(`/capacity/${encodeURIComponent(developmentDepartment)}`, hrToken, {
      method: 'PUT', body: { maxSimultaneousAbsent: invalidValue },
    }), 400, `Invalid capacity value ${String(invalidValue)} is rejected`);
  }
  assertStatus(await request(`/capacity/${encodeURIComponent(developmentDepartment)}`, hrToken, {
    method: 'PUT', body: { maxSimultaneousAbsent: 6 },
  }), 400, 'Capacity cannot exceed active department headcount');

  const employeeToken = employeeTokens.get(developmentEmployees[0]._id.toString());
  assertStatus(await request(`/leaves/${targetLeave._id}/ai-review`, employeeToken, { method: 'POST' }), 403, 'Employee cannot run HR capacity leave review');
  const reviewBeforeUpdate = await request(`/leaves/${targetLeave._id}/ai-review`, hrToken, { method: 'POST' });
  assertStatus(reviewBeforeUpdate, 200, 'AI Leave Review returns calculated department capacity');
  const initialCapacityCheck = reviewBeforeUpdate.body.analysis.policyChecks.find((check) => check.rule === 'Department leave capacity');
  const initialCapacityFacts = reviewBeforeUpdate.body.analysis.deterministicFacts.departmentCapacity;
  assert.equal(initialCapacityCheck.status, 'concern');
  assert.deepEqual(initialCapacityFacts.exceededDates, [testDate]);
  assert.equal(initialCapacityFacts.days[0].approved, 1);
  assert.equal(initialCapacityFacts.days[0].pending, 1);
  assert.equal(reviewBeforeUpdate.body.analysis.recommendation, 'needs_attention');
  assert.equal(reviewBeforeUpdate.body.analysis.policyChecks.some((check) => check.rule.includes('cancelled') || check.rule.includes('rejected')), false);
  assert.equal((await LeaveRequest.findById(targetLeave._id).lean()).status, 'pending');
  assert.equal((await LeaveBalance.findOne({ employeeId: developmentEmployees[0]._id, type: 'annual' })).used, 0);
  pass('Capacity calculation separates pending and excludes rejected and cancelled requests');

  const updatedSetting = await request(`/capacity/${encodeURIComponent(developmentDepartment.toLowerCase())}`, hrToken, {
    method: 'PUT', body: { maxSimultaneousAbsent: 2 },
  });
  assertStatus(updatedSetting, 200, 'HR can update department capacity using case-insensitive department name');
  assert.equal(updatedSetting.body.capacity.department, developmentDepartment);
  const reviewAfterUpdate = await request(`/leaves/${targetLeave._id}/ai-review`, hrToken, { method: 'POST' });
  assertStatus(reviewAfterUpdate, 200, 'AI Leave Review uses the latest saved capacity');
  assert.equal(reviewAfterUpdate.body.analysis.deterministicFacts.departmentCapacity.maxSimultaneousAbsent, 2);
  assert.equal(reviewAfterUpdate.body.analysis.policyChecks.find((check) => check.rule === 'Department leave capacity').status, 'compliant');
  pass('Latest capacity update is reflected in leave review facts');

  const [firstTestingLeave, secondTestingLeave] = await settleCreatedRecords([
    createLeave(testingEmployees[0]._id, 'pending', '2027-01-12'),
    createLeave(testingEmployees[1]._id, 'pending', '2027-01-12'),
  ]);
  const firstApproval = await request(`/leaves/${firstTestingLeave._id}/decision`, hrToken, {
    method: 'PATCH', body: { decision: 'approved' },
  });
  assertStatus(firstApproval, 200, 'First approval within department capacity succeeds');
  const refusedApproval = await request(`/leaves/${secondTestingLeave._id}/decision`, hrToken, {
    method: 'PATCH', body: { decision: 'approved' },
  });
  assertStatus(refusedApproval, 409, 'Second approval without an override reason is refused');
  assert.equal((await LeaveBalance.findOne({ employeeId: testingEmployees[1]._id, type: 'annual' })).used, 0);
  const overriddenApproval = await request(`/leaves/${secondTestingLeave._id}/decision`, hrToken, {
    method: 'PATCH', body: { decision: 'approved', overrideReason: 'Maintain critical test coverage during release week.' },
  });
  assertStatus(overriddenApproval, 200, 'Second approval succeeds with an override reason');
  const persistedOverride = await LeaveRequest.findById(secondTestingLeave._id).lean();
  assert.equal(persistedOverride.capacityOverride, true);
  assert.equal(persistedOverride.capacityOverrideReason, 'Maintain critical test coverage during release week.');
  const overrideAudit = await AuditLog.findOne({ userId: hr._id, feature: 'leave-approval', intent: 'capacity-override' }).lean();
  assert.equal(overrideAudit?.metadata?.capacityOverride, true);
  assert.equal(overrideAudit?.metadata?.leaveRequestId.toString(), secondTestingLeave._id.toString());
  assert.equal(JSON.stringify(overrideAudit?.metadata || {}).includes('Maintain critical test coverage'), false);
  pass('Capacity override reason is stored on leave and excluded from audit metadata');

  const cancelTarget = await createLeave(developmentEmployees[4]._id, 'pending', '2027-01-14');
  const cancellation = await request(`/leaves/${cancelTarget._id}/cancel`, employeeTokens.get(developmentEmployees[4]._id.toString()), { method: 'PATCH' });
  assertStatus(cancellation, 200, 'Employee pending leave cancellation remains available');
  assert.equal((await LeaveRequest.findById(cancelTarget._id).lean()).status, 'cancelled');
  assert.equal((await LeaveBalance.findOne({ employeeId: developmentEmployees[4]._id, type: 'annual' })).used, 0);
  pass('Leave cancellation does not change leave balances');

  for (const fixture of [approvedFixture, pendingFixture, rejectedFixture, cancelledFixture]) {
    assert.ok(await LeaveRequest.exists({ _id: fixture._id }));
  }
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
  if (error instanceof assert.AssertionError) console.error(`FAIL ${error.message}`);
  else if (safeSetupErrors.has(error?.message)) console.error(`NOT RUN: ${error.message}`);
  else console.error(`Capacity smoke test could not complete (${error?.name || 'Error'}).`);
  process.exitCode = 1;
} finally {
  try { await stopServer(); } catch { console.error('Failed to stop isolated capacity API server cleanly.'); process.exitCode = 1; }
  if (testDatabaseConnected) {
    try {
      await captureApiCreatedIds();
    } catch {
      console.error('Could not finish tracking capacity smoke documents for cleanup.');
      process.exitCode = 1;
    }
    for (const [model, ids] of [
      [LeaveRequest, createdDocumentIds.leaveRequests],
      [LeaveBalance, createdDocumentIds.leaveBalances],
      [DepartmentCapacity, createdDocumentIds.departmentCapacities],
      [ActivityEvent, createdDocumentIds.activityEvents],
      [AuditLog, createdDocumentIds.auditLogs],
      [User, createdDocumentIds.users],
    ]) {
      if (!ids.length) continue;
      try {
        const result = await model.deleteMany({ _id: { $in: ids } });
        if (result.deletedCount !== ids.length) {
          throw new Error(`Cleanup removed ${result.deletedCount} of ${ids.length} tracked documents.`);
        }
      } catch {
        console.error(`Cleanup failed for tracked ${model.collection.collectionName} documents.`);
        process.exitCode = 1;
      }
    }
  }
  try { await mongoose.disconnect(); } catch { console.error('Failed to close isolated capacity smoke database connection.'); process.exitCode = 1; }
}
