import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AIUsageDaily from '../../src/models/AIUsageDaily.js';
import { reserveCloudflareRequest } from '../../src/services/aiUsageService.js';
import { validateIsolatedMongoUri } from './databaseIdentityGuard.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverDirectory, '.env'), override: true });

const DAY_MS = 86400000;
const runId = randomUUID().replaceAll('-', '');
const reservedFixtureIds = new Set();
const trackedFixtureIds = new Set();
let isolatedMongoUri;
let databaseConnected = false;

const pass = (description) => console.log(`PASS ${description}`);

const getUnusedDayKey = async (offset = 0) => {
  const start = new Date(Date.UTC(2040, 0, 1) + (Number.parseInt(runId.slice(0, 8), 16) % 10000 + offset) * DAY_MS);
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const candidate = new Date(start.getTime() + attempt * DAY_MS).toISOString().slice(0, 10);
    if (reservedFixtureIds.has(candidate)) continue;
    if (!await AIUsageDaily.exists({ _id: candidate })) {
      reservedFixtureIds.add(candidate);
      return candidate;
    }
  }
  throw new Error('No unused UTC day key was available for the isolated test.');
};

const getUnusedConsecutiveDayKeys = async () => {
  for (let attempt = 0; attempt < 10000; attempt += 1) {
    const first = await getUnusedDayKey(attempt * 2);
    const nextDate = new Date(`${first}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const second = nextDate.toISOString().slice(0, 10);
    if (!reservedFixtureIds.has(second) && !await AIUsageDaily.exists({ _id: second })) {
      reservedFixtureIds.add(second);
      return [first, second];
    }
  }
  throw new Error('No unused consecutive UTC day keys were available for the isolated test.');
};

const dateAtUtcNoon = (dayKey) => new Date(`${dayKey}T12:00:00.000Z`);

const testConcurrentInitialReservations = async () => {
  const dayKey = await getUnusedDayKey();
  const limit = 32;
  const reservations = await Promise.allSettled(Array.from({ length: limit }, () =>
    reserveCloudflareRequest(limit, { now: dateAtUtcNoon(dayKey) })));
  const failures = reservations.filter((result) => result.status === 'rejected');
  const successfulCount = reservations.filter((result) => result.status === 'fulfilled' && result.value).length;
  const documentExists = await AIUsageDaily.exists({ _id: dayKey });
  if (documentExists) trackedFixtureIds.add(dayKey);
  assert.equal(failures.length, 0);
  assert.equal(successfulCount, limit);
  const document = await AIUsageDaily.findById(dayKey).lean();
  assert.equal(document?.count, limit);
  pass('Concurrent initial reservations create one document and stay within the cap');
};

const testConcurrentNearLimitReservations = async () => {
  const dayKey = await getUnusedDayKey(12000);
  const limit = 9;
  await AIUsageDaily.create({ _id: dayKey, count: limit - 2 });
  trackedFixtureIds.add(dayKey);
  const reservations = await Promise.all(Array.from({ length: 40 }, () =>
    reserveCloudflareRequest(limit, { now: dateAtUtcNoon(dayKey) })));
  assert.equal(reservations.filter(Boolean).length, 2);
  const document = await AIUsageDaily.findById(dayKey).lean();
  assert.equal(document?.count, limit);
  assert.ok(document.count <= limit);
  pass('Concurrent reservations near the cap never increment past the configured limit');
};

const testDuplicateKeyRace = async () => {
  const dayKey = await getUnusedDayKey(24000);
  let raceInserted = false;
  let nonUpsertRetryObserved = false;
  const concurrentWriterModel = {
    async findOneAndUpdate(filter, update, options = {}) {
      if (options.upsert && !raceInserted) {
        raceInserted = true;
        // Simulate another process winning the initial upsert immediately before this one.
        await AIUsageDaily.create({ _id: filter._id, count: 0 });
        trackedFixtureIds.add(dayKey);
        const duplicateKeyError = new Error('Synthetic duplicate-key race');
        duplicateKeyError.code = 11000;
        throw duplicateKeyError;
      }
      if (!options.upsert) nonUpsertRetryObserved = true;
      return AIUsageDaily.findOneAndUpdate(filter, update, options);
    },
  };

  const reserved = await reserveCloudflareRequest(4, {
    now: dateAtUtcNoon(dayKey),
    model: concurrentWriterModel,
  });
  assert.equal(reserved, true);
  trackedFixtureIds.add(dayKey);
  assert.equal(nonUpsertRetryObserved, true);
  assert.equal((await AIUsageDaily.findById(dayKey).lean())?.count, 1);
  pass('Duplicate-key upsert race retries atomically without a second upsert');
};

const testUtcRollover = async () => {
  const [firstDay, nextDay] = await getUnusedConsecutiveDayKeys();
  assert.equal(await reserveCloudflareRequest(5, { now: dateAtUtcNoon(firstDay) }), true);
  trackedFixtureIds.add(firstDay);
  assert.equal(await reserveCloudflareRequest(5, { now: dateAtUtcNoon(nextDay) }), true);
  trackedFixtureIds.add(nextDay);
  assert.equal((await AIUsageDaily.findById(firstDay).lean())?.count, 1);
  assert.equal((await AIUsageDaily.findById(nextDay).lean())?.count, 1);
  pass('UTC date rollover reserves into a separate daily document');
};

const testDatabaseFailureFailsClosed = async () => {
  const bufferTimeout = AIUsageDaily.schema.get('bufferTimeoutMS');
  AIUsageDaily.schema.set('bufferTimeoutMS', 150);
  await mongoose.disconnect();
  databaseConnected = false;
  try {
    await assert.rejects(
      reserveCloudflareRequest(1, { now: new Date('2099-12-31T12:00:00.000Z') }),
      (error) => error?.name === 'MongoNotConnectedError' || /buffering timed out/i.test(error?.message || ''),
    );
  } finally {
    AIUsageDaily.schema.set('bufferTimeoutMS', bufferTimeout);
    await mongoose.connect(isolatedMongoUri, { serverSelectionTimeoutMS: 5000 });
    databaseConnected = true;
  }
  pass('Unavailable MongoDB rejects usage reservation so fallback can fail closed');
};

const cleanupTrackedFixtures = async () => {
  if (!databaseConnected || trackedFixtureIds.size === 0) return;
  for (const id of trackedFixtureIds) {
    await AIUsageDaily.deleteOne({ _id: id });
  }
  console.log(`CLEANUP removed only ${trackedFixtureIds.size} tracked AI usage test IDs.`);
};

const main = async () => {
  try {
    isolatedMongoUri = validateIsolatedMongoUri(
      process.env.ATTENDANCE_TEST_MONGO_URI,
      process.env.MONGO_URI,
    );
  } catch (error) {
    console.error(`NOT RUN: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  pass('Database URI guard confirms nivhr_test and a distinct database identity');

  try {
    await mongoose.connect(isolatedMongoUri, { serverSelectionTimeoutMS: 5000 });
    databaseConnected = true;
    if (mongoose.connection.name !== 'nivhr_test') {
      throw new Error('Connected MongoDB database identity check failed.');
    }
    pass('Connected only to the guarded nivhr_test database');

    await testConcurrentInitialReservations();
    await testConcurrentNearLimitReservations();
    await testDuplicateKeyRace();
    await testUtcRollover();
    await testDatabaseFailureFailsClosed();
  } catch (error) {
    if (error instanceof assert.AssertionError) console.error(`FAIL ${error.message}`);
    else if (!databaseConnected) console.error(`NOT RUN: isolated nivhr_test connection failed (${error?.name || 'Error'}); connection details omitted.`);
    else console.error(`FAIL AI usage integration test (${error?.name || 'Error'}); connection details omitted.`);
    process.exitCode = 1;
  } finally {
    try {
      if (!databaseConnected && isolatedMongoUri && trackedFixtureIds.size > 0) {
        await mongoose.connect(isolatedMongoUri, { serverSelectionTimeoutMS: 5000 });
        databaseConnected = true;
      }
      await cleanupTrackedFixtures();
    } catch {
      console.error('FAIL cleanup of tracked AI usage test IDs; no collections or databases were dropped.');
      process.exitCode = 1;
    }
    try {
      await mongoose.disconnect();
    } catch {
      console.error('FAIL closing isolated MongoDB test connection.');
      process.exitCode = 1;
    }
  }
};

await main();
