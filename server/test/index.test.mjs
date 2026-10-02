import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fakeWorld, startApp } from './helpers.mjs';

const noModes = process.platform === 'win32' && 'Windows has no POSIX file modes';

function tempHome(t, prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

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

  assert.equal(JSON.parse(readFileSync(join(app.home, 'tokens.json'), 'utf8')).refresh_token, 'r1');
});

test('the token file is readable only by the current user', { skip: noModes }, () => {
  assert.equal(statSync(join(app.home, 'tokens.json')).mode & 0o777, 0o600);
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

test('a restarted app picks up the saved tokens and the cached catalog without re-syncing', async (t) => {
  const home = tempHome(t, 'nevada-restart-');
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

test('a fresh disk cache counts as synced, so get_session skips the live fetch', async (t) => {
  const home = tempHome(t, 'nevada-fresh-');
  const first = await startApp({ home });
  await first.signIn();
  await first.postJson('/api/schedule', {});

  const second = await startApp({ home });
  const before = world.calls.length;
  const result = await second.postJson('/tools/get_session', { sessionId: 'AAA111' });
  assert.equal((await result.json()).answer.includes('Deep dive on Lambda'), true);
  assert.equal(world.calls.slice(before).some((c) => c.url.includes('/sessions/AAA111')), false);
});

test('a stale cache serves from disk at once and refreshes in the background', async (t) => {
  const home = tempHome(t, 'nevada-stale-');
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

/**
 * The launcher (server/index.mjs) runs as a real child process. Its ports are
 * fixed (8484 to 8489) and may be in use on this machine, so a preload script
 * fakes what the OS and the browser opener would do. Nothing binds those ports.
 * PLAN is JSON: { listen: {port: code}, health: {port: 'nevada'|'hang'}, node, home, openExit, noWidgetFile }.
 */
const PRELOAD = `
import http from 'node:http';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
const plan = JSON.parse(process.env.PLAN || '{}');
if (plan.node) Object.defineProperty(process.versions, 'node', { value: plan.node });
if (plan.noWidgetFile) {
  const read = fs.readFileSync;
  fs.readFileSync = (f, ...rest) => /(agent|public)\\.json$/.test(String(f)) ? fs.statSync('/no/such/file') : read(f, ...rest);
}
if ('home' in plan) os.homedir = () => plan.home;
childProcess.spawn = (cmd, args, opts) => {
  console.log('SPAWN ' + JSON.stringify({ cmd, opts }));
  const child = new EventEmitter();
  setImmediate(() => plan.openExit === 'error' ? child.emit('error', new Error('nope')) : child.emit('exit', plan.openExit ?? 0));
  return child;
};
http.Server.prototype.listen = function (port, host, cb) {
  const code = plan.listen?.[port];
  if (code) {
    const err = Object.assign(new Error('listen ' + code), { code });
    process.nextTick(() => this.emit('error', err));
    return this;
  }
  this.once('listening', cb);
  return Object.getPrototypeOf(http.Server.prototype).listen.call(this, 0, host);
};
globalThis.fetch = (url, opts) => {
  const kind = plan.health?.[new URL(url).port];
  if (kind === 'nevada') return Promise.resolve({ ok: true, json: async () => ({ ok: true, app: 'nevada-reinvent' }) });
  if (kind !== 'hang') return Promise.reject(new Error('refused'));
  // Like a real socket, a pending request keeps the process alive until the abort.
  return new Promise((_, reject) => {
    const keepAlive = setInterval(() => {}, 1000);
    opts.signal.addEventListener('abort', () => { clearInterval(keepAlive); reject(new Error('timeout')); });
  });
};
syncBuiltinESMExports();
`;

/** Runs the launcher and resolves with its output once it exits, or once it prints "Ctrl+C" and is stopped. */
function runLauncher(t, { plan = {}, env = {}, args = ['--no-open'] } = {}) {
  const dir = tempHome(t, 'nevada-launcher-');
  const preload = join(dir, 'preload.mjs');
  writeFileSync(preload, PRELOAD);
  const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, 'server/index.mjs', ...args], {
    env: { ...process.env, NEVADA_HOME: join(dir, 'home'), NEVADA_WIDGET_ID: 'W123', ...env, PLAN: JSON.stringify(plan) },
  });
  t.after(() => child.kill());
  let out = '';
  return new Promise((resolve) => {
    let stopTimer;
    // The opener hint prints a tick after "Ctrl+C", so give it a moment before stopping.
    const take = (chunk) => {
      out += chunk;
      if (out.includes('Ctrl+C') && !stopTimer) stopTimer = setTimeout(() => child.kill(), 300);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('close', (code) => {
      clearTimeout(stopTimer);
      resolve({ code, out });
    });
  });
}

test('the launcher takes the next port when one is in use or blocked', async (t) => {
  const { out } = await runLauncher(t, { plan: { listen: { 8484: 'EADDRINUSE', 8485: 'EACCES' } } });
  assert.match(out, /Nevada is running at http:\/\/127\.0\.0\.1:8486\//);
});

test('the launcher says the ports are in use or blocked when none is free', async (t) => {
  const listen = Object.fromEntries([8484, 8485, 8486, 8487, 8488, 8489].map((p) => [p, 'EADDRINUSE']));
  const { code, out } = await runLauncher(t, { plan: { listen } });
  assert.deepEqual([code, out.trim()], [1, 'Ports 8484 to 8489 are in use or blocked. Close whatever uses them and run this again.']);
});

test('any other listen error is one plain line, not a stack trace', async (t) => {
  const { code, out } = await runLauncher(t, { plan: { listen: { 8484: 'EPERM' } } });
  assert.deepEqual([code, out.trim()], [1, 'Nevada could not start: listen EPERM']);
});

test('the launcher reuses Nevada when it already runs on a busy port', async (t) => {
  const { code, out } = await runLauncher(t, { plan: { listen: { 8484: 'EADDRINUSE' }, health: { 8484: 'nevada' } } });
  assert.deepEqual([code, out.trim()], [0, 'Nevada is already running at http://127.0.0.1:8484/']);
});

test('a busy port that does not answer in time is skipped', { timeout: 10000 }, async (t) => {
  const { out } = await runLauncher(t, { plan: { listen: { 8484: 'EADDRINUSE' }, health: { 8484: 'hang' } } });
  assert.match(out, /Nevada is running at http:\/\/127\.0\.0\.1:8485\//);
});

test('an already running Nevada is opened in the browser', async (t) => {
  const { out } = await runLauncher(t, { args: [], plan: { listen: { 8484: 'EADDRINUSE' }, health: { 8484: 'nevada' } } });
  assert.match(out, /SPAWN .*"windowsHide":true/);
});

test('an opener that fails tells the user to open the link', async (t) => {
  const { out } = await runLauncher(t, { args: [], plan: { openExit: 'error' } });
  assert.match(out, /Nevada is running at [^\n]+\nPress Ctrl\+C to stop\.\n(SPAWN [^\n]+\n)?Open the link above in your browser\./);
});

test('an opener that exits non-zero tells the user to open the link', async (t) => {
  const { out } = await runLauncher(t, { args: [], plan: { openExit: 1 } });
  assert.match(out, /Open the link above in your browser\./);
});

test('an opener that works prints no hint', async (t) => {
  const { out } = await runLauncher(t, { args: [], plan: { openExit: 0 } });
  assert.doesNotMatch(out, /Open the link above/);
});

test('an old Node gets a plain message before anything else loads', async (t) => {
  const { code, out } = await runLauncher(t, { plan: { node: '18.19.0' } });
  assert.deepEqual([code, out.trim()], [1, 'Nevada needs Node 20.6 or newer. You have 18.19.0. Install it from https://nodejs.org and run this again.']);
});

test('Node 20.5 is too old', async (t) => {
  const { code } = await runLauncher(t, { plan: { node: '20.5.1' } });
  assert.equal(code, 1);
});

test('NEVADA_HOME must be an absolute path', async (t) => {
  const { code, out } = await runLauncher(t, { env: { NEVADA_HOME: 'relative/nevada' } });
  assert.deepEqual([code, out.trim()], [1, 'NEVADA_HOME must be an absolute path. You set "relative/nevada".']);
});

test('a missing home folder is reported instead of writing to a relative path', async (t) => {
  const { code, out } = await runLauncher(t, { env: { NEVADA_HOME: '' }, plan: { home: '' } });
  assert.deepEqual([code, out.startsWith('Nevada could not find your home folder')], [1, true]);
});

test('a missing widget id names both ways to fix it', async (t) => {
  const { code, out } = await runLauncher(t, { env: { NEVADA_WIDGET_ID: '' }, plan: { noWidgetFile: true } });
  assert.deepEqual([code, /NEVADA_WIDGET_ID[^]*installed from npm[^]*issues/.test(out)], [1, true]);
});
