import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayToDate, dateToDay, localToUtcNaive, utcNaiveToLocal, minutesOf, formatClock, speakTime } from '../dates.mjs';

test('dayToDate and dateToDay round-trip event days', () => {
  assert.equal(dayToDate('tuesday'), '2026-12-01');
  assert.equal(dayToDate('Tuesday'), '2026-12-01');
  assert.equal(dateToDay('2026-12-01'), 'tuesday');
  assert.equal(dayToDate('nope'), null);
});

test('localToUtcNaive converts Las Vegas time (PST, UTC-8) to UTC', () => {
  assert.equal(localToUtcNaive('2026-12-01', '09:00'), '2026-12-01T17:00:00');
});

test('utcNaiveToLocal is the inverse of localToUtcNaive', () => {
  const local = utcNaiveToLocal(localToUtcNaive('2026-12-03', '14:30'));
  assert.deepEqual(local, { date: '2026-12-03', time: '14:30' });
});

test('minutesOf and formatClock', () => {
  assert.equal(minutesOf('14:30'), 870);
  assert.equal(formatClock('14:00'), '2pm');
  assert.equal(formatClock('09:15'), '9:15am');
});

test('speakTime names the event day, never UTC', () => {
  assert.equal(speakTime('2026-12-01', '14:00'), 'Tuesday at 2pm');
});
