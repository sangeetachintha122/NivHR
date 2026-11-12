import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudflareUsageCounterTracker } from './cloudflareUsageCounterTracker.js';

const makeCounterModel = (initialRecords = []) => {
  const records = new Map(initialRecords.map((record) => [record._id, { ...record }]));
  const updateCalls = [];
  return {
    records,
    updateCalls,
    findById(id) {
      const record = records.get(id);
      return { lean: async () => (record ? { ...record } : null) };
    },
    async findOneAndUpdate(filter, update) {
      const record = records.get(filter._id) || { _id: filter._id, count: 0 };
      record.count += update.$inc.count;
      records.set(filter._id, record);
      return { ...record };
    },
    async updateOne(filter, update) {
      updateCalls.push({ filter: { ...filter }, update: { ...update } });
      const record = records.get(filter._id);
      if (!record || record.count !== filter.count) return { modifiedCount: 0 };
      record.count += update.$inc.count;
      return { modifiedCount: 1 };
    },
  };
};

const installTracker = (tracker, model) => {
  const originalFindOneAndUpdate = model.findOneAndUpdate;
  model.findOneAndUpdate = tracker.wrapFindOneAndUpdate(originalFindOneAndUpdate);
  // The wrapped method's receiver contains the tracker; bind the fake model behavior explicitly.
  return async (filter, update) => model.findOneAndUpdate.call(model, filter, update);
};

test('tracks the reservation UTC record after a midnight boundary and restores only that day', async () => {
  const priorUtcDay = '2042-07-19';
  const reservationUtcDay = '2042-07-20';
  const model = makeCounterModel([{ _id: priorUtcDay, count: 5 }]);
  const tracker = new CloudflareUsageCounterTracker(model);
  const reserve = installTracker(tracker, model);

  await reserve({ _id: reservationUtcDay }, { $inc: { count: 1 } });

  assert.equal(tracker.recordId, reservationUtcDay);
  assert.equal(tracker.baselineCount, 0);
  assert.equal(await tracker.verifySingleReservation(), true);
  assert.equal(await tracker.restoreTrackedReservation(), true);
  assert.equal(model.records.get(priorUtcDay).count, 5);
  assert.equal(model.records.get(reservationUtcDay).count, 0);
  assert.deepEqual(model.updateCalls, [{
    filter: { _id: reservationUtcDay, count: 1 },
    update: { $inc: { count: -1 } },
  }]);
});

test('cleanup refuses to change a counter whose count advanced concurrently', async () => {
  const day = '2042-07-20';
  const model = makeCounterModel([{ _id: day, count: 8 }]);
  const tracker = new CloudflareUsageCounterTracker(model);
  const reserve = installTracker(tracker, model);

  await reserve({ _id: day }, { $inc: { count: 1 } });
  model.records.get(day).count += 1;

  assert.equal(await tracker.verifySingleReservation(), false);
  assert.equal(await tracker.restoreTrackedReservation(), false);
  assert.equal(model.records.get(day).count, 10);
  assert.equal(model.updateCalls.length, 0);
});

test('cleanup refuses to touch counters if the smoke observes multiple UTC record IDs', async () => {
  const firstDay = '2042-07-19';
  const secondDay = '2042-07-20';
  const model = makeCounterModel();
  const tracker = new CloudflareUsageCounterTracker(model);
  const reserve = installTracker(tracker, model);

  await reserve({ _id: firstDay }, { $inc: { count: 1 } });
  await reserve({ _id: secondDay }, { $inc: { count: 1 } });

  assert.equal(tracker.hasRecordIdConflict, true);
  assert.equal(await tracker.verifySingleReservation(), false);
  assert.equal(await tracker.restoreTrackedReservation(), false);
  assert.equal(model.records.get(firstDay).count, 1);
  assert.equal(model.records.get(secondDay).count, 1);
  assert.equal(model.updateCalls.length, 0);
});

test('cleanup fails closed when a reservation write has an ambiguous result', async () => {
  const day = '2042-07-20';
  const model = makeCounterModel();
  const tracker = new CloudflareUsageCounterTracker(model);
  model.findOneAndUpdate = async () => {
    const error = new Error('synthetic write outcome ambiguity');
    error.code = 91;
    throw error;
  };
  const reserve = tracker.wrapFindOneAndUpdate(model.findOneAndUpdate);

  await assert.rejects(reserve.call(model, { _id: day }, { $inc: { count: 1 } }));

  assert.equal(await tracker.restoreTrackedReservation(), false);
  assert.equal(model.updateCalls.length, 0);
});
