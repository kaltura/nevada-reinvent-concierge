import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCard, buildTimeline } from '../schedule.mjs';

const LAMBDA = {
  sessionId: 'AAA111', title: 'Deep dive on Lambda', venue: 'MGM', isReservable: true,
  seatAvailability: 'available', sessionTime: { date: '2026-12-01', time: '09:00', length: 60 },
};
const K8S = {
  sessionId: 'BBB222', title: 'Kubernetes at scale', venue: 'Wynn', isReservable: true,
  seatAvailability: 'limited', sessionTime: { date: '2026-12-01', time: '10:00', length: 60 },
};
const LUNCH = { personalTimeId: 'pt1', title: 'Lunch', startDateTime: '2026-12-01T20:00:00', endDateTime: '2026-12-01T21:00:00' };
// UTC naive 07:00-09:00 Dec 2 is Vegas local 11pm Dec 1 to 1am Dec 2.
const LATE_NIGHT = { personalTimeId: 'pt2', title: 'Late arrival', startDateTime: '2026-12-02T07:00:00', endDateTime: '2026-12-02T09:00:00' };

test('sessionCard adds a display day and clock from sessionTime', () => {
  const card = sessionCard(LAMBDA);
  assert.equal(card.day, 'tuesday');
  assert.equal(card.clock, '9am');
});

test('sessionCard leaves day and clock null with no sessionTime', () => {
  const card = sessionCard({ sessionId: 'ZZZ', title: 'TBD' });
  assert.equal(card.day, null);
  assert.equal(card.clock, null);
});

test('buildTimeline orders blocks and inserts a travel tag for a tight gap', () => {
  const timeline = buildTimeline('tuesday', [sessionCard(LAMBDA)], [sessionCard(K8S)], []);
  assert.equal(timeline.day, 'tuesday');
  assert.deepEqual(timeline.blocks.map((b) => b.kind), ['reserved', 'gap', 'favorite']);
  assert.equal(timeline.blocks[0].sessionId, 'AAA111');
  assert.equal(timeline.blocks[1].minutes, 0);
  assert.equal(timeline.blocks[1].tight, true); // MGM to Wynn needs 35 min, gap is 0
  assert.equal(timeline.blocks[2].sessionId, 'BBB222');
});

test('buildTimeline keeps the session code on session blocks', () => {
  const timeline = buildTimeline('tuesday', [sessionCard({ ...LAMBDA, abbreviation: 'SVS401' })], [], []);
  assert.equal(timeline.blocks[0].abbreviation, 'SVS401');
});

test('buildTimeline drops a favorite with no sessionTime instead of erroring', () => {
  const unscheduled = sessionCard({ sessionId: 'DDD444', title: 'TBD panel' });
  const timeline = buildTimeline('tuesday', [sessionCard(LAMBDA)], [unscheduled], []);
  assert.deepEqual(timeline.blocks.map((b) => b.kind), ['reserved']);
});

test('buildTimeline flags an overlap as a clash on both blocks', () => {
  const overlapping = { ...K8S, sessionId: 'CCC333', sessionTime: { date: '2026-12-01', time: '09:30', length: 60 } };
  const timeline = buildTimeline('tuesday', [sessionCard(LAMBDA)], [sessionCard(overlapping)], []);
  assert.equal(timeline.blocks.every((b) => b.kind === 'gap' || b.clash), true);
  assert.deepEqual(timeline.clashDays, ['tuesday']);
});

test('buildTimeline includes personal time and defaults to the earliest day with no day given', () => {
  const timeline = buildTimeline(null, [sessionCard(LAMBDA)], [], [LUNCH]);
  assert.equal(timeline.day, 'tuesday');
  assert.deepEqual(timeline.blocks.map((b) => b.kind), ['reserved', 'gap', 'personal']);
  assert.equal(timeline.blocks[2].title, 'Lunch');
});

test('buildTimeline keeps a positive length for personal time crossing midnight', () => {
  const timeline = buildTimeline('tuesday', [], [], [LATE_NIGHT]);
  assert.equal(timeline.blocks.length, 1);
  assert.equal(timeline.blocks[0].clock, '11pm');
  assert.equal(timeline.blocks[0].length, 120);
});

test('buildTimeline flags a clash across midnight even when the other block is dated the next day', () => {
  // LATE_NIGHT is nominally Tuesday 11pm-1am; this session is dated
  // Wednesday 12:15am, 30 minutes in, which really does overlap it.
  const postMidnight = { sessionId: 'EEE555', title: 'Post-midnight keynote', venue: 'MGM', sessionTime: { date: '2026-12-02', time: '00:15', length: 30 } };
  const reserved = [sessionCard(postMidnight)];
  const tuesday = buildTimeline('tuesday', reserved, [], [LATE_NIGHT]);
  const wednesday = buildTimeline('wednesday', reserved, [], [LATE_NIGHT]);
  assert.equal(tuesday.blocks[0].clash, true);
  assert.equal(wednesday.blocks[0].clash, true);
  assert.deepEqual([...tuesday.clashDays].sort(), ['tuesday', 'wednesday']);
});

test('buildTimeline does not add a spurious tight-gap tile between blocks that already clash across midnight', () => {
  // Overnight session 11pm-1am (crosses midnight, so its relative `end` is
  // 1500, past the 1440-minute day boundary). A 11:45pm favorite at a
  // different venue starts before that overnight session really ends, so
  // they genuinely overlap, already covered by `clash`. A travel/gap tile
  // between two overlapping blocks is meaningless and shouldn't appear.
  const overnight = { sessionId: 'FFF666', title: 'Overnight hackathon judging', venue: 'MGM', isReservable: true, seatAvailability: 'available', sessionTime: { date: '2026-12-01', time: '23:00', length: 120 } };
  const lateFavorite = { sessionId: 'GGG777', title: 'Late show', venue: 'WYN', isReservable: true, seatAvailability: 'available', sessionTime: { date: '2026-12-01', time: '23:45', length: 15 } };
  const timeline = buildTimeline('tuesday', [sessionCard(overnight)], [sessionCard(lateFavorite)], []);
  assert.deepEqual(timeline.blocks.map((b) => b.kind), ['reserved', 'favorite']);
  assert.equal(timeline.blocks[0].clash, true);
  assert.equal(timeline.blocks[1].clash, true);
});

test('buildTimeline falls back to the first event day with nothing scheduled', () => {
  const timeline = buildTimeline(null, [], [], []);
  assert.equal(timeline.day, 'monday');
  assert.deepEqual(timeline.blocks, []);
});
