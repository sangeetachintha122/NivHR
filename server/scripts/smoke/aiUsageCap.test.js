import assert from 'node:assert/strict';
import test from 'node:test';
import { reserveCloudflareRequest } from '../../src/services/aiUsageService.js';
import { GeminiQuotaCircuitBreaker } from '../../src/services/aiService.js';

test('concurrent atomic reservations never exceed the daily maximum', async () => {
  const counts = new Map();
  const model = {
    async findOneAndUpdate(filter, update) {
      const current = counts.get(filter._id) || 0;
      if (current >= filter.count.$lt) return null;
      const next = current + update.$inc.count;
      counts.set(filter._id, next);
      return { _id: filter._id, count: next };
    },
  };
  const requests = Array.from({ length: 50 }, () => reserveCloudflareRequest(7, {
    now: new Date('2026-11-12T23:59:59.000Z'), model,
  }));
  const reservations = await Promise.all(requests);
  assert.equal(reservations.filter(Boolean).length, 7);
  assert.equal(counts.get('2026-11-12'), 7);
});

test('UTC date rollover uses a new independent usage counter key', async () => {
  const keys = [];
  const model = {
    async findOneAndUpdate(filter) {
      keys.push(filter._id);
      return { _id: filter._id, count: 1 };
    },
  };
  await reserveCloudflareRequest(100, { now: new Date('2026-11-12T23:59:59.999Z'), model });
  await reserveCloudflareRequest(100, { now: new Date('2026-11-13T00:00:00.000Z'), model });
  assert.deepEqual(keys, ['2026-11-12', '2026-11-13']);
});

test('usage tracking errors propagate so fallback can fail closed', async () => {
  const model = { findOneAndUpdate: async () => { throw new Error('database unavailable'); } };
  await assert.rejects(reserveCloudflareRequest(100, { model }), /database unavailable/);
});

test('Gemini quota breaker allows only one probe after cooldown and closes on success', () => {
  let now = 1000;
  const breaker = new GeminiQuotaCircuitBreaker({ threshold: 2, cooldownMs: 500, now: () => now });
  breaker.failure('http_429', false);
  assert.equal(breaker.acquire().allowed, true);
  breaker.failure('http_429', false);
  assert.deepEqual(breaker.acquire(), { allowed: false, reason: 'circuit_open' });
  now += 500;
  const probe = breaker.acquire();
  assert.deepEqual(probe, { allowed: true, probe: true });
  assert.deepEqual(breaker.acquire(), { allowed: false, reason: 'probe_in_flight' });
  breaker.success(probe.probe);
  assert.deepEqual(breaker.acquire(), { allowed: true, probe: false });
});

test('a quota failure on the half-open probe reopens the breaker', () => {
  let now = 0;
  const breaker = new GeminiQuotaCircuitBreaker({ threshold: 1, cooldownMs: 100, now: () => now });
  breaker.failure('http_429', false);
  now = 100;
  const probe = breaker.acquire();
  breaker.failure('http_429', probe.probe);
  assert.deepEqual(breaker.acquire(), { allowed: false, reason: 'circuit_open' });
});

test('non-quota Gemini failures break a consecutive quota-failure sequence', () => {
  let now = 0;
  const breaker = new GeminiQuotaCircuitBreaker({ threshold: 2, cooldownMs: 100, now: () => now });
  breaker.failure('http_429', false);
  breaker.failure('http_5xx', false);
  breaker.failure('http_429', false);
  assert.deepEqual(breaker.acquire(), { allowed: true, probe: false });
  breaker.failure('http_429', false);
  assert.deepEqual(breaker.acquire(), { allowed: false, reason: 'circuit_open' });
});

test('invalid usage cap inputs are rejected', async () => {
  await assert.rejects(reserveCloudflareRequest(0), TypeError);
  await assert.rejects(reserveCloudflareRequest(1, { now: new Date('invalid') }), TypeError);
});
