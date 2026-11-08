import assert from 'node:assert/strict';
import test from 'node:test';
import { getIndiaDate, isLateCheckIn, isWorkingDay } from '../../src/config/attendanceConfig.js';

test('Friday check-in at 09:30:00 IST is not late', () => {
  const fridayAtOfficeStart = new Date('2026-11-06T04:00:00.000Z');
  assert.equal(getIndiaDate(fridayAtOfficeStart), '2026-11-06');
  assert.equal(isLateCheckIn(fridayAtOfficeStart), false);
});

test('Friday check-in at 09:30:01 IST is late', () => {
  const fridayAfterOfficeStart = new Date('2026-11-06T04:00:01.000Z');
  assert.equal(getIndiaDate(fridayAfterOfficeStart), '2026-11-06');
  assert.equal(isLateCheckIn(fridayAfterOfficeStart), true);
});

test('Saturday is rejected as a non-working day', () => {
  const saturdayInIndia = new Date('2026-11-06T18:45:00.000Z');
  const indiaDate = getIndiaDate(saturdayInIndia);
  assert.equal(indiaDate, '2026-11-07');
  assert.equal(isWorkingDay(indiaDate), false);
});

test('IST date can be the next calendar day while the UTC date is still Friday', () => {
  const timestamp = new Date('2026-11-06T18:45:00.000Z');
  assert.equal(timestamp.toISOString().slice(0, 10), '2026-11-06');
  assert.equal(getIndiaDate(timestamp), '2026-11-07');
});
