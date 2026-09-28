import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCatalog, mapVenue, travelMinutes } from '../catalog.mjs';

/** Stubs global fetch to serve pages shaped like AWS's real ListSessions response. */
function fakeAwsPages(pages) {
  let i = 0;
  return async () => {
    const page = pages[i];
    i += 1;
    return { ok: true, status: 200, text: async () => JSON.stringify(page) };
  };
}

const FIXTURES = [
  {
    sessionId: 'AAA111', title: 'Deep dive on Lambda', abbreviation: 'COM301',
    type: 'session', level: '301', venue: 'MGM Grand', room: 'Grand 1',
    tracks: ['Compute'], topics: ['serverless'], seatAvailability: 'available', isReservable: true,
    sessionTime: { date: '2026-12-01', time: '09:00', length: 60 },
    speakers: [{ name: 'Alex Doe' }],
  },
  {
    sessionId: 'AAA111-R1', title: 'Deep dive on Lambda [repeat]', abbreviation: 'COM301-R1',
    type: 'session', level: '301', venue: 'Wynn', room: 'Wynn 2',
    tracks: ['Compute'], topics: ['serverless'], seatAvailability: 'available', isReservable: true,
    sessionTime: { date: '2026-12-02', time: '14:00', length: 60 },
    speakers: [{ name: 'Alex Doe' }],
  },
  {
    sessionId: 'BBB222', title: 'Kubernetes at scale', abbreviation: 'CON302',
    type: 'session', level: '302', venue: 'The Venetian', room: 'Venetian 3',
    tracks: ['Containers'], topics: ['kubernetes'], seatAvailability: 'few seats left', isReservable: true,
    sessionTime: { date: '2026-12-01', time: '09:30', length: 60 },
    speakers: [{ name: 'Sam Lee' }],
  },
];

test('mapVenue maps free text to known venue codes', () => {
  assert.equal(mapVenue('MGM Grand'), 'MGM');
  assert.equal(mapVenue('The Venetian'), 'VEN');
  assert.equal(mapVenue('Somewhere else'), 'Somewhere else');
  assert.equal(mapVenue(null), null);
});

test('travelMinutes is 0 within a venue and looks up known pairs', () => {
  assert.equal(travelMinutes('MGM', 'MGM'), 0);
  assert.equal(travelMinutes('VEN', 'ENC'), 15);
  assert.equal(travelMinutes('MGM', 'WYN'), 35);
  assert.equal(travelMinutes(null, 'MGM'), 0);
});

test('seed populates the catalog and normalizes venue', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  assert.equal(catalog.size(), 3);
  assert.equal(catalog.get('AAA111').venue, 'MGM');
});

test('seed drops sessions missing from the latest snapshot', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  catalog.seed(FIXTURES.slice(1));
  assert.equal(catalog.size(), 2);
  assert.equal(catalog.get('AAA111'), null);
});

test('topTracks ranks by frequency over topics, not the unused tracks field', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  assert.deepEqual(catalog.topTracks(2), ['serverless', 'kubernetes']);
});

test('topTopic picks the most common topic across the given session ids', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  assert.equal(catalog.topTopic(['AAA111', 'AAA111-R1', 'BBB222']), 'serverless');
  assert.equal(catalog.topTopic([]), null);
});

test('search reaches free-text fields beyond topics, like industries and segments', () => {
  const catalog = makeCatalog();
  catalog.seed([
    { ...FIXTURES[0], sessionId: 'EEE1', industries: ['Healthcare'] },
    { ...FIXTURES[2], sessionId: 'EEE2', segments: ['Public sector'] },
  ]);
  assert.deepEqual(catalog.search({ query: 'healthcare' }).map((s) => s.sessionId), ['EEE1']);
  assert.deepEqual(catalog.search({ query: 'public sector' }).map((s) => s.sessionId), ['EEE2']);
});

test('recommend ranks by topic overlap with interest topics', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.recommend('tuesday', ['serverless'], []);
  assert.deepEqual(results.map((s) => s.sessionId), ['AAA111', 'BBB222']);
});

test('recommend falls back to seat scarcity with no topic signal', () => {
  const catalog = makeCatalog();
  catalog.seed([
    { ...FIXTURES[0], sessionId: 'CCC1', seatAvailability: 'available' },
    { ...FIXTURES[2], sessionId: 'CCC2', seatAvailability: 'veryLimited' },
  ]);
  const results = catalog.recommend('tuesday', [], []);
  assert.deepEqual(results.map((s) => s.sessionId), ['CCC2', 'CCC1']);
});

test('recommend excludes given ids and sessions with no seats left', () => {
  const catalog = makeCatalog();
  catalog.seed([
    { ...FIXTURES[0], sessionId: 'DDD1', seatAvailability: 'unavailable' },
    { ...FIXTURES[2], sessionId: 'DDD2' },
  ]);
  const results = catalog.recommend('tuesday', [], ['DDD2']);
  assert.deepEqual(results, []);
});

test('getRepeats groups a session with its repeat by abbreviation prefix', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const repeats = catalog.getRepeats('AAA111').sort();
  assert.deepEqual(repeats, ['AAA111', 'AAA111-R1']);
  assert.deepEqual(catalog.getRepeats('BBB222'), ['BBB222']);
});

test('search filters by day and venue', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const day1 = catalog.search({ day: 'tuesday' });
  assert.deepEqual(day1.map((s) => s.sessionId).sort(), ['AAA111', 'BBB222']);
  const wynn = catalog.search({ venue: 'Wynn' });
  assert.deepEqual(wynn.map((s) => s.sessionId), ['AAA111-R1']);
});

test('search scores lexical overlap and ranks matches first', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({ query: 'kubernetes scale' });
  assert.equal(results[0].sessionId, 'BBB222');
});

test('search with no query returns a short unfiltered slice', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({});
  assert.equal(results.length, 3);
});

test('search with no query orders results chronologically', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({});
  assert.deepEqual(results.map((s) => s.sessionId), ['AAA111', 'BBB222', 'AAA111-R1']);
});

test('a query that matches no session content falls back to the day/time filtered pool', () => {
  // Mirrors a live agent bug: asking for "Tuesday morning" put day:'tuesday',
  // to:'12:00' and query:'morning', but no session tokenizes to the word
  // "morning", so a hard query filter wiped out two real 9am/9:30am matches.
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({ day: 'tuesday', to: '12:00', query: 'morning' });
  assert.deepEqual(results.map((s) => s.sessionId), ['AAA111', 'BBB222']);
});

test('a query that matches nothing and has no structured filter still returns nothing', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({ query: 'nothing matches this' });
  assert.deepEqual(results, []);
});

test('wildcard mode only returns sessions that do not match the query', () => {
  const catalog = makeCatalog();
  catalog.seed(FIXTURES);
  const results = catalog.search({ query: 'kubernetes', mode: 'wildcard' });
  assert.ok(results.every((s) => s.sessionId !== 'BBB222'));
});

test('sync walks paginated pages under the real AWS "items" key and seeds the catalog', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = fakeAwsPages([
    { items: [FIXTURES[0]], nextToken: 'p2', totalCount: 3 },
    { items: [FIXTURES[1], FIXTURES[2]], totalCount: 3 },
  ]);

  const catalog = makeCatalog();
  const result = await catalog.sync('token');
  assert.deepEqual(result, { count: 3, totalCount: 3 });
  assert.equal(catalog.size(), 3);
  assert.equal(catalog.get('BBB222').title, 'Kubernetes at scale');
});
