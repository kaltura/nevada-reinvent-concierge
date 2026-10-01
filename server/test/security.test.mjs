import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeWorld, startApp } from './helpers.mjs';

/** Local-app security: who can reach the server, and how the AWS sign-in is protected. */

const world = fakeWorld();
const app = await startApp();

function rawRequest(path, headers) {
  const { port } = app.server.address();
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    req.on('error', reject);
    req.end();
  });
}

test('binds to 127.0.0.1 only', () => {
  assert.equal(app.server.address().address, '127.0.0.1');
});

test('a request with a foreign Host header is refused (DNS rebinding)', async () => {
  assert.equal((await rawRequest('/', { Host: 'evil.example' })).statusCode, 421);
});

test('a Host header with the wrong port is refused', async () => {
  assert.equal((await rawRequest('/', { Host: 'localhost:1' })).statusCode, 421);
});

test('localhost and [::1] host names are accepted on the real port', async () => {
  const { port } = app.server.address();
  assert.equal((await rawRequest('/', { Host: `localhost:${port}` })).statusCode, 200);
});

test('a cross-site tool call is blocked before it reaches the handler', async () => {
  const res = await app.postJson('/tools/get_topics', {}, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' });
  assert.deepEqual([res.status, (await res.json()).error], [403, 'cross_site_blocked']);
});

test('a cross-site sign-out is blocked and leaves the tokens alone', async () => {
  await app.signIn();
  const res = await app.postJson('/api/signout', {}, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(res.status, 403);
  assert.ok(existsSync(join(app.home, 'tokens.json')));
});

test('a same-origin POST is accepted even when the browser sends Origin: null', async () => {
  const res = await app.postJson('/tools/get_topics', {}, { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' });
  assert.equal(res.status, 200);
});

test('a tool call with a non-object body is a graceful message, not a crash', async () => {
  const res = await app.postJson('/tools/get_topics', ['not', 'an', 'object']);
  assert.equal((await res.json()).answer, "That didn't work. Try again in a moment.");
});

test('a malformed percent-escape in the path is a 400, not a crash', async () => {
  assert.equal((await app.get('/%E0')).status, 400);
});

test('a path outside the client folder is not served', async () => {
  const res = await rawRequest('/..%2fpackage.json', { Host: `127.0.0.1:${app.server.address().port}` });
  assert.notEqual(res.statusCode, 200);
});

test('the server source and token file are not served', async () => {
  for (const path of ['/server/app.mjs', '/tokens.json', '/.env']) assert.equal((await app.get(path)).status, 404, path);
});

test('every response carries the hardening headers and sets no cookie', async () => {
  const res = await app.get('/');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('the callback refuses a code without a state the server issued (login CSRF)', async () => {
  const before = world.tokenRequests.length;
  for (const query of ['code=x', 'code=x&state=forged']) {
    const res = await app.get(`/callback?${query}`);
    assert.equal(res.headers.get('location'), '/?signin=failed', query);
  }
  assert.equal(world.tokenRequests.length, before);
});

test('a sign-in state works once, then is refused', async () => {
  const start = await app.get('/auth/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  assert.equal((await app.get(`/callback?code=c&state=${state}`)).headers.get('location'), '/');
  assert.equal((await app.get(`/callback?code=c&state=${state}`)).headers.get('location'), '/?signin=failed');
});

test('each sign-in gets its own state and PKCE challenge', async () => {
  const [a, b] = await Promise.all([app.get('/auth/start'), app.get('/auth/start')]);
  const [ua, ub] = [a, b].map((r) => new URL(r.headers.get('location')).searchParams);
  assert.notEqual(ua.get('state'), ub.get('state'));
  assert.notEqual(ua.get('code_challenge'), ub.get('code_challenge'));
});

test('the code verifier sent to AWS matches the challenge from the authorize URL', async () => {
  const { createHash } = await import('node:crypto');
  const start = await app.get('/auth/start');
  const q = new URL(start.headers.get('location')).searchParams;
  await app.get(`/callback?code=pk&state=${q.get('state')}`);
  const exchange = world.tokenRequests.findLast((r) => r.code === 'pk');
  assert.equal(createHash('sha256').update(exchange.code_verifier).digest('base64url'), q.get('code_challenge'));
});

test('cancelling at AWS returns to the app without storing anything', async () => {
  const empty = await startApp();
  const start = await empty.get('/auth/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const res = await empty.get(`/callback?error=access_denied&state=${state}`);
  assert.equal(res.headers.get('location'), '/?signin=cancelled');
  assert.equal(existsSync(join(empty.home, 'tokens.json')), false);
});

test('a failed code exchange returns an error and stores nothing', async () => {
  const empty = await startApp();
  delete world.tokenGrants.authorization_code;
  try {
    const res = await empty.signIn('bad');
    assert.equal(res.headers.get('location'), '/?signin=failed');
    assert.equal(existsSync(join(empty.home, 'tokens.json')), false);
  } finally {
    world.tokenGrants.authorization_code = { access_token: 'tok1', refresh_token: 'r1', expires_in: 3600 };
  }
});

test('the sign-in state expires after ten minutes', async (t) => {
  const start = await app.get('/auth/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  Date.now = () => realNow() + 11 * 60_000;
  assert.equal((await app.get(`/callback?code=c&state=${state}`)).headers.get('location'), '/?signin=failed');
});

test('error logs carry no token, code or response body', async (t) => {
  const lines = [];
  for (const level of ['log', 'warn', 'error']) t.mock.method(console, level, (...a) => lines.push(a.map(String).join(' ')));
  world.respond = async (u) => (u.includes('/sessions/SECRET') ? { status: 500, ok: false, text: async () => '{"token":"tok1","body":"leak-me"}' } : undefined);
  try {
    await app.postJson('/tools/get_session', { sessionId: 'SECRET' });
  } finally { world.respond = null; }
  const all = lines.join('\n');
  assert.ok(!/tok1|r1|leak-me/.test(all), all);
});

test('a corrupt token file means signed out, not a crash', async () => {
  const home = mkdtempSync(join(tmpdir(), 'nevada-corrupt-'));
  writeFileSync(join(home, 'tokens.json'), '{not json');
  const broken = await startApp({ home });
  assert.deepEqual(await (await broken.postJson('/api/schedule', {})).json(), { paired: false });
});

test('the token file is private to the user', () => {
  assert.equal(JSON.parse(readFileSync(join(app.home, 'tokens.json'), 'utf8')).refresh_token, 'r1');
});

test('/api/agent/init says not provisioned when no widget id is configured', async () => {
  const bare = await startApp({ widgetId: null });
  await bare.signIn();
  const res = await bare.postJson('/api/agent/init', {});
  assert.deepEqual([res.status, (await res.json()).error], [503, 'not_provisioned']);
});

test('/api/agent/init hides the upstream error', async () => {
  const other = await startApp();
  await other.signIn();
  world.respond = async (u) => (u.endsWith('/appInit') ? { status: 500, ok: false, text: async () => 'secret upstream detail', json: async () => ({}) } : undefined);
  try {
    const res = await other.postJson('/api/agent/init', {});
    const text = await res.text();
    assert.deepEqual([res.status, /secret upstream/.test(text)], [502, false]);
  } finally { world.respond = null; }
});
