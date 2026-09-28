import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

/**
 * PAIR_MAX/HANDOFF_MAX/TOKEN_STORE_MAX cap the in-memory pairs, handoffs and
 * tokenStore maps so an attacker looping pair/start (unauthenticated) can't
 * grow them without bound. Uses small overrides so the caps are cheap to
 * reach; runs its own server so it doesn't affect the other test files'
 * default (large) caps.
 */

process.env.TOKEN_ENC_KEY = randomBytes(32).toString('base64');
process.env.PORT = '0';
process.env.PAIR_MAX = '2';
process.env.HANDOFF_MAX = '3';
process.env.TOKEN_STORE_MAX = '1';

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (!u.startsWith('https://api.awsevents.com/') && !u.startsWith('https://oauth.awsevents.com/')) return realFetch(url, opts);
  if (u.startsWith('https://api.awsevents.com/v1/events/reinvent2026/sessions')) {
    return { status: 200, ok: true, text: async () => JSON.stringify({ items: [], totalCount: 0 }) };
  }
  if (u === 'https://oauth.awsevents.com/oauth2/revoke') return { status: 200, ok: true, text: async () => '' };
  throw new Error(`unmocked AWS call: ${opts.method || 'GET'} ${u}`);
};

const { default: server } = await import('../index.mjs');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
const base = `http://localhost:${server.address().port}`;
after(() => { globalThis.fetch = realFetch; server.close(); });

function postJson(path, body, opts = {}) {
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, body: JSON.stringify(body) });
}
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];

// Uses up both PAIR_MAX=2 slots (kept alive, not swept, for the rest of this
// file), so run this before any test that expects a fresh pair/start to
// succeed.
test('/api/pair/complete returns 503 once TOKEN_STORE_MAX visitors are paired', async () => {
  const startA = await postJson('/api/pair/start', {});
  const cookieA = cookieOf(startA);
  const { code: codeA } = await startA.json();
  const completeA = await postJson('/api/pair/complete', { code: codeA, access_token: 'a', refresh_token: 'ra', expires_in: 3600 }, { headers: { Cookie: cookieA } });
  assert.equal(completeA.status, 200);

  const startB = await postJson('/api/pair/start', {});
  const cookieB = cookieOf(startB);
  const { code: codeB } = await startB.json();
  const completeB = await postJson('/api/pair/complete', { code: codeB, access_token: 'b', refresh_token: 'rb', expires_in: 3600 }, { headers: { Cookie: cookieB } });
  assert.equal(completeB.status, 503);
  assert.equal((await completeB.json()).error, 'too_busy');
});

test('/api/pair/start returns 503 once PAIR_MAX pairs are outstanding', async () => {
  const res = await postJson('/api/pair/start', {}, { headers: { Cookie: 'x=3' } });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'too_busy');
});
