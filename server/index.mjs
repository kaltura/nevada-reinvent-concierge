/**
 * Juno backend: static web app, Web API and tool proxy. Design: ARCHITECTURE.md.
 *
 * Built so far: static files, /api/config, visitor cookie and session_ref,
 * pairing codes, and the proxy's key check and thread pinning. Every tool
 * answers a fixed "not built yet" line, which is enough for the Phase 0
 * spikes. The rest answers 501 with the ROADMAP phase that builds it.
 * State is in memory, so a restart forgets everything.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
const AGENT_JSON = join(ROOT, 'server', 'agent.json');
const { PORT = '8080', PROXY_KEY, KALTURA_PARTNER_ID } = process.env;
if (!PROXY_KEY) { console.error('Set PROXY_KEY in .env'); process.exit(2); }

const REF_TTL_MS = 60 * 60 * 1000;
const PAIR_TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I, so a code read off a phone can't be mistyped.
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOOLS = new Set([
  'search_sessions', 'get_session', 'get_my_schedule', 'favorite_sessions', 'unfavorite_session',
  'reserve_sessions', 'cancel_reservation', 'swap_reservation',
  'add_personal_time', 'update_personal_time', 'delete_personal_time',
]);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const refs = new Map(); // session_ref → { visitor, thread, expires }
const pairs = new Map(); // code → { visitor, state, expires }

const token = () => randomBytes(24).toString('base64url');
const digest = (s) => createHash('sha256').update(s).digest();
const PROXY_KEY_DIGEST = digest(PROXY_KEY);
const short = (s) => digest(s).toString('hex').slice(0, 8); // log-safe tag for a ref

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
const notBuilt = (res, phase) => send(res, 501, { error: 'not_built', phase: `ROADMAP.md ${phase}` });

function readJson(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

function visitor(req, res) {
  const found = /(?:^|;\s*)mq_v=([\w-]{32})/.exec(req.headers.cookie || '');
  if (found) return found[1];
  const id = token();
  res.setHeader('Set-Cookie', `mq_v=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 60}`);
  return id;
}

function sweep(map) { const now = Date.now(); for (const [k, v] of map) if (v.expires < now) map.delete(k); }

async function api(req, res, path) {
  if (path === '/api/config' && req.method === 'GET') {
    if (!existsSync(AGENT_JSON)) return send(res, 503, { error: 'not_provisioned', fix: 'npm run provision' });
    const { widgetId } = JSON.parse(readFileSync(AGENT_JSON, 'utf8'));
    return send(res, 200, { partnerId: KALTURA_PARTNER_ID, widgetId });
  }
  if (path === '/api/session-ref' && req.method === 'POST') {
    sweep(refs);
    const ref = token();
    refs.set(ref, { visitor: visitor(req, res), thread: null, expires: Date.now() + REF_TTL_MS });
    return send(res, 200, { sessionRef: ref });
  }
  if (path === '/api/pair/start' && req.method === 'POST') {
    sweep(pairs);
    let code;
    do code = Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join('');
    while (pairs.has(code));
    const expires = Date.now() + PAIR_TTL_MS;
    pairs.set(code, { visitor: visitor(req, res), state: 'waiting', expires });
    return send(res, 200, { code, expiresAt: new Date(expires).toISOString(), command: `npx juno-pair ${code}` });
  }
  const status = /^\/api\/pair\/status\/([A-Z0-9]{6})$/.exec(path);
  if (status && req.method === 'GET') {
    const p = pairs.get(status[1]);
    if (!p || p.visitor !== visitor(req, res) || p.expires < Date.now()) return send(res, 200, { state: 'expired' });
    return send(res, 200, { state: p.state });
  }
  // Needs the encrypted token store before it can accept tokens.
  if (path === '/api/pair/complete' && req.method === 'POST') return notBuilt(res, 'Phase 1');
  if (path === '/api/schedule' || path === '/api/sessions') return notBuilt(res, 'Phase 1');
  return send(res, 404, { error: 'not_found' });
}

async function tool(req, res, name) {
  if (req.method !== 'POST' || !TOOLS.has(name)) return send(res, 404, { error: 'not_found' });
  if (!timingSafeEqual(digest(String(req.headers['x-proxy-key'] || '')), PROXY_KEY_DIGEST)) return send(res, 401, { error: 'bad_key' });
  const ref = String(req.headers['x-session-ref'] || '');
  const thread = String(req.headers['x-thread'] || '');
  const entry = refs.get(ref);
  if (!entry || entry.expires < Date.now()) {
    console.log(`tool ${name}: unknown ref ${ref ? short(ref) : '(empty)'} thread ${thread || '(empty)'}`);
    return send(res, 200, { answer: 'I lost track of who you are. Reload the page, then ask again.' });
  }
  // Pin the ref to the first thread that uses it. A ref from another thread is refused.
  entry.thread ??= thread;
  if (entry.thread !== thread) {
    console.log(`tool ${name}: ref ${short(ref)} pinned to another thread, refused ${thread}`);
    return send(res, 200, { answer: 'That request came from another conversation, so I refused it.' });
  }
  const args = await readJson(req).catch(() => ({}));
  console.log(`tool ${name}: ref ${short(ref)} thread ${thread} args ${Object.keys(args).join(',') || '-'}`);
  return send(res, 200, { answer: `${name} isn't built yet. Say that planning tools arrive soon.` });
}

async function serveStatic(req, res, path) {
  const file = normalize(join(CLIENT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(CLIENT + '/')) return send(res, 404, { error: 'not_found' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { send(res, 404, { error: 'not_found' }); }
}

createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  try {
    const path = new URL(req.url, 'http://x').pathname;
    if (path.startsWith('/tools/')) return await tool(req, res, path.slice('/tools/'.length));
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method === 'GET') return await serveStatic(req, res, decodeURIComponent(path));
    send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
}).listen(Number(PORT), () => console.log(`Juno on http://localhost:${PORT}`));
