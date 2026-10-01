import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeWorld, startApp } from './helpers.mjs';

/**
 * End to end through the real HTTP server: sign-in, catalog sync, reserve,
 * favorite and cancel via the real /tools/* endpoints, and /api/schedule
 * reading the change back. Only the AWS and Kaltura network calls are fake.
 */

const world = fakeWorld();
world.sessionListDelayMs = 200; // the first tool call and schedule load must wait for this sync
const app = await startApp();

test('a signed-out app says so instead of failing', async () => {
  const schedule = await (await app.postJson('/api/schedule', {})).json();
  assert.deepEqual(schedule, { paired: false });
  const tool = await (await app.postJson('/tools/get_my_schedule', {})).json();
  assert.equal(tool.answer, 'Connect your AWS Events account to do that.');
});

test('sign-in sends the browser to AWS with PKCE, then back to the app', async () => {
  const start = await app.get('/auth/start');
  assert.equal(start.status, 302);
  const u = new URL(start.headers.get('location'));
  assert.equal(u.origin + u.pathname, 'https://oauth.awsevents.com/oauth2/authorize');
  assert.equal(u.searchParams.get('redirect_uri'), `${app.base}/callback`);
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
});

test('the callback trades the code for tokens, stores them privately and syncs the catalog', async () => {
  const done = await app.signIn('code1');
  assert.deepEqual([done.status, done.headers.get('location')], [302, '/']);

  const exchange = world.tokenRequests.at(-1);
  assert.deepEqual([exchange.grant_type, exchange.code, exchange.redirect_uri], ['authorization_code', 'code1', `${app.base}/callback`]);
  assert.ok(exchange.code_verifier.length >= 43);

  const file = join(app.home, 'tokens.json');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).refresh_token, 'r1');
});

test('reserve, schedule and cancel round-trip through the real server', async () => {
  const reserve = await app.postJson('/tools/reserve_sessions', { ids: ['AAA111'] });
  assert.equal((await reserve.json()).answer, 'Reserved Deep dive on Lambda (session AAA111).');

  const body = await (await app.postJson('/api/schedule', {})).json();
  assert.equal(body.paired, true);
  assert.deepEqual(body.reserved.map((s) => s.sessionId), ['AAA111']);
  assert.equal(body.blocks[0].kind, 'reserved');
  // AAA111 is reserved and tagged 'serverless': the opening line's topInterest branch reads this.
  assert.equal(body.topInterest, 'serverless');
  assert.deepEqual(body.recommended, []);
  assert.equal(body.week.length, 5);

  const cancel = await app.postJson('/tools/cancel_reservation', { id: 'AAA111' });
  assert.equal((await cancel.json()).answer, 'Cancelled Deep dive on Lambda (session AAA111).');
  assert.deepEqual((await (await app.postJson('/api/schedule', {})).json()).reserved, []);
});

test('the catalog is cached on disk after the first sync', async () => {
  const cache = JSON.parse(readFileSync(join(app.home, 'catalog.json'), 'utf8'));
  assert.deepEqual([cache.sessions.length, typeof cache.syncedAt], [2, 'number']);
});

test('favoriting a session AWS has not scheduled surfaces it outside the day grid', async () => {
  const favorite = await app.postJson('/tools/favorite_sessions', { ids: ['CCC333'] });
  assert.match((await favorite.json()).answer, /doesn't have a time yet/);

  const schedule = await (await app.postJson('/api/schedule', {})).json();
  assert.deepEqual(schedule.unscheduledFavorites.map((s) => s.sessionId), ['CCC333']);
  assert.ok(!schedule.week.some((w) => w.blocks.some((b) => b.sessionId === 'CCC333')));
});

test('/api/schedule recap reports the reserved day with the most sessions', async () => {
  await app.postJson('/tools/reserve_sessions', { ids: ['AAA111'] });
  const recap = await (await app.postJson('/api/schedule', { recap: true })).json();
  assert.deepEqual([recap.recap.totalSessions, recap.recap.venues, recap.recap.busiestDay], [1, ['MGM'], '2026-12-01']);
  await app.postJson('/tools/cancel_reservation', { id: 'AAA111' });
});

test('get_session fetches live from AWS when the id is missing from the catalog', async () => {
  const result = await app.postJson('/tools/get_session', { sessionId: 'EEE555' });
  assert.equal((await result.json()).answer, 'Live-fetched session (session EEE555).');
  const sessions = await (await app.postJson('/api/sessions', { ids: ['EEE555'] })).json();
  assert.equal(sessions.sessions[0]?.title, 'Live-fetched session');
});

test('an unknown tool is a 404', async () => {
  assert.equal((await app.postJson('/tools/not_a_real_tool', {})).status, 404);
});

test('/api/agent/init needs no Kaltura admin secret and returns only what the browser needs', async () => {
  const res = await app.postJson('/api/agent/init', {});
  assert.deepEqual(await res.json(), { ks: 'djJ8init', conversationManagerUrl: 'wss://cm', srsBaseUrl: 'https://srs', turnServerUrl: 'turn:t' });
  const widget = world.calls.findLast((c) => c.url.endsWith('startWidgetSession'));
  assert.equal(new URLSearchParams(widget.body).get('widgetId'), 'W123');
  const init = world.calls.findLast((c) => c.url.endsWith('/appInit'));
  assert.equal(init.headers.Authorization, 'KS widgetKs');
});

test('/api/agent/init mints a new widget session when Kaltura rejects the old one', async () => {
  world.kalturaRejectFirstAppInit = true;
  const mintsBefore = world.calls.filter((c) => c.url.endsWith('startWidgetSession')).length;
  const res = await app.postJson('/api/agent/init', {});
  assert.equal(res.status, 200);
  assert.equal(world.calls.filter((c) => c.url.endsWith('startWidgetSession')).length, mintsBefore + 1);
});

test('an expired access token is refreshed silently and the call still works', async () => {
  world.tokenGrants.refresh_token = { access_token: 'tok2', refresh_token: 'r2', expires_in: 3600 };
  world.respond = async (u, opts) => {
    if (u.endsWith('/schedule') && opts.headers.Authorization === 'Bearer tok1') return { status: 401, ok: false, text: async () => '{}' };
    return undefined;
  };
  const body = await (await app.postJson('/api/schedule', {})).json();
  world.respond = null;
  assert.equal(body.paired, true);
  assert.equal(JSON.parse(readFileSync(join(app.home, 'tokens.json'), 'utf8')).refresh_token, 'r2');
});

test('sign-out revokes the refresh token at AWS and deletes the token file', async () => {
  const out = await (await app.postJson('/api/signout', {})).json();
  assert.deepEqual(out, { ok: true, revoked: true });
  assert.ok(world.revoked.includes('r2'));
  assert.equal((await (await app.postJson('/api/schedule', {})).json()).paired, false);
  assert.throws(() => statSync(join(app.home, 'tokens.json')));
});

test('/api/agent/init refuses a signed-out app', async () => {
  const res = await app.postJson('/api/agent/init', {});
  assert.deepEqual([res.status, await res.json()], [401, { error: 'not_paired' }]);
});

test('a restarted app picks up the saved tokens and the cached catalog without re-syncing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nevada-restart-'));
  const first = await startApp({ home });
  await first.signIn();
  await first.postJson('/api/schedule', {}); // waits for the first sync and its cache write

  const sessionCalls = () => world.calls.filter((c) => c.url.includes('/sessions')).length;
  const before = sessionCalls();
  const second = await startApp({ home });
  const body = await (await second.postJson('/api/sessions', { ids: ['AAA111'] })).json();
  assert.equal(body.sessions[0].title, 'Deep dive on Lambda');
  assert.equal(sessionCalls(), before);
  assert.equal((await (await second.postJson('/api/schedule', {})).json()).paired, true);
});

test('a stale cache serves from disk at once and refreshes in the background', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nevada-stale-'));
  const first = await startApp({ home });
  await first.signIn();
  await first.postJson('/api/schedule', {});
  const cacheFile = join(home, 'catalog.json');
  const cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  writeFileSync(cacheFile, JSON.stringify({ ...cache, syncedAt: 1 }));

  const before = world.calls.filter((c) => c.url.includes('/sessions')).length;
  const second = await startApp({ home });
  const body = await (await second.postJson('/api/sessions', { ids: ['AAA111'] })).json();
  assert.equal(body.sessions.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(world.calls.filter((c) => c.url.includes('/sessions')).length > before);
});
