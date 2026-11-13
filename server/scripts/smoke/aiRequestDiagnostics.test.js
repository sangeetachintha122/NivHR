import assert from 'node:assert/strict';
import test from 'node:test';

const environmentNames = [
  'GEMINI_API_KEY',
  'GEMINI_TEXT_MODEL',
  'GEMINI_EMBED_MODEL',
  'CLOUDFLARE_AI_ENABLED',
  'CLOUDFLARE_FALLBACK_ENABLED',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_AI_MODEL',
  'CLOUDFLARE_DAILY_MAX_REQUESTS',
  'CLOUDFLARE_REQUEST_TIMEOUT_MS',
  'NODE_ENV',
];
let importId = 0;

const setupEnvironment = (t) => {
  const previous = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    GEMINI_API_KEY: 'synthetic-api-key-must-not-be-logged',
    GEMINI_TEXT_MODEL: 'synthetic-text-model',
    GEMINI_EMBED_MODEL: 'synthetic-embedding-model',
    CLOUDFLARE_AI_ENABLED: 'false',
    CLOUDFLARE_FALLBACK_ENABLED: 'false',
    NODE_ENV: 'test',
  });
  for (const name of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_MODEL',
    'CLOUDFLARE_DAILY_MAX_REQUESTS', 'CLOUDFLARE_REQUEST_TIMEOUT_MS']) {
    delete process.env[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
};

const captureLogs = (t) => {
  const entries = [];
  t.mock.method(console, 'error', (...args) => entries.push(args));
  t.mock.method(console, 'info', (...args) => entries.push(args));
  return entries;
};

const importAiService = () => import(`../../src/services/aiService.js?request-diagnostics=${importId++}`);

for (const [code, diagnosticCategory] of [
  ['ENOTFOUND', 'dns_resolution_failed'],
  ['EAI_AGAIN', 'dns_resolution_failed'],
  ['CERT_HAS_EXPIRED', 'tls_error'],
  ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls_error'],
  ['ECONNREFUSED', 'connection_refused'],
  ['ECONNRESET', 'connection_interrupted'],
  ['ETIMEDOUT', 'connection_timeout'],
]) {
  test(`Gemini fetch diagnostic safely classifies ${diagnosticCategory}`, async (t) => {
    setupEnvironment(t);
    const logs = captureLogs(t);
    const secretMarker = 'synthetic-prompt-must-not-be-logged';
    t.mock.method(globalThis, 'fetch', async () => {
      throw new TypeError(secretMarker, { cause: { code, message: 'private transport detail' } });
    });

    const { generateJson } = await importAiService();
    await assert.rejects(generateJson(secretMarker, 'policy_answer_generation'), (error) =>
      error.category === 'network_error');

    const failures = logs.filter(([message]) => message === 'AI provider request failed.');
    assert.equal(failures.length, 1);
    const diagnostic = failures[0][1];
    assert.equal(diagnostic.provider, 'gemini');
    assert.equal(diagnostic.stage, 'policy_answer_generation');
    assert.equal(diagnostic.failureCategory, 'network_error');
    assert.equal(diagnostic.diagnosticCategory, diagnosticCategory);
    assert.equal(JSON.stringify(logs).includes(secretMarker), false);
    assert.equal(JSON.stringify(logs).includes('private transport detail'), false);

    const fallback = logs.find(([message, fields]) =>
      message === 'AI provider routing event.' && fields.event === 'fallback_unavailable');
    assert.equal(fallback?.[1].stage, 'policy_answer_generation');
  });
}

test('Policy query embedding reports its stage and never consults Cloudflare', async (t) => {
  setupEnvironment(t);
  const logs = captureLogs(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    throw new TypeError('safe test transport failure', { cause: { code: 'ENOTFOUND' } });
  });

  const { embedTexts } = await importAiService();
  await assert.rejects(
    embedTexts(['synthetic policy question'], 'RETRIEVAL_QUERY', 'policy_query_embedding'),
    (error) => error.category === 'network_error',
  );

  assert.equal(calls, 1);
  const failure = logs.find(([message]) => message === 'AI provider request failed.')?.[1];
  assert.equal(failure?.stage, 'policy_query_embedding');
  assert.equal(failure?.diagnosticCategory, 'dns_resolution_failed');
  assert.equal(logs.some(([message, fields]) =>
    message === 'AI provider routing event.' && fields.provider === 'cloudflare'), false);
});

test('Policy document embedding logs its own stage', async (t) => {
  setupEnvironment(t);
  const logs = captureLogs(t);
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('safe test transport failure', { cause: { code: 'CERT_HAS_EXPIRED' } });
  });

  const { embedTexts } = await importAiService();
  await assert.rejects(
    embedTexts(['synthetic policy content'], 'RETRIEVAL_DOCUMENT', 'policy_document_embedding'),
    (error) => error.category === 'network_error',
  );
  const failure = logs.find(([message]) => message === 'AI provider request failed.')?.[1];
  assert.equal(failure?.stage, 'policy_document_embedding');
  assert.equal(failure?.diagnosticCategory, 'tls_error');
});

test('aborted Gemini calls remain timeout failures and use the same retry count', async (t) => {
  setupEnvironment(t);
  const logs = captureLogs(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    const error = new Error('synthetic abort');
    error.name = 'AbortError';
    throw error;
  });

  const { generateJson } = await importAiService();
  await assert.rejects(generateJson('synthetic prompt', 'policy_answer_generation'), (error) =>
    error.category === 'timeout');

  assert.equal(calls, 2);
  const failures = logs.filter(([message]) => message === 'AI provider request failed.');
  assert.equal(failures.length, 2);
  assert.ok(failures.every(([, fields]) =>
    fields.stage === 'policy_answer_generation' && fields.diagnosticCategory === 'timeout'));
});

test('one-shot connectivity option makes one Gemini attempt after a timeout', async (t) => {
  setupEnvironment(t);
  const logs = captureLogs(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    const error = new Error('synthetic abort');
    error.name = 'AbortError';
    throw error;
  });

  const { generateJson } = await importAiService();
  await assert.rejects(
    generateJson('synthetic connectivity prompt', 'gemini_connectivity_smoke', { maxAttempts: 1 }),
    (error) => error.category === 'timeout',
  );

  assert.equal(calls, 1);
  const failures = logs.filter(([message]) => message === 'AI provider request failed.');
  assert.equal(failures.length, 1);
  assert.equal(failures[0][1].stage, 'gemini_connectivity_smoke');
  assert.equal(failures[0][1].diagnosticCategory, 'timeout');
});
