import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

/**
 * Security behaviours added on top of the plain pairing/tool flow already
 * covered by index.test.mjs: cookie signing, single-use pairing codes, rate
 * limiting, CSRF checks and the two-step handoff confirm/consume split.
 * Runs its own server instance so its rate-limit and single-use assertions
 * don't share state with index.test.mjs's happy-path calls.
 */

process.env.TOKEN_ENC_KEY = randomBytes(32).toString('base64');
process.env.PORT = '0';
process.env.KALTURA_PARTNER_ID = '123';
process.env.KALTURA_ADMIN_SECRET = 'test-secret';

const revokeCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.awsevents.com/') && !u.startsWith('https://oauth.awsevents.com/')) return realFetch(url, opts);
  if (u.startsWith('https://api.awsevents.com/v1/events/reinvent2026/sessions')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: [], totalCount: 0 }) };
  }
  if (u === 'https://api.awsevents.com/v1/events/reinvent2026/schedule') {
    return { status: 200, ok: true, text: async () => JSON.stringify({ schedule: { reserved: [], favorites: [], personalTime: [] } }) };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/revoke' && opts.method === 'POST') {
    revokeCalls.push(new URLSearchParams(opts.body).get('token'));
    return { status: 200, ok: true, text: async () => '' };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/userInfo') {
    // Each fake access token stands for its own attendee; 'bad' is one AWS rejects.
    const t = opts.headers.Authorization.replace('Bearer ', '');
    return t === 'bad' ? { status: 401, ok: false } : { status: 200, ok: true, json: async () => ({ sub: `sub-${t}` }) };
  }
  throw new Error(`unmocked AWS call: ${opts.method || 'GET'} ${u}`);
};

const { default: server } = await import('../index.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
// Node 20.6 runs root after() hooks only once the loop is idle, so a ref'd
// server would keep the run open forever and after() would never close it.
server.unref();
const base = `http://localhost:${server.address().port}`;
after(() => { globalThis.fetch = realFetch; server.close(); });

function req(path, opts = {}) {
  return fetch(`${base}${path}`, opts);
}
function postJson(path, body, opts = {}) {
  return req(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify(body) });
}
function cookieOf(res) {
  return res.headers.get('set-cookie')?.split(';')[0];
}

test('binds to 127.0.0.1 by default', () => {
  assert.equal(server.address().address, '127.0.0.1');
});

test('rejects a forged visitor cookie and issues a fresh one instead', async () => {
  const forged = '__Host-mq_v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.notarealsignature';
  const res = await postJson('/api/pair/start', {}, { headers: { Cookie: forged } });
  const issued = cookieOf(res);
  assert.ok(issued);
  assert.ok(!issued.startsWith('__Host-mq_v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.'));
});

test('a pairing code can only be completed once', async (t) => {
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();

  const first = await postJson('/api/pair/complete', { code, access_token: 'a', refresh_token: 'r', expires_in: 3600 }, { headers: { Cookie: cookie } });
  assert.equal(first.status, 200);

  const second = await postJson('/api/pair/complete', { code, access_token: 'b', refresh_token: 'r2', expires_in: 3600 }, { headers: { Cookie: cookie } });
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'already_used');
  t.after(() => postJson('/api/pair/disconnect', {}, { headers: { Cookie: cookie } }));
});

test('/api/pair/complete rejects malformed token fields', async () => {
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();
  const res = await postJson('/api/pair/complete', { code, access_token: 1, refresh_token: 'r', expires_in: 3600 }, { headers: { Cookie: cookie } });
  assert.equal(res.status, 400);
});

test('/api/pair/complete rejects a token AWS does not accept, and the code stays usable', async (t) => {
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();

  const rejected = await postJson('/api/pair/complete', { code, access_token: 'bad', refresh_token: 'r', expires_in: 3600 }, { headers: { Cookie: cookie } });
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error, 'aws_rejected_token');

  const retry = await postJson('/api/pair/complete', { code, access_token: 'good', refresh_token: 'r', expires_in: 3600 }, { headers: { Cookie: cookie } });
  assert.equal(retry.status, 200);
  t.after(() => postJson('/api/pair/disconnect', {}, { headers: { Cookie: cookie } }));
});

test('rejects a cross-site tool call before it reaches the handler', async () => {
  const res = await postJson('/tools/get_topics', {}, {
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'cross_site_blocked');
});

test('a tool call with a non-object body is a graceful message, not a crash', async () => {
  const res = await postJson('/tools/get_topics', ['not', 'an', 'object']);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).answer, "That didn't work. Try again in a moment.");
});

test('a malformed percent-escape in the request path is a 400, not a crash', async () => {
  const res = await req('/%E0');
  assert.equal(res.status, 400);
});

test('handoff: GET shows a confirm page, and only a same-origin POST consumes it', async () => {
  const startRes = await postJson('/api/pair/start', {});
  const deviceACookie = cookieOf(startRes);
  const { code } = await startRes.json();
  const complete = await postJson('/api/pair/complete', { code, access_token: 'devA', refresh_token: 'rA', expires_in: 3600 }, { headers: { Cookie: deviceACookie } });
  const { handoffUrl } = await complete.json();
  const handoffPath = new URL(handoffUrl).pathname + new URL(handoffUrl).search;

  const shown = await req(handoffPath);
  assert.equal(shown.status, 200);
  assert.match(await shown.text(), /<form method="POST"/);

  const blocked = await req(handoffPath, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(blocked.status, 403);

  const consumed = await fetch(`${base}${handoffPath}`, { method: 'POST', redirect: 'manual' });
  assert.equal(consumed.status, 302);
  assert.equal(consumed.headers.get('location'), '/');
  const deviceBCookie = cookieOf(consumed);
  assert.ok(deviceBCookie && deviceBCookie !== deviceACookie);

  const schedule = await postJson('/api/schedule', {}, { headers: { Cookie: deviceBCookie } });
  assert.equal((await schedule.json()).paired, true);

  await postJson('/api/pair/disconnect', {}, { headers: { Cookie: deviceBCookie } });
});

test('handoff: still works after the pairing tab polls status and rotates its cookie', async () => {
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();
  const complete = await postJson('/api/pair/complete', { code, access_token: 'rot', refresh_token: 'rRot', expires_in: 3600 }, { headers: { Cookie: cookie } });
  const { qrUrl } = await complete.json();
  const status = await req(`/api/pair/status/${code}`, { headers: { Cookie: cookie } });
  assert.equal((await status.json()).state, 'paired');

  const consumed = await fetch(`${base}${new URL(qrUrl).pathname}${new URL(qrUrl).search}`, { method: 'POST', redirect: 'manual' });
  assert.equal(consumed.headers.get('location'), '/');

  await postJson('/api/pair/disconnect', {}, { headers: { Cookie: cookieOf(consumed) } });
});

test('handoff: a same-origin form POST is accepted even with Origin: null', async () => {
  // Referrer-Policy: no-referrer (set on every response) makes a real
  // browser send Origin: null on a same-origin form POST navigation, while
  // still sending Sec-Fetch-Site: same-origin. sameOrigin() must trust the
  // latter, or every real phone handoff would 403.
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();
  const complete = await postJson('/api/pair/complete', { code, access_token: 'nullOrigin', refresh_token: 'rNullOrigin', expires_in: 3600 }, { headers: { Cookie: cookie } });
  const { handoffUrl } = await complete.json();
  const handoffPath = new URL(handoffUrl).pathname + new URL(handoffUrl).search;

  const consumed = await fetch(`${base}${handoffPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(consumed.status, 302);
  assert.equal(consumed.headers.get('location'), '/');

  await postJson('/api/pair/disconnect', {}, { headers: { Cookie: cookieOf(consumed) || cookie } });
});

test('handoff: consuming with the cookie that started the pairing does not revoke its own token', async () => {
  const startRes = await postJson('/api/pair/start', {});
  const cookie = cookieOf(startRes);
  const { code } = await startRes.json();
  const complete = await postJson('/api/pair/complete', { code, access_token: 'selfScan', refresh_token: 'rSelfScan', expires_in: 3600 }, { headers: { Cookie: cookie } });
  const { handoffUrl } = await complete.json();
  const handoffPath = new URL(handoffUrl).pathname + new URL(handoffUrl).search;

  const before = revokeCalls.length;
  const consumed = await fetch(`${base}${handoffPath}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookie } });
  assert.equal(consumed.status, 302);
  assert.equal(revokeCalls.length, before); // its own token was never revoked

  const newCookie = cookieOf(consumed);
  const schedule = await postJson('/api/schedule', {}, { headers: { Cookie: newCookie } });
  assert.equal((await schedule.json()).paired, true); // the new device still has the tokens

  await postJson('/api/pair/disconnect', {}, { headers: { Cookie: newCookie } });
});

test('a spoofed Host header is refused with 421', async () => {
  // fetch() treats Host as a forbidden header and always sends the real
  // connection host instead, so this needs a raw request to actually spoof it.
  const status = await new Promise((resolve, reject) => {
    const r = httpRequest(`${base}/`, { headers: { Host: 'evil.example:1234' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    r.on('error', reject);
    r.end();
  });
  assert.equal(status, 421);
});

test('handoff: consuming with an already-paired cookie revokes that prior token first', async () => {
  const startA = await postJson('/api/pair/start', {});
  const cookieA = cookieOf(startA);
  const { code: codeA } = await startA.json();
  const completeA = await postJson('/api/pair/complete', { code: codeA, access_token: 'newDev', refresh_token: 'rNew', expires_in: 3600 }, { headers: { Cookie: cookieA } });
  const { handoffUrl } = await completeA.json();
  const handoffPath = new URL(handoffUrl).pathname + new URL(handoffUrl).search;

  const startB = await postJson('/api/pair/start', {});
  const cookieB = cookieOf(startB);
  const { code: codeB } = await startB.json();
  await postJson('/api/pair/complete', { code: codeB, access_token: 'oldDev', refresh_token: 'rOld', expires_in: 3600 }, { headers: { Cookie: cookieB } });

  const consumed = await fetch(`${base}${handoffPath}`, { method: 'POST', redirect: 'manual', headers: { Cookie: cookieB } });
  assert.equal(consumed.status, 302);
  assert.ok(revokeCalls.includes('rOld'));

  const newCookie = cookieOf(consumed);
  await postJson('/api/pair/disconnect', {}, { headers: { Cookie: newCookie || cookieB } });
});

// Last: exhausts the pair/start rate-limit bucket for this client, so every
// earlier test that needs a working /api/pair/start must run before this one.
test('/api/pair/start rate-limits repeated calls from the same client', async () => {
  let last;
  for (let i = 0; i < 21; i += 1) last = await postJson('/api/pair/start', {});
  assert.equal(last.status, 429);
});
