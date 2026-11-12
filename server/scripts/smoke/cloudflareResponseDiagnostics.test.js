import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectCloudflareResponse } from './cloudflareResponseDiagnostics.js';

const jsonResponse = (payload, { status = 200, contentType = 'application/json; charset=utf-8' } = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': contentType } });

test('diagnostics return only structure metadata for a valid JSON output', async () => {
  const response = jsonResponse({
    success: true,
    result: { response: '{"answer":"SYNTHETIC_OUTPUT_SECRET"}' },
    errors: [],
    messages: [],
    privateSyntheticKey: 'PRIVATE_VALUE',
  });
  const diagnostics = await inspectCloudflareResponse(response);
  const serialized = JSON.stringify(diagnostics);

  assert.deepEqual(diagnostics, {
    httpStatus: 200,
    contentType: 'application/json',
    topLevelJsonKeys: ['errors', 'messages', 'result', 'success'],
    otherTopLevelKeyCount: 1,
    selectedFieldTypes: { success: 'boolean', result: 'object', 'result.response': 'string' },
    expectedResponseFieldExists: true,
    outputLength: '{"answer":"SYNTHETIC_OUTPUT_SECRET"}'.length,
    parserFailureCategory: 'none',
  });
  assert.equal(serialized.includes('SYNTHETIC_OUTPUT_SECRET'), false);
  assert.equal(serialized.includes('PRIVATE_VALUE'), false);
  assert.equal(serialized.includes('privateSyntheticKey'), false);
});

test('diagnostics accept a structured JSON object response without reporting a parser failure', async () => {
  const response = jsonResponse({
    success: true,
    result: { response: { status: 'ready', operations: [{ capability: 'attendance_summary' }] } },
  });
  const diagnostics = await inspectCloudflareResponse(response);

  assert.deepEqual(diagnostics, {
    httpStatus: 200,
    contentType: 'application/json',
    topLevelJsonKeys: ['result', 'success'],
    otherTopLevelKeyCount: 0,
    selectedFieldTypes: { success: 'boolean', result: 'object', 'result.response': 'object' },
    expectedResponseFieldExists: true,
    outputLength: null,
    parserFailureCategory: 'none',
  });
});

test('diagnostics classify envelope and output parsing failures without exposing values', async () => {
  const cases = [
    [new Response('not json', { status: 200 }), 'envelope_not_json'],
    [jsonResponse({ success: true, result: {} }), 'response_field_missing'],
    [jsonResponse({ success: true, result: { response: '' } }), 'response_empty'],
    [jsonResponse({ success: true, result: { response: 'MODEL_TEXT_SECRET' } }), 'response_not_json'],
    [jsonResponse({ success: true, result: { response: null } }), 'response_field_type_unsupported'],
    [jsonResponse({ success: true, result: { response: [] } }), 'response_field_type_unsupported'],
    [jsonResponse({ success: true, result: { response: 10 } }), 'response_field_type_unsupported'],
    [jsonResponse({ success: true, result: { response: false } }), 'response_field_type_unsupported'],
  ];

  for (const [response, expectedCategory] of cases) {
    const diagnostics = await inspectCloudflareResponse(response);
    assert.equal(diagnostics.parserFailureCategory, expectedCategory);
    assert.equal(JSON.stringify(diagnostics).includes('MODEL_TEXT_SECRET'), false);
  }
});

test('diagnostics report only normalized content type and selected field types', async () => {
  const response = jsonResponse({ success: 'provider value', result: null }, { contentType: 'text/plain; charset=utf-8' });
  const diagnostics = await inspectCloudflareResponse(response);

  assert.equal(diagnostics.contentType, 'text/plain');
  assert.deepEqual(diagnostics.selectedFieldTypes, { success: 'string', result: 'null', 'result.response': 'undefined' });
  assert.equal(diagnostics.parserFailureCategory, 'success_flag_invalid');
  assert.equal(JSON.stringify(diagnostics).includes('provider value'), false);
});
