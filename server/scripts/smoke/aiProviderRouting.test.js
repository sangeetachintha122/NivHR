import assert from 'node:assert/strict';
import test from 'node:test';
import AIUsageDaily from '../../src/models/AIUsageDaily.js';
import { validateAnalyticsPlan } from '../../src/services/analyticsPlanService.js';

const envNames = [
  'GEMINI_API_KEY', 'GEMINI_TEXT_MODEL', 'GEMINI_EMBED_MODEL',
  'CLOUDFLARE_AI_ENABLED', 'CLOUDFLARE_FALLBACK_ENABLED', 'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL', 'CLOUDFLARE_DAILY_MAX_REQUESTS',
  'CLOUDFLARE_REQUEST_TIMEOUT_MS', 'GEMINI_CIRCUIT_BREAKER_THRESHOLD',
  'GEMINI_CIRCUIT_BREAKER_COOLDOWN_MS',
];
let testId = 0;

const setEnvironment = (fallbackEnabled = true) => {
  const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_TEXT_MODEL: 'test-text-model',
    GEMINI_EMBED_MODEL: 'test-embedding-model',
    CLOUDFLARE_AI_ENABLED: 'true',
    CLOUDFLARE_FALLBACK_ENABLED: fallbackEnabled ? 'true' : 'false',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
    CLOUDFLARE_API_TOKEN: 'test-cloudflare-token',
    CLOUDFLARE_DAILY_MAX_REQUESTS: '100',
    CLOUDFLARE_REQUEST_TIMEOUT_MS: '30000',
  });
  delete process.env.CLOUDFLARE_AI_MODEL;
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
};

const importAiService = () => import(`../../src/services/aiService.js?provider-test=${testId++}`);
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });
const geminiSuccess = (json = '{"ok":true}') => jsonResponse({
  candidates: [{ content: { parts: [{ text: json }] } }],
});
const cloudflareSuccess = (json = '{"ok":true}') => jsonResponse({
  success: true,
  result: { response: json },
});

const mockUsageReservation = (t, result = { _id: '2026-11-12', count: 1 }) =>
  t.mock.method(AIUsageDaily, 'findOneAndUpdate', async () => result);

test('Gemini success never calls Cloudflare', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return geminiSuccess();
  });

  const { generateJson } = await importAiService();
  assert.deepEqual(await generateJson('test prompt'), { ok: true });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /generativelanguage\.googleapis\.com/);
});

for (const [name, firstResponse] of [
  ['429 quota after retries', () => jsonResponse({}, 429)],
  ['5xx after retries', () => jsonResponse({}, 503)],
]) {
  test(`Gemini ${name} routes once to Cloudflare`, async (t) => {
    const restore = setEnvironment();
    t.after(restore);
    mockUsageReservation(t);
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls.push(new URL(url).hostname);
      return new URL(url).hostname === 'api.cloudflare.com' ? cloudflareSuccess() : firstResponse();
    });

    const { generateJson } = await importAiService();
    assert.deepEqual(await generateJson('prompt'), { ok: true });
    assert.equal(calls.filter((host) => host === 'generativelanguage.googleapis.com').length, 2);
    assert.equal(calls.filter((host) => host === 'api.cloudflare.com').length, 1);
  });
}

test('Gemini timeout and temporary transport errors use Cloudflare after Gemini retry handling', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  mockUsageReservation(t);
  let geminiCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).hostname === 'api.cloudflare.com') return cloudflareSuccess();
    geminiCalls += 1;
    const error = new Error('synthetic network failure');
    error.name = geminiCalls === 1 ? 'AbortError' : 'TypeError';
    throw error;
  });

  const { generateJson } = await importAiService();
  assert.deepEqual(await generateJson('prompt'), { ok: true });
  assert.equal(geminiCalls, 2);
});

for (const status of [400, 401, 403, 404]) {
  test(`Gemini HTTP ${status} does not call Cloudflare`, async (t) => {
    const restore = setEnvironment();
    t.after(restore);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls += 1;
      return jsonResponse({}, status);
    });
    const { generateJson } = await importAiService();
    await assert.rejects(generateJson('prompt'), { code: 'AI_SERVICE_UNAVAILABLE' });
    assert.equal(calls, 1);
  });
}

test('missing fallback configuration keeps Gemini-only operation available', async (t) => {
  const restore = setEnvironment(false);
  t.after(restore);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return jsonResponse({}, 429);
  });
  const { generateJson } = await importAiService();
  await assert.rejects(generateJson('prompt'), { code: 'AI_SERVICE_UNAVAILABLE' });
  assert.equal(calls, 2);
});

test('enabled fallback with missing Cloudflare credentials does not break Gemini-only behavior', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_API_TOKEN;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return jsonResponse({}, 429);
  });
  const { generateJson } = await importAiService();
  await assert.rejects(generateJson('prompt'), { code: 'AI_SERVICE_UNAVAILABLE' });
  assert.equal(calls, 2);
});

test('invalid Cloudflare model configuration fails closed while provider module and Gemini remain usable', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  process.env.CLOUDFLARE_AI_MODEL = 'unapproved/model';
  let cloudflareCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).hostname === 'api.cloudflare.com') cloudflareCalls += 1;
    return geminiSuccess();
  });
  const { generateJson } = await importAiService();
  assert.deepEqual(await generateJson('prompt'), { ok: true });
  assert.equal(cloudflareCalls, 0);
});

test('open Gemini quota breaker bypasses further Gemini calls while using enabled fallback', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  process.env.GEMINI_CIRCUIT_BREAKER_THRESHOLD = '1';
  process.env.GEMINI_CIRCUIT_BREAKER_COOLDOWN_MS = '60000';
  mockUsageReservation(t);
  let geminiCalls = 0;
  let cloudflareCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).hostname === 'api.cloudflare.com') {
      cloudflareCalls += 1;
      return cloudflareSuccess();
    }
    geminiCalls += 1;
    return jsonResponse({}, 429);
  });
  const { generateJson } = await importAiService();
  assert.deepEqual(await generateJson('first prompt'), { ok: true });
  assert.deepEqual(await generateJson('second prompt'), { ok: true });
  assert.equal(geminiCalls, 2);
  assert.equal(cloudflareCalls, 2);
});

test('daily cap reached prevents Cloudflare request', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  mockUsageReservation(t, null);
  let cloudflareCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).hostname === 'api.cloudflare.com') {
      cloudflareCalls += 1;
      return cloudflareSuccess();
    }
    return jsonResponse({}, 429);
  });
  const { generateJson } = await importAiService();
  await assert.rejects(generateJson('prompt'), { code: 'AI_SERVICE_UNAVAILABLE' });
  assert.equal(cloudflareCalls, 0);
});

test('usage database failure fails closed without a Cloudflare request', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  t.mock.method(AIUsageDaily, 'findOneAndUpdate', async () => { throw new Error('database detail'); });
  let cloudflareCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (new URL(url).hostname === 'api.cloudflare.com') cloudflareCalls += 1;
    return jsonResponse({}, 429);
  });
  const { generateJson } = await importAiService();
  await assert.rejects(generateJson('prompt'), { code: 'AI_SERVICE_UNAVAILABLE' });
  assert.equal(cloudflareCalls, 0);
});

test('returned invalid analytics plan is left to feature validation without another provider', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return geminiSuccess('{"status":"ready","operations":[{"capability":"run_mongo_query"}]}');
  });
  const { generateJson } = await importAiService();
  const result = await generateJson('plan prompt');
  assert.equal(validateAnalyticsPlan(result), null);
  assert.equal(calls, 1);
});

test('embeddings always call Gemini even when fallback is enabled', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  let url;
  t.mock.method(globalThis, 'fetch', async (requestUrl) => {
    url = String(requestUrl);
    return jsonResponse({ embeddings: [{ values: [0.1, 0.2] }] });
  });
  const { embedTexts } = await importAiService();
  assert.deepEqual(await embedTexts(['only Gemini'], 'RETRIEVAL_QUERY'), [[0.1, 0.2]]);
  assert.match(url, /generativelanguage\.googleapis\.com/);
  assert.doesNotMatch(url, /cloudflare/);
});

test('fallback logs exclude prompts, personal data, outputs, and credentials', async (t) => {
  const restore = setEnvironment();
  t.after(restore);
  mockUsageReservation(t);
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  t.mock.method(console, 'error', (...args) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async (url) =>
    new URL(url).hostname === 'api.cloudflare.com' ? cloudflareSuccess('{"employee":"PERSONAL OUTPUT"}') : jsonResponse({}, 429));
  const { generateJson } = await importAiService();
  await generateJson('prompt with Ada Person and leave details');
  const serializedLogs = JSON.stringify(logs);
  for (const secret of ['Ada Person', 'leave details', 'PERSONAL OUTPUT', 'test-gemini-key', 'test-cloudflare-token']) {
    assert.equal(serializedLogs.includes(secret), false);
  }
});
