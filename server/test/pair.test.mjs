import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The `npx nevada-pair` path: the command the gate shows, the helper's
 * pre-sign-in check and how the helper reads its arguments. Every helper run
 * here stops before AWS sign-in, so no browser opens.
 */

process.env.TOKEN_ENC_KEY = randomBytes(32).toString('base64');
process.env.PORT = '0';
process.env.KALTURA_PARTNER_ID = '123';
process.env.KALTURA_ADMIN_SECRET = 'test-secret';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.awsevents.com/') && !u.startsWith('https://oauth.awsevents.com/')) return realFetch(url, opts);
  if (u.startsWith('https://api.awsevents.com/v1/events/reinvent2026/sessions')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: [], totalCount: 0 }) };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/userInfo') {
    return { status: 200, ok: true, json: async () => ({ sub: 'sub-pair-test' }) };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/revoke') return { status: 200, ok: true, text: async () => '' };
  throw new Error(`unmocked AWS call: ${opts.method || 'GET'} ${u}`);
};

const { default: server } = await import('../index.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
server.unref();
const base = `http://localhost:${server.address().port}`;
after(() => { globalThis.fetch = realFetch; server.close(); });

const HELPER = fileURLToPath(new URL('../../pair/index.mjs', import.meta.url));
// Async, not execFileSync: the server under test shares this event loop.
const runHelper = (...args) => new Promise((resolve) => {
  execFile(process.execPath, [HELPER, ...args], { timeout: 20000 }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stderr }));
});
const start = async () => {
  const res = await realFetch(`${base}/api/pair/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return { cookie: res.headers.get('set-cookie')?.split(';')[0], ...(await res.json()) };
};
const check = async (code) => (await realFetch(`${base}/api/pair/check/${code}`)).json();

test('/api/pair/start gives a command that runs in any shell', async () => {
  const { code, command } = await start();
  assert.equal(command, `npx -y nevada-pair@latest ${code} ${base}`);
});

test('/api/pair/check says waiting for a fresh code', async () => {
  const { code } = await start();
  assert.deepEqual(await check(code), { state: 'waiting' });
});

test('/api/pair/check says expired for an unknown code', async () => {
  assert.deepEqual(await check('ZZZZZZ'), { state: 'expired' });
});

test('/api/pair/check says expired once the code is used', async (t) => {
  const { code, cookie } = await start();
  await realFetch(`${base}/api/pair/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code, access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
  });
  t.after(() => realFetch(`${base}/api/pair/disconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: '{}' }));
  assert.deepEqual(await check(code), { state: 'expired' });
});

test('the helper explains its usage when the URL is missing', async () => {
  const { code, stderr } = await runHelper('ABC123');
  assert.deepEqual([code, /copy the command Nevada showed you/.test(stderr)], [1, true]);
});

test('the helper refuses plain http for a remote Nevada', async () => {
  const { stderr } = await runHelper('ABC123', 'http://nevada.example.com');
  assert.match(stderr, /must start with https/);
});

test('the helper accepts a spaced lowercase code after the URL and stops on a dead one', async () => {
  const { code, stderr } = await runHelper(base, 'zzz', 'zzz');
  assert.deepEqual([code, /expired or was already used/.test(stderr)], [1, true]);
});

test('the helper accepts a quoted code with a space in it', async () => {
  const { stderr } = await runHelper('zzz zzz', base);
  assert.match(stderr, /expired or was already used/);
});

test('the helper retries a server error before giving up', async (t) => {
  let calls = 0;
  const flaky = createServer((req, res) => {
    calls++;
    if (calls < 3) { res.writeHead(503).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"state":"expired"}');
  });
  await new Promise((resolve) => flaky.listen(0, '127.0.0.1', resolve));
  t.after(() => flaky.close());
  await runHelper('ABC123', `http://127.0.0.1:${flaky.address().port}`);
  assert.equal(calls, 3);
});
