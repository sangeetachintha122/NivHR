import assert from 'node:assert/strict';
import test from 'node:test';
import ActivityEvent from '../../src/models/ActivityEvent.js';
import LeaveRequest from '../../src/models/LeaveRequest.js';
import User from '../../src/models/User.js';
import { decideLeave } from '../../src/services/leaveService.js';

const leaveId = '507f1f77bcf86cd799439011';
const employeeId = '507f1f77bcf86cd799439012';
const reviewerId = '507f1f77bcf86cd799439013';

const makeLeave = (status = 'pending') => ({
  _id: leaveId,
  employeeId,
  type: 'annual',
  fromDate: new Date('2026-12-01T00:00:00.000Z'),
  toDate: new Date('2026-12-01T00:00:00.000Z'),
  totalDays: 1,
  reason: 'test fixture',
  status,
  reviewedBy: reviewerId,
  reviewedAt: new Date('2026-11-12T00:00:00.000Z'),
  rejectionReason: 'Not approved',
});

const mockRejectWorkflow = (t, { metadataFails, activityFails }) => {
  const pending = makeLeave();
  const rejected = makeLeave('rejected');
  let userLookupCount = 0;
  t.mock.method(LeaveRequest, 'findById', async () => pending);
  t.mock.method(LeaveRequest, 'findOneAndUpdate', async () => rejected);
  t.mock.method(ActivityEvent, 'create', async () => {
    if (activityFails) throw new Error('simulated event-store failure');
    return {};
  });
  t.mock.method(User, 'findById', () => {
    userLookupCount += 1;
    let query;
    query = {
      select: () => query,
      lean: async () => {
        if (metadataFails && userLookupCount === 1) throw new Error('simulated optional metadata failure');
        return null;
      },
    };
    return query;
  });
  return { rejected };
};

for (const scenario of [
  { name: 'optional department lookup fails', metadataFails: true, activityFails: false },
  { name: 'activity event persistence fails', metadataFails: false, activityFails: true },
]) {
  test(`legitimate leave rejection succeeds when ${scenario.name}`, async (t) => {
    const { rejected } = mockRejectWorkflow(t, scenario);
    const result = await decideLeave({
      leaveId,
      decision: 'rejected',
      rejectionReason: 'Not approved',
      reviewedBy: reviewerId,
    });
    assert.equal(result.id, rejected._id);
    assert.equal(result.status, 'rejected');
    await new Promise((resolve) => setImmediate(resolve));
  });
}

test('leave rejection still enforces the existing pending-state rule', async (t) => {
  t.mock.method(LeaveRequest, 'findById', async () => makeLeave('approved'));
  await assert.rejects(
    decideLeave({ leaveId, decision: 'rejected', rejectionReason: 'Not approved', reviewedBy: reviewerId }),
    (error) => error.statusCode === 409,
  );
});
