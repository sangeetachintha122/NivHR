import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import AIUsageDaily from '../../src/models/AIUsageDaily.js';
import AuditLog from '../../src/models/AuditLog.js';
import DepartmentCapacity from '../../src/models/DepartmentCapacity.js';
import LeaveBalance from '../../src/models/LeaveBalance.js';
import LeaveRequest from '../../src/models/LeaveRequest.js';
import PolicyChunk from '../../src/models/PolicyChunk.js';
import User from '../../src/models/User.js';
import { answerPolicyQuestion } from '../../src/services/policyService.js';
import { reviewLeaveRequest } from '../../src/services/leaveReviewService.js';

const envNames = [
  'GEMINI_API_KEY', 'GEMINI_TEXT_MODEL', 'GEMINI_EMBED_MODEL',
  'CLOUDFLARE_AI_ENABLED', 'CLOUDFLARE_FALLBACK_ENABLED', 'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL', 'CLOUDFLARE_DAILY_MAX_REQUESTS',
  'CLOUDFLARE_REQUEST_TIMEOUT_MS',
];

const enableMockedProviders = (t) => {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GEMINI_API_KEY: 'synthetic-gemini-key',
    GEMINI_TEXT_MODEL: 'synthetic-text-model',
    GEMINI_EMBED_MODEL: 'synthetic-embedding-model',
    CLOUDFLARE_AI_ENABLED: 'true',
    CLOUDFLARE_FALLBACK_ENABLED: 'true',
    CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
    CLOUDFLARE_DAILY_MAX_REQUESTS: '100',
    CLOUDFLARE_REQUEST_TIMEOUT_MS: '30000',
  });
  delete process.env.CLOUDFLARE_AI_MODEL;
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
};

const mockFetch = (t, invalidGenerationJson) => {
  const hosts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const target = new URL(url);
    hosts.push(target.hostname);
    if (target.hostname === 'api.cloudflare.com') {
      return new Response(JSON.stringify({ success: true, result: { response: '{}' } }));
    }
    if (target.pathname.endsWith(':batchEmbedContents')) {
      const body = JSON.parse(options.body);
      const count = body.requests?.length || 6;
      return new Response(JSON.stringify({ embeddings: Array.from({ length: count }, () => ({ values: [1, 0] })) }));
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: invalidGenerationJson }] } }],
    }));
  });
  t.mock.method(AIUsageDaily, 'findOneAndUpdate', async () => ({ _id: 'test-only', count: 1 }));
  return hosts;
};

const queryWithLean = (value) => ({
  select() { return this; },
  populate() { return this; },
  collation() { return this; },
  lean: async () => value,
});

test('Policy Assistant Zod rejection does not trigger provider fallback', async (t) => {
  enableMockedProviders(t);
  const hosts = mockFetch(t, '{"unexpected":"invalid policy response"}');
  const policyChunk = {
    _id: new mongoose.Types.ObjectId(),
    docId: { title: 'Synthetic policy' },
    chunkIndex: 0,
    text: 'Synthetic policy excerpt for testing only.',
    embedding: [1, 0],
  };
  t.mock.method(PolicyChunk, 'find', () => queryWithLean([policyChunk]));
  t.mock.method(AuditLog, 'create', async () => ({}));

  const result = await answerPolicyQuestion({
    userId: new mongoose.Types.ObjectId(),
    question: 'What does the synthetic policy say?',
  });

  assert.equal(result.found, false);
  assert.equal(hosts.filter((host) => host === 'generativelanguage.googleapis.com').length, 2);
  assert.equal(hosts.filter((host) => host === 'api.cloudflare.com').length, 0);
});

test('Leave Review Zod rejection does not trigger provider fallback', async (t) => {
  enableMockedProviders(t);
  const hosts = mockFetch(t, '{"unexpected":"invalid leave review response"}');
  const employeeId = new mongoose.Types.ObjectId();
  const leaveId = new mongoose.Types.ObjectId();
  const leave = {
    _id: leaveId,
    employeeId,
    type: 'annual',
    fromDate: new Date('2028-06-05T00:00:00.000Z'),
    toDate: new Date('2028-06-05T00:00:00.000Z'),
    status: 'pending',
    reason: 'Synthetic test reason only.',
  };

  t.mock.method(LeaveRequest, 'findById', () => queryWithLean(leave));
  t.mock.method(LeaveRequest, 'aggregate', async () => []);
  t.mock.method(LeaveRequest, 'find', () => ({ select: () => queryWithLean([]) }));
  t.mock.method(User, 'findById', () => ({ select: () => queryWithLean({ department: 'Synthetic', joinDate: new Date('2020-01-01T00:00:00.000Z') }) }));
  t.mock.method(User, 'find', () => ({ select: () => queryWithLean([{ _id: employeeId }]) }));
  t.mock.method(LeaveBalance, 'findOne', () => queryWithLean({ total: 20, used: 0 }));
  t.mock.method(DepartmentCapacity, 'findOne', () => queryWithLean({ maxSimultaneousAbsent: 4 }));
  t.mock.method(PolicyChunk, 'find', () => queryWithLean([{
    _id: new mongoose.Types.ObjectId(),
    docId: { title: 'Synthetic leave policy' },
    chunkIndex: 0,
    text: 'Synthetic leave policy evidence for testing only.',
    embedding: [1, 0],
  }]));
  t.mock.method(AuditLog, 'create', async () => ({}));

  await assert.rejects(reviewLeaveRequest({ leaveId: leaveId.toString(), reviewerId: new mongoose.Types.ObjectId() }),
    (error) => error.statusCode === 500 && error.message === 'AI review returned an invalid response');
  assert.ok(hosts.filter((host) => host === 'generativelanguage.googleapis.com').length >= 2);
  assert.equal(hosts.filter((host) => host === 'api.cloudflare.com').length, 0);
});
