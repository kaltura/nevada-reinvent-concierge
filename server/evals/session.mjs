/**
 * Pairing bootstrap for evals: reuses the app's own /api/pair/* endpoints,
 * never a separate login path. Pairing needs a real AWS Builder ID sign-in,
 * so this prints the pairing command and waits. The human runs it, never us.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), '.cache', 'paired-cookie.json');
const PAIR_TTL_MS = 10 * 60 * 1000;

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

async function postJson(baseUrl, path, body, cookie) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { res, json: await res.json(), cookie: cookieFrom(res) ?? cookie };
}

async function getJson(baseUrl, path, cookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
  return { res, json: await res.json(), cookie: cookieFrom(res) ?? cookie };
}

async function isPaired(baseUrl, cookie) {
  const { json } = await postJson(baseUrl, '/api/schedule', {}, cookie);
  return json.paired === true;
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return null;
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')).cookie; } catch { return null; }
}

// The cached cookie is a live bearer credential for the real AWS test
// account, valid for as long as the server process runs. Keep it readable
// only by the owner.
function saveCache(cookie) {
  const dir = dirname(CACHE_FILE);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The mode on mkdirSync/writeFileSync only applies when they create the
  // path; if the directory or file already existed with looser permissions,
  // chmod them explicitly so the bearer credential stays owner-only.
  chmodSync(dir, 0o700);
  writeFileSync(CACHE_FILE, JSON.stringify({ cookie }, null, 2), { mode: 0o600 });
  chmodSync(CACHE_FILE, 0o600);
}

/** A fresh, never-paired visitor cookie, for cases exercising the unpaired gate. */
export async function unpairedCookie(baseUrl) {
  const { cookie } = await postJson(baseUrl, '/api/schedule', {});
  return cookie;
}

/**
 * A cookie for a real paired AWS test identity. Reuses a cached cookie if
 * it's still paired; otherwise starts pairing and waits for the human to run
 * the printed command (constraint: only the user runs any real AWS login).
 */
export async function pairedCookie(baseUrl, { timeoutMs = PAIR_TTL_MS } = {}) {
  const cached = loadCache();
  if (cached && (await isPaired(baseUrl, cached))) return cached;

  const start = await postJson(baseUrl, '/api/pair/start', {});
  const { code, command } = start.json;
  const cookie = start.cookie;
  console.log(`\nEvals need a paired AWS test account. Run this yourself:\n\n  ${command}\n`);
  console.log('Waiting for pairing to complete...');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // The poll that sees "paired" rotates the visitor id, so keep the cookie it sets.
    const { json, cookie: rotated } = await getJson(baseUrl, `/api/pair/status/${code}`, cookie);
    if (json.state === 'paired') {
      saveCache(rotated);
      return rotated;
    }
    if (json.state === 'expired') throw new Error('pairing code expired before pairing completed');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('timed out waiting for pairing');
}
