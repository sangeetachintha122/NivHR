import assert from 'node:assert/strict';
import test from 'node:test';
import ActivityEvent from '../../src/models/ActivityEvent.js';
import { buildActivityEventRecord, recordActivityEvent } from '../../src/services/activityEventService.js';

test('activity event records keep only approved metadata and never retain credentials or request data', () => {
  const record = buildActivityEventRecord({
    eventType: 'login_failed',
    email: 'person@example.com',
    password: 'secret',
    prompt: 'untrusted request',
    metadata: { ip: '127.0.0.1' },
  });
  assert.deepEqual(record, { eventType: 'login_failed' });
  assert.equal(buildActivityEventRecord({ eventType: 'unknown_event' }), null);
});

test('activity event changed fields are allowlisted and deduplicated', () => {
  const record = buildActivityEventRecord({
    eventType: 'employee_updated',
    changedFields: ['email', 'password', 'department', 'email'],
  });
  assert.deepEqual(record.changedFields, ['email', 'department']);
});

test('activity event persistence failure does not throw or report a recorded event', async () => {
  const result = await recordActivityEvent({ eventType: 'logout' }, {
    create: async () => { throw new Error('database failure'); },
  });
  assert.equal(result, false);
});

test('successful activity event persistence reports a recorded event', async () => {
  let saved;
  const result = await recordActivityEvent({ eventType: 'login_success', actorUserId: 'actor' }, {
    create: async (record) => { saved = record; },
  });
  assert.equal(result, true);
  assert.deepEqual(saved, { eventType: 'login_success', actorUserId: 'actor' });
});

test('activity event schema accepts tracked events and rejects sensitive extra fields', async () => {
  await assert.doesNotReject(new ActivityEvent({ eventType: 'login_failed' }).validate());
  assert.throws(() => new ActivityEvent({ eventType: 'login_failed', password: 'secret' }), /strict mode is set to throw/);
});
