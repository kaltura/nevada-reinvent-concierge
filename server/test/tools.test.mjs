import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_HANDLERS, awsProblem } from '../tools.mjs';
import { AwsError } from '../aws.mjs';
import { makeCatalog } from '../catalog.mjs';

const FIXTURES = [
  {
    sessionId: 'AAA111', title: 'Deep dive on Lambda', abbreviation: 'COM301',
    type: 'session', level: '301', venue: 'MGM Grand', room: 'Grand 1',
    tracks: ['Compute'], seatAvailability: 'available', isReservable: true,
    sessionTime: { date: '2026-12-01', time: '09:00', length: 60 },
    speakers: [{ name: 'Alex Doe' }],
  },
  {
    sessionId: 'AAA111-R1', title: 'Deep dive on Lambda [repeat]', abbreviation: 'COM301-R1',
    type: 'session', level: '301', venue: 'Wynn', room: 'Wynn 2',
    tracks: ['Compute'], seatAvailability: 'available', isReservable: true,
    sessionTime: { date: '2026-12-02', time: '14:00', length: 60 },
    speakers: [{ name: 'Alex Doe' }],
  },
  {
    sessionId: 'BBB222', title: 'Kubernetes at scale', abbreviation: 'CON302',
    type: 'session', level: '302', venue: 'The Venetian', room: 'Venetian 3',
    tracks: ['Containers'], seatAvailability: 'few seats left', isReservable: true,
    sessionTime: { date: '2026-12-01', time: '09:30', length: 60 },
    speakers: [{ name: 'Sam Lee' }],
  },
  {
    sessionId: 'DDD444', title: 'Wildcard: Reality-TV panel', abbreviation: 'WLD303',
    type: 'session', tracks: ['Media'], speakers: [],
  },
];

function catalogWithFixtures() {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  return catalog;
}

// awsProblem says "opens on 8 October" for every AWS or network error before then, so
// tests of the other wording pin the clock to after it.
const afterApiOpens = (t) => t.mock.method(Date, 'now', () => Date.parse('2026-10-09T12:00:00Z'));

/** Stubs ctx.withToken to return queued outcomes/errors in order, without touching aws.mjs. */
function ctxWith(catalog, outcomes) {
  let i = 0;
  return {
    catalog,
    async withToken() {
      const out = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

test('get_topics reports the catalog\'s real top topics by frequency', async () => {
  const catalog = makeCatalog();
  catalog.seed([
    { sessionId: 'S1', title: 'One', topics: ['Serverless', 'AI'] },
    { sessionId: 'S2', title: 'Two', topics: ['Serverless'] },
    { sessionId: 'S3', title: 'Three', topics: ['Containers'] },
  ]);
  const ctx = { catalog, withToken: async () => { throw new Error('not used'); } };
  const result = await TOOL_HANDLERS.get_topics({}, ctx);
  assert.equal(result.answer, 'The most common topics right now: Serverless, AI, Containers.');
});

test('get_topics has a fallback answer for an empty catalog', async () => {
  const ctx = { catalog: makeCatalog(), withToken: async () => { throw new Error('not used'); } };
  const result = await TOOL_HANDLERS.get_topics({}, ctx);
  assert.equal(result.answer, "I don't have the catalog loaded yet. Try again in a moment.");
});

test('search_sessions reports no match and a formatted match', async () => {
  const catalog = catalogWithFixtures();
  const ctx = { catalog, withToken: async () => { throw new Error('not used'); } };
  const none = await TOOL_HANDLERS.search_sessions({ query: 'nothing matches this' }, ctx);
  assert.equal(none.answer, 'No sessions matched that. Try different words or drop a filter.');
  const some = await TOOL_HANDLERS.search_sessions({ query: 'kubernetes' }, ctx);
  assert.equal(some.answer, 'Found: Kubernetes at scale (session BBB222), Tuesday at 9:30am, VEN, few seats left.');
});

test('search_sessions says the catalog is not loaded instead of "no match" when it is empty', async () => {
  const ctx = { catalog: makeCatalog(), withToken: async () => { throw new Error('not used'); } };
  const result = await TOOL_HANDLERS.search_sessions({ query: 'lambda' }, ctx);
  assert.equal(result.answer, "I don't have the catalog loaded yet. Try again in a minute.");
});

test('search_sessions wildcard mode has its own no-match message', async () => {
  const catalog = catalogWithFixtures();
  const ctx = { catalog, withToken: async () => { throw new Error('not used'); } };
  const none = await TOOL_HANDLERS.search_sessions({ query: 'session', mode: 'wildcard' }, ctx);
  assert.equal(none.answer, "I couldn't find a wildcard pick right now.");
});

test('get_session reports an unknown id and a known one with its repeat', async () => {
  const catalog = catalogWithFixtures();
  const ctx = { catalog, withToken: async () => { throw new Error('not used'); } };
  const unknown = await TOOL_HANDLERS.get_session({ sessionId: 'ZZZ' }, ctx);
  assert.equal(unknown.answer, "I don't have that session. Search first, then ask again with its ID.");
  const known = await TOOL_HANDLERS.get_session({ sessionId: 'AAA111' }, ctx);
  assert.equal(known.answer, 'Deep dive on Lambda (session AAA111), Tuesday at 9am, MGM, level 301, available, repeats: Deep dive on Lambda [repeat] (session AAA111-R1).');
});

test('get_my_schedule asks to pair when there is no token', async () => {
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: false }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Connect your AWS Events account to do that.');
});

test('get_my_schedule turns an AwsError into a spoken message instead of throwing', async (t) => {
  afterApiOpens(t);
  const ctx = ctxWith(catalogWithFixtures(), [new AwsError(500)]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'AWS is busy. Try again in a minute.');
});

test('get_my_schedule speaks reserved and favorited sessions in time order, flagging their overlap', async () => {
  // AAA111 (9-10am) and BBB222 (9:30-10:30am) genuinely overlap in the
  // fixtures, so this exercises the clash branch, not a "tight" gap.
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: true, result: { reserved: ['AAA111'], favorites: ['BBB222'], personalTime: [] } }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Tuesday at 9am: Deep dive on Lambda (reserved). clashes with Kubernetes at scale. Tuesday at 9:30am: Kubernetes at scale (favorited).');
});

test('get_my_schedule appends undated favorites, but only when no day was asked for', async () => {
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: true, result: { reserved: [], favorites: ['DDD444'], personalTime: [] } }]);
  const wholeWeek = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(wholeWeek.answer, 'Nothing on your schedule yet. Also favorited, not yet scheduled: Wildcard: Reality-TV panel.');

  const dayCtx = ctxWith(catalogWithFixtures(), [{ paired: true, result: { reserved: [], favorites: ['DDD444'], personalTime: [] } }]);
  const oneDay = await TOOL_HANDLERS.get_my_schedule({ day: 'monday' }, dayCtx);
  assert.equal(oneDay.answer, 'Nothing scheduled monday.');
});

test('get_my_schedule speaks a tight-connection warning when sessions do not overlap but travel does not fit', async () => {
  const catalog = makeCatalog();
  catalog.seed([
    { sessionId: 'X1', title: 'Session one', venue: 'MGM Grand', sessionTime: { date: '2026-12-01', time: '09:00', length: 60 } },
    { sessionId: 'X2', title: 'Session two', venue: 'The Venetian', sessionTime: { date: '2026-12-01', time: '10:10', length: 60 } },
  ]);
  const ctx = ctxWith(catalog, [{ paired: true, result: { reserved: ['X1', 'X2'], favorites: [], personalTime: [] } }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Tuesday at 9am: Session one (reserved). tight: only 10 minutes from MGM to VEN, usually needs 35. Tuesday at 10:10am: Session two (reserved).');
});

test('get_my_schedule speaks a clash when personal time overlaps a reserved session', async () => {
  const personalTime = [{ personalTimeId: 'pt1', title: 'Team lunch', startDateTime: '2026-12-01T17:15:00', endDateTime: '2026-12-01T18:00:00' }];
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: true, result: { reserved: ['AAA111'], favorites: [], personalTime } }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Tuesday at 9am: Deep dive on Lambda (reserved). clashes with Team lunch. Tuesday at 9:15am: Team lunch (personal time pt1) (blocked).');
});

test('get_my_schedule flags a clash for a personal block that crosses midnight', async () => {
  const catalog = makeCatalog();
  catalog.seed([
    { sessionId: 'X3', title: 'Post-midnight session', venue: 'MGM Grand', sessionTime: { date: '2026-12-01', time: '23:50', length: 60 } },
  ]);
  // UTC naive 07:00-09:00 Dec 2 is Vegas local 11pm Dec 1 to 1am Dec 2.
  const personalTime = [{ personalTimeId: 'pt3', title: 'Red-eye arrival', startDateTime: '2026-12-02T07:00:00', endDateTime: '2026-12-02T09:00:00' }];
  const ctx = ctxWith(catalog, [{ paired: true, result: { reserved: ['X3'], favorites: [], personalTime } }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Tuesday at 11pm: Red-eye arrival (personal time pt3) (blocked). clashes with Post-midnight session. Tuesday at 11:50pm: Post-midnight session (reserved).');
});

test('get_my_schedule flags a clash when the next item is dated the next calendar day', async () => {
  const catalog = makeCatalog();
  catalog.seed([
    { sessionId: 'X4', title: 'Post-midnight session', venue: 'MGM Grand', sessionTime: { date: '2026-12-02', time: '00:15', length: 30 } },
  ]);
  // UTC naive 07:00-09:00 Dec 2 is Vegas local 11pm Dec 1 to 1am Dec 2.
  const personalTime = [{ personalTimeId: 'pt4', title: 'Red-eye arrival', startDateTime: '2026-12-02T07:00:00', endDateTime: '2026-12-02T09:00:00' }];
  const ctx = ctxWith(catalog, [{ paired: true, result: { reserved: ['X4'], favorites: [], personalTime } }]);
  const result = await TOOL_HANDLERS.get_my_schedule({}, ctx);
  assert.equal(result.answer, 'Tuesday at 11pm: Red-eye arrival (personal time pt4) (blocked). clashes with Post-midnight session. Wednesday at 12:15am: Post-midnight session (reserved).');
});

test('favorite_sessions requires ids and reports the AWS result', async () => {
  const catalog = catalogWithFixtures();
  const noIds = await TOOL_HANDLERS.favorite_sessions({ ids: [] }, ctxWith(catalog, []));
  assert.equal(noIds.answer, 'Tell me which sessions to favorite.');
  const ok = await TOOL_HANDLERS.favorite_sessions({ ids: ['AAA111'] }, ctxWith(catalog, [{ paired: true, result: { successful: ['AAA111'], failed: [] } }]));
  assert.equal(ok.answer, 'Favorited Deep dive on Lambda (session AAA111).');
});

test('favorite_sessions flags a session AWS has not scheduled yet', async () => {
  const catalog = catalogWithFixtures();
  const one = await TOOL_HANDLERS.favorite_sessions({ ids: ['DDD444'] }, ctxWith(catalog, [{ paired: true, result: { successful: ['DDD444'], failed: [] } }]));
  assert.equal(one.answer, 'Favorited Wildcard: Reality-TV panel (session DDD444). Wildcard: Reality-TV panel (session DDD444) doesn\'t have a time yet, so I put it under "not yet scheduled" instead of on a day.');

  const two = await TOOL_HANDLERS.favorite_sessions({ ids: ['AAA111', 'DDD444'] }, ctxWith(catalog, [{ paired: true, result: { successful: ['AAA111', 'DDD444'], failed: [] } }]));
  assert.match(two.answer, /Wildcard: Reality-TV panel \(session DDD444\) doesn't have a time yet/);
});

test('favorite_sessions turns an AwsError into a spoken message', async (t) => {
  afterApiOpens(t);
  const ctx = ctxWith(catalogWithFixtures(), [new AwsError(429, 'rate_limited')]);
  const result = await TOOL_HANDLERS.favorite_sessions({ ids: ['AAA111'] }, ctx);
  assert.equal(result.answer, 'AWS is busy. Try again in a minute.');
});

test('unfavorite_session reconciles an uncertain 500 by checking the schedule', async () => {
  const catalog = catalogWithFixtures();
  const goneCtx = ctxWith(catalog, [{ paired: true, result: { favorites: ['AAA111'] } }, new AwsError(500), { paired: true, result: { favorites: [] } }]);
  const gone = await TOOL_HANDLERS.unfavorite_session({ id: 'AAA111' }, goneCtx);
  assert.equal(gone.answer, 'Removed Deep dive on Lambda (session AAA111) from favorites.');
  const stillThereCtx = ctxWith(catalog, [{ paired: true, result: { favorites: ['AAA111'] } }, new AwsError(500), { paired: true, result: { favorites: ['AAA111'] } }]);
  const stillThere = await TOOL_HANDLERS.unfavorite_session({ id: 'AAA111' }, stillThereCtx);
  assert.equal(stillThere.answer, "I'm not sure that went through. Ask for your schedule to check.");
});

test('unfavorite_session and cancel_reservation report plainly when the id was never there, without calling AWS to remove it', async () => {
  const catalog = catalogWithFixtures();
  const unfav = await TOOL_HANDLERS.unfavorite_session({ id: 'AAA111' }, ctxWith(catalog, [{ paired: true, result: { favorites: [] } }]));
  assert.equal(unfav.answer, "I can't find that in your favorites. Ask for your schedule to see current ones.");
  const cancel = await TOOL_HANDLERS.cancel_reservation({ id: 'AAA111' }, ctxWith(catalog, [{ paired: true, result: { reserved: [] } }]));
  assert.equal(cancel.answer, "I can't find that reservation. Ask for your schedule to see current ones.");
});

test('reserve_sessions on a 409 favorites instead and says so', async () => {
  const catalog = catalogWithFixtures();
  const keptCtx = ctxWith(catalog, [new AwsError(409), { paired: true, result: { successful: ['AAA111'], failed: [] } }]);
  const kept = await TOOL_HANDLERS.reserve_sessions({ ids: ['AAA111'] }, keptCtx);
  assert.equal(kept.answer, "Reserved seating isn't open yet. I favorited that instead so it's easy to book once it opens.");

  const failedCtx = ctxWith(catalog, [new AwsError(409), { paired: true, result: { successful: [], failed: [{ sessionId: 'AAA111', code: 'other' }] } }]);
  const failed = await TOOL_HANDLERS.reserve_sessions({ ids: ['AAA111'] }, failedCtx);
  assert.equal(failed.answer, "Reserved seating isn't open yet.");
});

test('reserve_sessions on a 409 favorite-fallback still flags a schedule clash', async () => {
  const catalog = catalogWithFixtures();
  const ctx = ctxWith(catalog, [
    new AwsError(409),
    { paired: true, result: { successful: ['AAA111'], failed: [] } },
    { paired: true, result: { reserved: ['BBB222'], favorites: [] } },
  ]);
  const result = await TOOL_HANDLERS.reserve_sessions({ ids: ['AAA111'] }, ctx);
  assert.match(result.answer, /clashes with Kubernetes at scale/);
});

test('reserve_sessions still reports a reserved seat when the follow-up schedule read fails', async () => {
  const ctx = ctxWith(catalogWithFixtures(), [
    { paired: true, result: { successful: ['AAA111'], failed: [{ sessionId: 'BBB222', code: 'scheduleConflict', conflictsWith: ['AAA111'] }] } },
    new AwsError(503),
  ]);
  const result = await TOOL_HANDLERS.reserve_sessions({ ids: ['AAA111', 'BBB222'] }, ctx);
  assert.match(result.answer, /^Reserved Deep dive on Lambda \(session AAA111\)\./);
});

test('reserve_sessions checks every id given, not just the first 10', async () => {
  const catalog = catalogWithFixtures();
  const ids = Array.from({ length: 12 }, (_, i) => `S${i}`);
  const ctx = ctxWith(catalog, [{ paired: true, result: { successful: [], failed: [] } }]);
  const result = await TOOL_HANDLERS.reserve_sessions({ ids }, ctx);
  assert.match(result.answer, /session S11\./);
});

test('reserve_sessions says nothing was reserved when every id is unknown', async () => {
  const result = await TOOL_HANDLERS.reserve_sessions({ ids: ['S1', 'S2'] }, ctxWith(catalogWithFixtures(), []));
  assert.match(result.answer, /^Nothing was reserved, /);
});

test('unfavorite_session and cancel_reservation reconcile an uncertain 404 for an id that genuinely existed, not just 500', async () => {
  const catalog = catalogWithFixtures();
  const gone = await TOOL_HANDLERS.unfavorite_session({ id: 'AAA111' }, ctxWith(catalog, [{ paired: true, result: { favorites: ['AAA111'] } }, new AwsError(404), { paired: true, result: { favorites: [] } }]));
  assert.equal(gone.answer, 'Removed Deep dive on Lambda (session AAA111) from favorites.');
  const cancelled = await TOOL_HANDLERS.cancel_reservation({ id: 'AAA111' }, ctxWith(catalog, [{ paired: true, result: { reserved: ['AAA111'] } }, new AwsError(404), { paired: true, result: { reserved: [] } }]));
  assert.equal(cancelled.answer, 'Cancelled Deep dive on Lambda (session AAA111).');
});

test('a 403 with a non-object body is a generic block, not "not registered"', async (t) => {
  afterApiOpens(t);
  const ctx = ctxWith(catalogWithFixtures(), [new AwsError(403, undefined, 'plain text from a WAF')]);
  const result = await TOOL_HANDLERS.favorite_sessions({ ids: ['AAA111'] }, ctx);
  assert.equal(result.answer, 'AWS blocked that just now. Try again in a minute.');
});

test('reserve_sessions speaks a scheduling conflict with a swap option', async () => {
  const catalog = catalogWithFixtures();
  const ctx = ctxWith(catalog, [
    { paired: true, result: { successful: [], failed: [{ sessionId: 'BBB222', code: 'scheduleConflict', conflictsWith: ['AAA111'] }] } },
    { paired: true, result: { reserved: ['AAA111'] } },
  ]);
  const result = await TOOL_HANDLERS.reserve_sessions({ ids: ['BBB222'] }, ctx);
  assert.equal(result.answer, 'Kubernetes at scale (session BBB222) clashes with Deep dive on Lambda (session AAA111). Options: swap out Deep dive on Lambda (session AAA111) and keep Kubernetes at scale (session BBB222).');
});

test('cancel_reservation reconciles an uncertain 500', async () => {
  const catalog = catalogWithFixtures();
  const ctx = ctxWith(catalog, [{ paired: true, result: { reserved: ['AAA111'] } }, new AwsError(500), { paired: true, result: { reserved: [] } }]);
  const result = await TOOL_HANDLERS.cancel_reservation({ id: 'AAA111' }, ctx);
  assert.equal(result.answer, 'Cancelled Deep dive on Lambda (session AAA111).');
});

test('swap_reservation reports success and restores the dropped seat on failure', async () => {
  const catalog = catalogWithFixtures();
  const okCtx = ctxWith(catalog, [
    { paired: true, result: null },
    { paired: true, result: { successful: ['BBB222'], failed: [] } },
  ]);
  const ok = await TOOL_HANDLERS.swap_reservation({ dropId: 'AAA111', addId: 'BBB222' }, okCtx);
  assert.equal(ok.answer, 'Swapped. Reserved Kubernetes at scale (session BBB222), dropped Deep dive on Lambda (session AAA111).');

  const failCtx = ctxWith(catalog, [
    { paired: true, result: null },
    { paired: true, result: { successful: [], failed: [{ sessionId: 'BBB222', code: 'sessionFull' }] } },
    { paired: true, result: { successful: ['AAA111'] } },
  ]);
  const fail = await TOOL_HANDLERS.swap_reservation({ dropId: 'AAA111', addId: 'BBB222' }, failCtx);
  assert.equal(fail.answer, 'Kubernetes at scale (session BBB222) is full. Kept your seat at Deep dive on Lambda (session AAA111).');
});

test('swap_reservation also restores the dropped seat when re-reserving throws', async () => {
  const catalog = catalogWithFixtures();
  const ctx = ctxWith(catalog, [
    { paired: true, result: null },
    new AwsError(409),
    { paired: true, result: { successful: ['AAA111'] } },
  ]);
  const result = await TOOL_HANDLERS.swap_reservation({ dropId: 'AAA111', addId: 'BBB222' }, ctx);
  assert.equal(result.answer, "Reserving Kubernetes at scale (session BBB222) failed. That's not open right now. Try again later. Kept your seat at Deep dive on Lambda (session AAA111).");
});

test('add_personal_time validates before calling AWS', async () => {
  const ctx = ctxWith(catalogWithFixtures(), []);
  const result = await TOOL_HANDLERS.add_personal_time({ title: '', description: 'x', day: 'tuesday', start: '09:00', end: '10:00' }, ctx);
  assert.equal(result.answer, 'Give it a short title, up to 128 characters.');
});

test('add_personal_time rejects an odd duration and asks for new times instead of a retry', async () => {
  const ctx = ctxWith(catalogWithFixtures(), []);
  const result = await TOOL_HANDLERS.add_personal_time({ title: 'Call', description: 'x', day: 'tuesday', start: '09:00', end: '09:07' }, ctx);
  assert.match(result.answer, /Nothing was blocked\. Ask the attendee for new times/);
});

test('add_personal_time blocks time and speaks back the id read back from the schedule', async () => {
  const created = { personalTimeId: 'pt9', title: 'Lunch', startDateTime: '2026-12-01T20:00:00', endDateTime: '2026-12-01T21:00:00' };
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: true, result: null }, { paired: true, result: { personalTime: [created] } }]);
  const result = await TOOL_HANDLERS.add_personal_time({ title: 'Lunch', description: 'Break', day: 'tuesday', start: '12:00', end: '13:00' }, ctx);
  assert.equal(result.answer, 'Blocked Lunch (personal time pt9), Tuesday at 12pm to 1pm.');
});

test('add_personal_time still speaks back without an id when the read-back does not find a match', async () => {
  const ctx = ctxWith(catalogWithFixtures(), [{ paired: true, result: null }, { paired: true, result: { personalTime: [] } }]);
  const result = await TOOL_HANDLERS.add_personal_time({ title: 'Lunch', description: 'Break', day: 'tuesday', start: '12:00', end: '13:00' }, ctx);
  assert.equal(result.answer, 'Blocked Lunch, Tuesday at 12pm to 1pm.');
});

test('update_personal_time reports an unknown block and updates a known one', async () => {
  const catalog = catalogWithFixtures();
  const missingCtx = ctxWith(catalog, [{ paired: true, result: { personalTime: [] } }]);
  const missing = await TOOL_HANDLERS.update_personal_time({ id: 'nope', end: '13:00' }, missingCtx);
  assert.equal(missing.answer, "I can't find that personal time block. Ask for your schedule to see current ones.");

  const existing = { personalTimeId: 'pt1', title: 'Lunch', description: 'Break', startDateTime: '2026-12-01T20:00:00', endDateTime: '2026-12-01T21:00:00' };
  const okCtx = ctxWith(catalog, [{ paired: true, result: { personalTime: [existing] } }, { paired: true, result: null }]);
  const ok = await TOOL_HANDLERS.update_personal_time({ id: 'pt1', end: '14:00' }, okCtx);
  assert.equal(ok.answer, 'Updated Lunch, now Tuesday at 12pm to 2pm.');
});

test('update_personal_time turns an AwsError from the initial schedule fetch into a spoken message', async (t) => {
  afterApiOpens(t);
  const ctx = ctxWith(catalogWithFixtures(), [new AwsError(429)]);
  const result = await TOOL_HANDLERS.update_personal_time({ id: 'pt1', end: '14:00' }, ctx);
  assert.equal(result.answer, 'AWS is busy. Try again in a minute.');
});

test('update_personal_time edits a midnight-crossing block without touching its times', async () => {
  const catalog = catalogWithFixtures();
  // UTC naive 07:00-09:00 Dec 2 is Vegas local 11pm Dec 1 to 1am Dec 2.
  const existing = { personalTimeId: 'pt2', title: 'Late arrival', description: 'Landing', startDateTime: '2026-12-02T07:00:00', endDateTime: '2026-12-02T09:00:00' };
  const ctx = ctxWith(catalog, [{ paired: true, result: { personalTime: [existing] } }, { paired: true, result: null }]);
  const result = await TOOL_HANDLERS.update_personal_time({ id: 'pt2', title: 'Red-eye arrival' }, ctx);
  assert.equal(result.answer, 'Updated Red-eye arrival, now Tuesday at 11pm to 1am.');
});

test('delete_personal_time rejects an id the schedule does not have', async () => {
  const catalog = catalogWithFixtures();
  const ctx = ctxWith(catalog, [{ paired: true, result: { personalTime: [] } }]);
  const result = await TOOL_HANDLERS.delete_personal_time({ id: 'nope' }, ctx);
  assert.equal(result.answer, "I can't find that personal time block. Ask for your schedule to see current ones.");
});

test('delete_personal_time reconciles an uncertain 500', async () => {
  const catalog = catalogWithFixtures();
  const existing = { personalTimeId: 'pt1', title: 'Lunch', startDateTime: '2026-12-01T20:00:00', endDateTime: '2026-12-01T21:00:00' };
  const ctx = ctxWith(catalog, [
    { paired: true, result: { personalTime: [existing] } },
    new AwsError(500),
    { paired: true, result: { personalTime: [] } },
  ]);
  const result = await TOOL_HANDLERS.delete_personal_time({ id: 'pt1' }, ctx);
  assert.equal(result.answer, 'Removed that block.');
});

test('delete_personal_time reconciles an uncertain 500 when the block is still there', async () => {
  const catalog = catalogWithFixtures();
  const stillThere = { personalTimeId: 'pt1', title: 'Lunch', startDateTime: '2026-12-01T20:00:00', endDateTime: '2026-12-01T21:00:00' };
  const ctx = ctxWith(catalog, [
    { paired: true, result: { personalTime: [stillThere] } },
    new AwsError(500),
    { paired: true, result: { personalTime: [stillThere] } },
  ]);
  const result = await TOOL_HANDLERS.delete_personal_time({ id: 'pt1' }, ctx);
  assert.equal(result.answer, "I'm not sure that went through. Ask for your schedule to check.");
});

test('awsProblem says the schedule opens on 8 October for any AWS error before then', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-07T12:00:00Z'));
  assert.equal(awsProblem(new AwsError(403, 'forbidden', { code: 'forbidden' })), 'AWS opens your schedule to Nevada on 8 October.');
});

test('awsProblem stops saying "opens on 8 October" from midnight Las Vegas time that day', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-08T07:00:00Z'));
  assert.equal(awsProblem(new AwsError(503)), 'AWS is busy. Try again in a minute.');
});

test('awsProblem says not registered for a 403 with a JSON body after the API opens', (t) => {
  afterApiOpens(t);
  assert.equal(awsProblem(new AwsError(403, 'forbidden', { code: 'forbidden' })), 'AWS says you are not registered for re:Invent.');
});

test('awsProblem describes a 404 after the API opens without guessing a cause', (t) => {
  afterApiOpens(t);
  assert.equal(awsProblem(new AwsError(404)), "AWS didn't answer as expected. Try again in a minute.");
});

test('awsProblem says the schedule opens on 8 October for a network error before then', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-07T12:00:00Z'));
  assert.equal(awsProblem(new TypeError('fetch failed')), 'AWS opens your schedule to Nevada on 8 October.');
});

test('awsProblem says AWS cannot be reached for a network error after the API opens', (t) => {
  afterApiOpens(t);
  assert.equal(awsProblem(new TypeError('fetch failed')), "AWS can't be reached right now. Check your internet connection.");
});

test('awsProblem points at the terminal when the token file cannot be saved, even before 8 October', (t) => {
  t.mock.method(Date, 'now', () => Date.parse('2026-10-07T12:00:00Z'));
  const e = Object.assign(new Error('/home/x/.nevada belongs to another user'), { code: 'unsafe_home' });
  assert.equal(awsProblem(e), "Nevada can't save your sign-in on this computer. See the terminal.");
});
