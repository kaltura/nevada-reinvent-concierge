import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AwsError, withToken, signInRequest, exchangeCode, getSchedule, reserveSessions, associateFavorites,
  cancelReservation, listSessions, getSession, revokeRefreshToken,
} from '../aws.mjs';

function fakeFetch(t, body) {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });
}

// AWS wraps GetSchedule as {schedule} and the bulk write endpoints as
// {result}, confirmed against the live openapi.json. A prior version of
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

test('revokeRefreshToken reports true only when AWS confirms the revoke', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });

  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => '' });
  assert.equal(await revokeRefreshToken('r1'), true);

  globalThis.fetch = async () => ({ status: 400, ok: false, text: async () => '' });
  assert.equal(await revokeRefreshToken('r1'), false);

  globalThis.fetch = async () => { throw new Error('network down'); };
  assert.equal(await revokeRefreshToken('r1'), false);
});

function fakeTokenStore(initial) {
  let record = initial;
  return {
    get: () => record,
    set: (t) => { record = { access_token: t.access_token, refresh_token: t.refresh_token, expiresAt: 0 }; },
    clear: () => { record = null; },
  };
}
const SIGNED_IN = { access_token: 'stale', refresh_token: 'r1', expiresAt: 0 };

test('withToken returns paired:false when nobody is signed in', async () => {
  assert.deepEqual(await withToken(fakeTokenStore(null), async () => 'never'), { paired: false });
});

test('withToken passes the result through on success', async () => {
  const result = await withToken(fakeTokenStore(SIGNED_IN), async (token) => `ok:${token}`);
  assert.deepEqual(result, { paired: true, result: 'ok:stale' });
});

test('withToken dedupes concurrent refreshes', async (t) => {
  let refreshCalls = 0;
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://oauth.awsevents.com/oauth2/token');
    refreshCalls += 1;
    return { ok: true, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) };
  };

  const store = fakeTokenStore(SIGNED_IN);
  const fn = async (token) => {
    if (token === 'stale') throw new AwsError(401);
    return `ok:${token}`;
  };

  const [a, b] = await Promise.all([withToken(store, fn), withToken(store, fn)]);

  assert.equal(refreshCalls, 1);
  assert.deepEqual([a, b], [{ paired: true, result: 'ok:fresh' }, { paired: true, result: 'ok:fresh' }]);
});

test('a refresh that finishes after sign-out does not bring the tokens back', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const store = fakeTokenStore(SIGNED_IN);
  globalThis.fetch = async () => {
    store.clear(); // the attendee signs out while AWS is still answering
    return { ok: true, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) };
  };

  const result = await withToken(store, async (token) => { if (token === 'stale') throw new AwsError(401); return `ok:${token}`; });

  assert.deepEqual([result, store.get()], [{ paired: false }, null]);
});

test('withToken keeps the old refresh token when AWS omits a new one', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'fresh', expires_in: 3600 }) });

  const store = fakeTokenStore(SIGNED_IN);
  const result = await withToken(store, async (token) => { if (token === 'stale') throw new AwsError(401); return `ok:${token}`; });

  assert.deepEqual([result, store.get().refresh_token], [{ paired: true, result: 'ok:fresh' }, 'r1']);
});

test('withToken signs out and reports expired when the refresh token is rejected', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });

  const store = fakeTokenStore(SIGNED_IN);
  const result = await withToken(store, async () => { throw new AwsError(401); });

  assert.deepEqual([result, store.get()], [{ paired: false, expired: true }, null]);
});

test('withToken keeps the tokens when the refresh fails on the network', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => { throw new Error('offline'); };

  const store = fakeTokenStore(SIGNED_IN);
  await assert.rejects(() => withToken(store, async () => { throw new AwsError(401); }), /offline/);
  assert.equal(store.get().refresh_token, 'r1');
});

test('withToken signs out and reports expired when the retry still 401s', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) });

  const store = fakeTokenStore(SIGNED_IN);
  const result = await withToken(store, async () => { throw new AwsError(401); });

  assert.deepEqual([result, store.get()], [{ paired: false, expired: true }, null]);
});

test('withToken lets a non-401 AwsError propagate instead of trying to refresh', async () => {
  const fn = async () => { throw new AwsError(500); };
  await assert.rejects(() => withToken(fakeTokenStore(SIGNED_IN), fn), (e) => e instanceof AwsError && e.status === 500);
});

test('signInRequest builds an S256 PKCE authorize URL for AWS Builder ID', () => {
  const { url, state, verifier } = signInRequest('http://127.0.0.1:8484/callback');
  const u = new URL(url);
  assert.equal(`${u.origin}${u.pathname}`, 'https://oauth.awsevents.com/oauth2/authorize');
  const p = u.searchParams;
  assert.deepEqual(
    [p.get('response_type'), p.get('identity_provider'), p.get('code_challenge_method'), p.get('redirect_uri'), p.get('scope'), p.get('state')],
    ['code', 'AWSBuilderID', 'S256', 'http://127.0.0.1:8484/callback', 'openid email events/access', state],
  );
  assert.equal(p.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
});

test('signInRequest never repeats a state or verifier', () => {
  const a = signInRequest('http://127.0.0.1:8484/callback');
  const b = signInRequest('http://127.0.0.1:8484/callback');
  assert.deepEqual([a.state === b.state, a.verifier === b.verifier], [false, false]);
});

test('exchangeCode posts the code with the PKCE verifier and the same redirect URI', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url, body: Object.fromEntries(new URLSearchParams(opts.body)) };
    return { ok: true, json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) };
  };
  const tokens = await exchangeCode({ code: 'c1', verifier: 'v1', redirectUri: 'http://127.0.0.1:8485/callback' });
  assert.equal(seen.url, 'https://oauth.awsevents.com/oauth2/token');
  assert.deepEqual(seen.body, {
    grant_type: 'authorization_code', client_id: '7vmom55m1qstvq8i71ph127bfq',
    redirect_uri: 'http://127.0.0.1:8485/callback', code: 'c1', code_verifier: 'v1',
  });
  assert.equal(tokens.refresh_token, 'r');
});

test('exchangeCode throws an AwsError when AWS refuses the code', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' });
  await assert.rejects(
    () => exchangeCode({ code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1:8484/callback' }),
    (e) => e instanceof AwsError && e.status === 400 && e.code === 'code_exchange_failed',
  );
});
