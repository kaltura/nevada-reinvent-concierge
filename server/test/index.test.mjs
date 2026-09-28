import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/**
 * End-to-end through the real HTTP server: pairing completion, catalog sync,
 * reserve/favorite/cancel via the actual /tools/* endpoints, and /api/schedule
 * reading the change back, the whole chain index.mjs -> tools.mjs -> aws.mjs
 * that the per-module unit tests each stub around. Only the AWS Events API's
 * own network calls are faked (real https:// calls are never made); the app's
 * own HTTP layer, encryption, catalog and tool wiring all run for real.
 */

process.env.TOKEN_ENC_KEY = randomBytes(32).toString('base64');
process.env.PORT = '0';

const AWS_SESSIONS = [{
  sessionId: 'AAA111', title: 'Deep dive on Lambda', venue: 'MGM Grand', isReservable: true,
  seatAvailability: 'available', sessionTime: { date: '2026-12-01', time: '09:00', length: 60 },
  topics: ['serverless'],
}, {
  // No sessionTime: AWS hasn't scheduled it yet, e.g. a wildcard pick.
  sessionId: 'CCC333', title: 'Wildcard: Reality-TV panel',
}];

let scheduleState = { reserved: [], favorites: [], personalTime: [] };
const revokeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.awsevents.com/') && !u.startsWith('https://oauth.awsevents.com/')) return realFetch(url, opts);
  if (u === 'https://api.awsevents.com/v1/events/reinvent2026/sessions/EEE555') {
    return { status: 200, ok: true, text: async () => JSON.stringify({ sessionId: 'EEE555', title: 'Live-fetched session' }) };
  }
  if (u.startsWith('https://api.awsevents.com/v1/events/reinvent2026/sessions')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: AWS_SESSIONS, totalCount: AWS_SESSIONS.length }) };
  }
  if (u === 'https://api.awsevents.com/v1/events/reinvent2026/schedule') {
    return { status: 200, ok: true, text: async () => JSON.stringify({ schedule: scheduleState }) };
  }
  if (u === 'https://api.awsevents.com/v1/events/reinvent2026/reservations' && opts.method === 'POST') {
    const { sessionIds } = JSON.parse(opts.body);
    scheduleState = { ...scheduleState, reserved: [...scheduleState.reserved, ...sessionIds] };
    return { status: 200, ok: true, text: async () => JSON.stringify({ result: { successful: sessionIds, failed: [] } }) };
  }
  if (u.startsWith('https://api.awsevents.com/v1/events/reinvent2026/reservations/') && opts.method === 'DELETE') {
    const id = decodeURIComponent(u.split('/').pop());
    scheduleState = { ...scheduleState, reserved: scheduleState.reserved.filter((x) => x !== id) };
    return { status: 204, ok: true, text: async () => '' };
  }
  if (u === 'https://api.awsevents.com/v1/events/reinvent2026/favorites' && opts.method === 'POST') {
    const { sessionIds } = JSON.parse(opts.body);
    scheduleState = { ...scheduleState, favorites: [...scheduleState.favorites, ...sessionIds] };
    return { status: 200, ok: true, text: async () => JSON.stringify({ result: { successful: sessionIds, failed: [] } }) };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/revoke' && opts.method === 'POST') {
    revokeCalls.push(new URLSearchParams(opts.body).get('token'));
    return { status: 200, ok: true, text: async () => '' };
  }
  throw new Error(`unmocked AWS call: ${opts.method || 'GET'} ${u}`);
};

const { default: server } = await import('../index.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;

let cookie;
async function req(path, opts = {}) {
  const res = await fetch(`${base}${path}`, { ...opts, headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) } });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return res;
}
const postJson = (path, body) => req(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function waitForCatalogSync() {
  for (let i = 0; i < 50; i += 1) {
    const { sessions } = await (await postJson('/api/sessions', { ids: ['AAA111'] })).json();
    if (sessions.length) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('catalog never synced');
}

after(() => { globalThis.fetch = realFetch; server.close(); });

test('pairing, reserve, schedule and cancel round-trip through the real server, AWS mocked', async () => {
  const { code } = await (await postJson('/api/pair/start', {})).json();
  assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

  const complete = await postJson('/api/pair/complete', { code, access_token: 'tok1', refresh_token: 'r1', expires_in: 3600 });
  assert.equal(complete.status, 200);
  const completeBody = await complete.json();
  assert.equal(completeBody.ok, true);
  assert.match(completeBody.handoffUrl, /\/\?handoff=[\w-]+$/);
  assert.match(completeBody.qrUrl, /\/\?handoff=[\w-]+$/);
  assert.notEqual(completeBody.handoffUrl, completeBody.qrUrl);

  await waitForCatalogSync();

  const reserve = await postJson('/tools/reserve_sessions', { ids: ['AAA111'] });
  assert.equal((await reserve.json()).answer, 'Reserved Deep dive on Lambda (session AAA111).');

  const schedule = await postJson('/api/schedule', {});
  const scheduleBody = await schedule.json();
  assert.equal(scheduleBody.paired, true);
  assert.deepEqual(scheduleBody.reserved.map((s) => s.sessionId), ['AAA111']);
  assert.equal(scheduleBody.blocks[0].kind, 'reserved');
  // AAA111 is reserved and tagged 'serverless': the opening line's
  // topInterest branch reads this. scripts/provision.mjs § OPENING_PHRASE.
  assert.equal(scheduleBody.topInterest, 'serverless');
  // AAA111 is reserved, so it's excluded from its own day's recommendations,
  // and there's no other session in the fixture catalog to recommend instead.
  assert.deepEqual(scheduleBody.recommended, []);
  assert.equal(scheduleBody.week.length, 5);

  const cancel = await postJson('/tools/cancel_reservation', { id: 'AAA111' });
  assert.equal((await cancel.json()).answer, 'Cancelled Deep dive on Lambda (session AAA111).');

  const afterCancel = await (await postJson('/api/schedule', {})).json();
  assert.deepEqual(afterCancel.reserved, []);
});

test('favoriting a session AWS has not scheduled surfaces it outside the day grid', async () => {
  const favorite = await postJson('/tools/favorite_sessions', { ids: ['CCC333'] });
  assert.match((await favorite.json()).answer, /doesn't have a time yet/);

  const schedule = await (await postJson('/api/schedule', {})).json();
  assert.deepEqual(schedule.unscheduledFavorites.map((s) => s.sessionId), ['CCC333']);
  // Not in any day's timeline, since it has no day to place it on.
  assert.ok(!schedule.week.some((w) => w.blocks.some((b) => b.sessionId === 'CCC333')));
});

test('/api/schedule recap reports the reserved day with the most sessions', async () => {
  await postJson('/tools/reserve_sessions', { ids: ['AAA111'] });
  const recap = await (await postJson('/api/schedule', { recap: true })).json();
  assert.equal(recap.paired, true);
  assert.equal(recap.recap.totalSessions, 1);
  assert.deepEqual(recap.recap.venues, ['MGM']);
  assert.equal(recap.recap.busiestDay, '2026-12-01');

  await postJson('/tools/cancel_reservation', { id: 'AAA111' });
});

test('get_session fetches live from AWS when the id is missing from the synced catalog', async () => {
  const result = await postJson('/tools/get_session', { sessionId: 'EEE555' });
  assert.equal((await result.json()).answer, 'Live-fetched session (session EEE555).');

  // Upserted into the catalog by the fallback, so it's there for anything
  // else that looks it up without needing another live fetch.
  const sessions = await (await postJson('/api/sessions', { ids: ['EEE555'] })).json();
  assert.equal(sessions.sessions[0]?.title, 'Live-fetched session');
});

test('disconnect revokes the refresh token at AWS and forgets the visitor', async () => {
  const disconnect = await postJson('/api/pair/disconnect', {});
  const body = await disconnect.json();
  assert.equal(body.ok, true);
  assert.equal(body.revoked, true);
  assert.ok(revokeCalls.includes('r1'));

  const schedule = await (await postJson('/api/schedule', {})).json();
  assert.equal(schedule.paired, false);
});

test('a tool call with no pairing asks to connect, and an unknown tool 404s', async () => {
  cookie = undefined; // fresh visitor, never paired
  const result = await postJson('/tools/favorite_sessions', { ids: ['AAA111'] });
  assert.equal((await result.json()).answer, 'Connect your AWS Events account to do that.');

  const unknown = await postJson('/tools/not_a_real_tool', {});
  assert.equal(unknown.status, 404);
});
