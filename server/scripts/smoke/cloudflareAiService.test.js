import assert from 'node:assert/strict';
import test from 'node:test';
import { CLOUDFLARE_AI_MODEL } from '../../src/config/aiProvider.js';
import { generateCloudflareJson } from '../../src/services/cloudflareAiService.js';

const config = {
  accountId: 'b'.repeat(32),
  apiToken: 'test-token',
  model: CLOUDFLARE_AI_MODEL,
  timeoutMs: 30000,
};

test('Cloudflare request uses the fixed Workers AI endpoint, bearer auth, and JSON mode', async () => {
  let captured;
  const result = await generateCloudflareJson('prompt', config, async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({ success: true, result: { response: '{"ok":true}' } }));
  });

  assert.deepEqual(result, { ok: true });
  assert.match(captured.url, /api\.cloudflare\.com\/client\/v4\/accounts\/b{32}\/ai\/run\/@cf\/meta\/llama-3\.3-70b-instruct-fp8-fast$/);
  assert.equal(captured.options.headers.authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(captured.options.body).response_format, { type: 'json_object' });
});

test('Cloudflare JSON Mode structured response object is returned without stringifying', async () => {
  const structuredResponse = { status: 'ok', probe: 'synthetic' };
  const result = await generateCloudflareJson('synthetic prompt', config, async () =>
    new Response(JSON.stringify({ success: true, result: { response: structuredResponse } })));

  assert.deepEqual(result, structuredResponse);
});

test('Cloudflare accepts Markdown-fenced JSON string responses', async () => {
  const result = await generateCloudflareJson('synthetic prompt', config, async () =>
    new Response(JSON.stringify({ success: true, result: { response: '```json\n{"status":"ok"}\n```' } })));

  assert.deepEqual(result, { status: 'ok' });
});

test('Cloudflare rejects malformed structured response types and envelopes', async () => {
  const invalidPayloads = [
    { success: true, result: { response: [] } },
    { success: true, result: { response: null } },
    { success: true, result: { response: 42 } },
    { success: true, result: { response: false } },
    { success: true, result: {} },
    { success: false, result: { response: { status: 'ok' } } },
    { success: true, result: { response: 'not JSON' } },
  ];

  for (const payload of invalidPayloads) {
    await assert.rejects(generateCloudflareJson('synthetic prompt', config, async () =>
      new Response(JSON.stringify(payload))),
    (error) => error.category === 'malformed_response' && error.message === 'AI service unavailable');
  }
});

test('Cloudflare timeout, HTTP failure, and malformed responses return sanitized typed errors', async () => {
  await assert.rejects(generateCloudflareJson('prompt', config, async () => {
    const error = new Error('sensitive request details');
    error.name = 'AbortError';
    throw error;
  }), (error) => error.category === 'timeout' && error.message === 'AI service unavailable');

  await assert.rejects(generateCloudflareJson('prompt', config, async () =>
    new Response('private provider body', { status: 500 })),
  (error) => error.category === 'http_5xx' && error.httpStatus === 500 && !error.message.includes('private'));

  await assert.rejects(generateCloudflareJson('prompt', config, async () =>
    new Response(JSON.stringify({ success: false, errors: ['sensitive details'] }))),
  (error) => error.category === 'malformed_response' && error.message === 'AI service unavailable');

  await assert.rejects(generateCloudflareJson('prompt', config, async () =>
    new Response(JSON.stringify({ success: true, result: { response: 'not JSON' } }))),
  (error) => error.category === 'malformed_response');
});

test('Cloudflare provider rejects an arbitrary model and does not call fetch', async () => {
  let calls = 0;
  await assert.rejects(generateCloudflareJson('prompt', { ...config, model: 'another/model' }, async () => {
    calls += 1;
  }), (error) => error.category === 'configuration');
  assert.equal(calls, 0);
});

test('malformed caller input is a TypeError and does not call fetch', async () => {
  let calls = 0;
  await assert.rejects(generateCloudflareJson('  ', config, async () => { calls += 1; }), TypeError);
  assert.equal(calls, 0);
});
