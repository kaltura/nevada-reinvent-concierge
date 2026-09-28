import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AwsError, withToken, getSchedule, reserveSessions, associateFavorites,
  cancelReservation, listSessions, getSession,
} from '../aws.mjs';

function fakeFetch(t, body) {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });
}

// AWS wraps GetSchedule as {schedule} and the bulk write endpoints as
// {result} — confirmed against the live openapi.json. A prior version of
// this file read the outer body straight through, so every favorite and
// reservation silently no-opped while reporting a 200.
test('getSchedule unwraps the {schedule} envelope', async (t) => {
  fakeFetch(t, { schedule: { reserved: ['AAA111'], favorites: ['BBB222'], personalTime: [] } });
  const result = await getSchedule('tok');
  assert.deepEqual(result, { reserved: ['AAA111'], favorites: ['BBB222'], personalTime: [] });
});

test('associateFavorites unwraps the {result} envelope', async (t) => {
  fakeFetch(t, { result: { successful: ['AAA111'], failed: [] } });
  const result = await associateFavorites('tok', ['AAA111']);
  assert.deepEqual(result, { successful: ['AAA111'], failed: [] });
});

test('reserveSessions unwraps the {result} envelope', async (t) => {
  fakeFetch(t, { result: { successful: [], failed: [{ sessionId: 'AAA111', code: 'sessionFull' }] } });
  const result = await reserveSessions('tok', ['AAA111']);
  assert.deepEqual(result, { successful: [], failed: [{ sessionId: 'AAA111', code: 'sessionFull' }] });
});

test('a DELETE that returns 204 resolves to null, not a parse error', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url, opts) => {
    assert.equal(opts.method, 'DELETE');
    return { status: 204, ok: true, text: async () => '' };
  };
  const result = await cancelReservation('tok', 'AAA111');
  assert.equal(result, null);
});

test('a non-ok response builds an AwsError with the status, code and body', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({
    status: 409, ok: false, text: async () => JSON.stringify({ code: 'scheduleConflict', message: 'nope' }),
  });
  await assert.rejects(
    () => reserveSessions('tok', ['AAA111']),
    (e) => {
      assert.ok(e instanceof AwsError);
      assert.equal(e.status, 409);
      assert.equal(e.code, 'scheduleConflict');
      assert.deepEqual(e.body, { code: 'scheduleConflict', message: 'nope' });
      return true;
    },
  );
});

test('listSessions builds the query string from locale, includeAbstracts and nextToken', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let seenUrl;
  globalThis.fetch = async (url) => { seenUrl = url; return { status: 200, ok: true, text: async () => '{}' }; };
  await listSessions('tok', { locale: 'en-US', includeAbstracts: true, nextToken: 'abc' });
  assert.equal(seenUrl, 'https://api.awsevents.com/v1/events/reinvent2026/sessions?locale=en-US&includeAbstracts=true&nextToken=abc');
});

test('listSessions omits the query string entirely with no options', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let seenUrl;
  globalThis.fetch = async (url) => { seenUrl = url; return { status: 200, ok: true, text: async () => '{}' }; };
  await listSessions('tok');
  assert.equal(seenUrl, 'https://api.awsevents.com/v1/events/reinvent2026/sessions');
});

test('getSession encodes the session id into the path', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let seenUrl;
  globalThis.fetch = async (url) => { seenUrl = url; return { status: 200, ok: true, text: async () => '{}' }; };
  await getSession('tok', 'A B/C');
  assert.equal(seenUrl, 'https://api.awsevents.com/v1/events/reinvent2026/sessions/A%20B%2FC');
});

function fakeTokenStore(initial) {
  const map = new Map([['v1', initial]]);
  return { get: (v) => map.get(v), set: (v, t) => map.set(v, t), delete: (v) => map.delete(v) };
}

test('withToken dedupes concurrent refreshes for the same visitor', async (t) => {
  let refreshCalls = 0;
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://oauth.awsevents.com/oauth2/token');
    refreshCalls += 1;
    return { ok: true, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) };
  };

  const store = fakeTokenStore({ access_token: 'stale', refresh_token: 'r1', expires_in: 3600 });
  let calls = 0;
  const fn = async (token) => {
    calls += 1;
    if (token === 'stale') throw new AwsError(401);
    return `ok:${token}`;
  };

  const [a, b] = await Promise.all([
    withToken(store, 'v1', fn),
    withToken(store, 'v1', fn),
  ]);

  assert.equal(refreshCalls, 1);
  assert.deepEqual(a, { paired: true, result: 'ok:fresh' });
  assert.deepEqual(b, { paired: true, result: 'ok:fresh' });
  assert.equal(calls, 4); // each call: one failing attempt on the stale token, one retry on the fresh one
});

test('withToken keeps the old refresh token when AWS omits a new one', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }) });

  const store = fakeTokenStore({ access_token: 'stale', refresh_token: 'r1', expires_in: 3600 });
  const fn = async (token) => { if (token === 'stale') throw new AwsError(401); return `ok:${token}`; };

  const result = await withToken(store, 'v1', fn);

  assert.deepEqual(result, { paired: true, result: 'ok:fresh' });
  assert.equal(store.get('v1').refresh_token, 'r1');
});

test('withToken reports expired and drops the record when the refresh itself fails', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });

  const store = fakeTokenStore({ access_token: 'stale', refresh_token: 'r1', expires_in: 3600 });
  const fn = async () => { throw new AwsError(401); };

  const result = await withToken(store, 'v1', fn);

  assert.deepEqual(result, { paired: false, expired: true });
  assert.equal(store.get('v1'), undefined);
});

test('withToken reports expired and drops the record when the retry still 401s', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) });

  const store = fakeTokenStore({ access_token: 'stale', refresh_token: 'r1', expires_in: 3600 });
  const fn = async () => { throw new AwsError(401); }; // 401s on both the stale token and the refreshed one

  const result = await withToken(store, 'v1', fn);

  assert.deepEqual(result, { paired: false, expired: true });
  assert.equal(store.get('v1'), undefined);
});

test('withToken lets a non-401 AwsError propagate instead of trying to refresh', async (t) => {
  const store = fakeTokenStore({ access_token: 'tok', refresh_token: 'r1', expires_in: 3600 });
  const fn = async () => { throw new AwsError(500); };
  await assert.rejects(() => withToken(store, 'v1', fn), (e) => e instanceof AwsError && e.status === 500);
});
