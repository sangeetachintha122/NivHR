import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AIUsageDaily from '../../src/models/AIUsageDaily.js';
import { getCloudflareFallbackConfig, CLOUDFLARE_AI_MODEL } from '../../src/config/aiProvider.js';
import { generateJson, GEMINI_DEV_SIMULATION_PROMPT } from '../../src/services/aiService.js';
import { validateAnalyticsPlan } from '../../src/services/analyticsPlanService.js';
import { validateIsolatedMongoUri } from './databaseIdentityGuard.js';
import { inspectCloudflareResponse } from './cloudflareResponseDiagnostics.js';
import { CloudflareUsageCounterTracker } from './cloudflareUsageCounterTracker.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(serverDirectory, '.env'), override: false });

const logs = [];
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalError = console.error;
let cloudflareHttpStatus;
let cloudflareResponseClone;
let cloudflareResponseDiagnostics;
let cloudflareRequests = 0;
let geminiRequests = 0;
let simulatedGemini429Failures = 0;
let usageIncreasedExactlyOnce = false;
let usageCounterCleaned = true;
let validResponse = false;
let safeLogs = false;
let connected = false;
let testRunError;
let usageTracker;
let originalUsageFindOneAndUpdate;
let generatedResult;

const printResult = (result) => {
  console.log(`Cloudflare HTTP status: ${Number.isInteger(cloudflareHttpStatus) ? cloudflareHttpStatus : 'not reached'}`);
  console.log(`Cloudflare response metadata: ${JSON.stringify(cloudflareResponseDiagnostics ?? {
    httpStatus: null,
    contentType: 'unavailable',
    topLevelJsonKeys: [],
    otherTopLevelKeyCount: 0,
    selectedFieldTypes: { success: 'unavailable', result: 'unavailable', 'result.response': 'unavailable' },
    expectedResponseFieldExists: false,
    outputLength: null,
    parserFailureCategory: 'response_unavailable',
  })}`);
  console.log(`Selected model: ${CLOUDFLARE_AI_MODEL}`);
  console.log(`Valid response received: ${validResponse ? 'yes' : 'no'}`);
  console.log(`Cloudflare requests attempted: ${cloudflareRequests}`);
  console.log(`Simulated Gemini 429 retry events: ${simulatedGemini429Failures}`);
  console.log(`Usage counter increased exactly one: ${usageIncreasedExactlyOnce ? 'yes' : 'no'}`);
  console.log(`Isolated test usage record cleaned or restored: ${usageCounterCleaned ? 'yes' : 'no'}`);
  console.log(`Gemini network requests: ${geminiRequests}`);
  console.log(`Safe provider logs: ${safeLogs ? 'yes' : 'no'}`);
  console.log(`Result: ${result}`);
};

const main = async () => {
  if (process.env.NODE_ENV !== 'development') throw new Error('development mode is required');
  if (process.env.GEMINI_DEV_SIMULATE_429 !== 'once') throw new Error('one-shot simulation setting is required');
  if (!process.env.GEMINI_API_KEY?.trim() || !process.env.GEMINI_TEXT_MODEL?.trim()) {
    throw new Error('Gemini configuration is missing');
  }
  const configuration = getCloudflareFallbackConfig();
  if (!configuration) throw new Error('both Cloudflare flags and valid local credentials are required');

  const isolatedMongoUri = validateIsolatedMongoUri(
    process.env.ATTENDANCE_TEST_MONGO_URI,
    process.env.MONGO_URI,
  );
  await mongoose.connect(isolatedMongoUri, { serverSelectionTimeoutMS: 5000 });
  connected = true;
  if (mongoose.connection.name !== 'nivhr_test') throw new Error('isolated database identity check failed');

  usageTracker = new CloudflareUsageCounterTracker(AIUsageDaily);
  originalUsageFindOneAndUpdate = AIUsageDaily.findOneAndUpdate;

  globalThis.fetch = async (input, options) => {
    const hostname = new URL(typeof input === 'string' ? input : input.url).hostname;
    if (hostname === 'generativelanguage.googleapis.com') {
      geminiRequests += 1;
      throw new Error('Gemini network access blocked by controlled smoke test');
    }
    if (hostname !== 'api.cloudflare.com') throw new Error('unexpected provider host blocked by controlled smoke test');
    cloudflareRequests += 1;
    if (cloudflareRequests > 1) throw new Error('additional Cloudflare request blocked by controlled smoke test');
    const response = await originalFetch(input, options);
    cloudflareHttpStatus = response.status;
    try {
      cloudflareResponseClone = response.clone();
    } catch {
      cloudflareResponseClone = undefined;
    }
    return response;
  };
  console.info = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);

  AIUsageDaily.findOneAndUpdate = usageTracker.wrapFindOneAndUpdate(originalUsageFindOneAndUpdate);
  generatedResult = await generateJson(GEMINI_DEV_SIMULATION_PROMPT);
  validResponse = validateAnalyticsPlan(generatedResult) !== null;
  usageIncreasedExactlyOnce = await usageTracker.verifySingleReservation();

  assert.equal(cloudflareRequests, 1);
  assert.equal(geminiRequests, 0);
  assert.equal(cloudflareHttpStatus, 200);
  assert.equal(validResponse, true);
  assert.equal(usageIncreasedExactlyOnce, true);
};

const cleanupTrackedUsageCounter = async () => {
  if (!connected || !usageTracker) return;
  try {
    usageCounterCleaned = await usageTracker.restoreTrackedReservation();
  } catch {
    usageCounterCleaned = false;
  }
};

const collectStringValues = (value) => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStringValues);
  return [];
};

try {
  await main();
} catch (error) {
  testRunError = error;
} finally {
  if (cloudflareResponseClone) {
    try {
      cloudflareResponseDiagnostics = await inspectCloudflareResponse(cloudflareResponseClone);
    } catch {
      cloudflareResponseDiagnostics = undefined;
    }
  }
  simulatedGemini429Failures = logs.filter(([message, details]) =>
    message === 'AI provider request failed.'
    && details?.provider === 'gemini'
    && details?.failureCategory === 'http_429'
    && details?.httpStatus === 429).length;
  const forbiddenLogValues = [
    process.env.GEMINI_API_KEY,
    process.env.CLOUDFLARE_ACCOUNT_ID,
    process.env.CLOUDFLARE_API_TOKEN,
    process.env.MONGO_URI,
    process.env.ATTENDANCE_TEST_MONGO_URI,
    GEMINI_DEV_SIMULATION_PROMPT,
    ...collectStringValues(generatedResult),
  ].filter(Boolean);
  const serializedLogs = JSON.stringify(logs);
  safeLogs = forbiddenLogValues.every((value) => !serializedLogs.includes(value));
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  console.error = originalError;
  if (originalUsageFindOneAndUpdate) AIUsageDaily.findOneAndUpdate = originalUsageFindOneAndUpdate;
  process.env.GEMINI_DEV_SIMULATE_429 = 'off';
  await cleanupTrackedUsageCounter();
  if (connected) await mongoose.disconnect().catch(() => {});
}

if (!testRunError && !usageCounterCleaned) testRunError = new Error('isolated usage-counter cleanup failed');

if (testRunError) {
  // Emit only generic setup/runtime classification; never provider or connection details.
  console.error(`Controlled Cloudflare smoke test failed (${testRunError.name || 'Error'}); sensitive details omitted.`);
  printResult('FAIL');
  process.exitCode = 1;
} else {
  printResult('PASS');
}
