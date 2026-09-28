/**
 * Nevada backend: static web app, Web API and tool proxy. Design: ARCHITECTURE.md.
 *
 * Phase 1: encrypted token store, real pairing completion, catalog sync and
 * search (option B: our own lexical index, no embedding provider configured),
 * and all 12 server tool handlers calling the AWS Events API through server/aws.mjs.
 * State is in memory, so a restart forgets everything (tokens, catalog, refs).
 *
 * The catalog sync job is meant to run on its own AWS service registration
 * (AWS-EVENTS-INTEGRATION.md § Catalog sync) — we don't have one. For local
 * testing we opportunistically sync using the first attendee's access token
 * right after pairing, since ListSessions only needs a registered attendee's
 * token, not specifically a service one. Replace with a dedicated credential
 * before Phase 2 (many attendees).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { makeTokenStore } from './tokens.mjs';
import { makeCatalog } from './catalog.mjs';
import { withToken, getSchedule, revokeRefreshToken } from './aws.mjs';
import { TOOL_HANDLERS, makeToolCtx } from './tools.mjs';
import { sessionCard, buildTimeline } from './schedule.mjs';
import { EVENT_DAYS } from './dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
const AGENT_JSON = join(ROOT, 'server', 'agent.json');
const PAIR_SCRIPT = join(ROOT, 'pair', 'index.mjs');
const { PORT = '8080', KALTURA_PARTNER_ID, TOKEN_ENC_KEY } = process.env;
if (!TOKEN_ENC_KEY) { console.error('Set TOKEN_ENC_KEY in .env'); process.exit(2); }

const PAIR_TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I, so a code read off a phone can't be mistyped.
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOOLS = new Set(Object.keys(TOOL_HANDLERS));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const pairs = new Map(); // code → { visitor, state, expires }
const handoffs = new Map(); // token → { visitor, expires }
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const tokenStore = makeTokenStore(TOKEN_ENC_KEY);
const catalog = makeCatalog();

const token = () => randomBytes(24).toString('base64url');

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

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

// Behind a tunnel or proxy, req.headers.host is still the real public host,
// but the scheme isn't: cloudflared and friends terminate TLS and forward
// plain HTTP, setting X-Forwarded-Proto for us to recover it.
function origin(req) {
  return `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
}

/** First-pairing-only opportunistic sync. See file header. */
function syncSoon(accessToken) {
  if (catalog.size() > 0) return;
  catalog.sync(accessToken)
    .then(({ count, totalCount }) => console.log(`catalog sync: ${count} of ${totalCount} sessions`))
    .catch((e) => console.error('catalog sync failed:', e.message));
}

async function api(req, res, path) {
  if (path === '/api/config' && req.method === 'GET') {
    if (!existsSync(AGENT_JSON)) return send(res, 503, { error: 'not_provisioned', fix: 'npm run provision' });
    const { widgetId } = JSON.parse(readFileSync(AGENT_JSON, 'utf8'));
    return send(res, 200, { partnerId: KALTURA_PARTNER_ID, widgetId });
  }
  if (path === '/api/pair/start' && req.method === 'POST') {
    sweep(pairs);
    let code;
    do code = Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join('');
    while (pairs.has(code));
    const expires = Date.now() + PAIR_TTL_MS;
    pairs.set(code, { visitor: visitor(req, res), state: 'waiting', expires });
    // The helper defaults NEVADA_URL to a placeholder domain, so pass our
    // real origin. req.headers.host is whatever host the browser actually
    // used, so this stays correct once deployed publicly too.
    // `npx nevada-pair` only works once that package is published; until
    // then run the local script directly so pairing actually works.
    const command = `NEVADA_URL=${origin(req)} node "${PAIR_SCRIPT}" ${code}`;
    return send(res, 200, { code, expiresAt: new Date(expires).toISOString(), command });
  }
  const status = /^\/api\/pair\/status\/([A-Z0-9]{6})$/.exec(path);
  if (status && req.method === 'GET') {
    const p = pairs.get(status[1]);
    if (!p || p.visitor !== visitor(req, res) || p.expires < Date.now()) return send(res, 200, { state: 'expired' });
    return send(res, 200, { state: p.state });
  }
  if (path === '/api/pair/complete' && req.method === 'POST') {
    sweep(pairs);
    const body = await readJson(req).catch(() => null);
    if (!body) return send(res, 400, { error: 'bad_json' });
    const { code, access_token, refresh_token, expires_in } = body;
    const p = code && pairs.get(String(code).toUpperCase());
    if (!p || p.expires < Date.now()) return send(res, 404, { error: 'not_found' });
    if (!access_token || !refresh_token || !expires_in) return send(res, 400, { error: 'bad_request' });
    tokenStore.set(p.visitor, { access_token, refresh_token, expires_in });
    p.state = 'paired';
    syncSoon(access_token);
    // pair/index.mjs's sign-in tab is a different HTTP client than whoever
    // called /api/pair/start — it only shares that caller's cookie by luck
    // (same browser, same profile). A handoff token makes the redirect work
    // regardless of whose cookie the tab actually has.
    //
    // Two separate tokens, not one shared between the helper's "open here"
    // button and its QR: either can be used on its own without the other
    // going stale, since each is consumed independently.
    sweep(handoffs);
    const mint = (base) => {
      const t = token();
      handoffs.set(t, { visitor: p.visitor, expires: Date.now() + HANDOFF_TTL_MS });
      return `${base}/?handoff=${t}`;
    };
    return send(res, 200, { ok: true, handoffUrl: mint(origin(req)), qrUrl: mint(origin(req)) });
  }
  if (path === '/api/pair/disconnect' && req.method === 'POST') {
    // ARCHITECTURE.md § Pairing: revoke the refresh token at AWS, then delete
    // our copy. Revoking doesn't kill an access token already issued (that
    // dies on its own within 60 minutes), and doesn't end the attendee's
    // Builder ID browser session, only this app's access.
    const v = visitor(req, res);
    const tokens = tokenStore.get(v);
    if (tokens) await revokeRefreshToken(tokens.refresh_token);
    tokenStore.delete(v);
    return send(res, 200, { ok: true });
  }
  if (path === '/api/pair/handoff' && req.method === 'POST') {
    sweep(handoffs);
    const v = visitor(req, res);
    if (!tokenStore.has(v)) return send(res, 200, {});
    const t = token();
    handoffs.set(t, { visitor: v, expires: Date.now() + HANDOFF_TTL_MS });
    return send(res, 200, { url: `${origin(req)}/?handoff=${t}` });
  }
  if (path === '/api/sessions' && req.method === 'POST') {
    const { ids } = await readJson(req).catch(() => ({}));
    return send(res, 200, { sessions: catalog.getMany(ids).map(sessionCard) });
  }
  if (path === '/api/schedule' && req.method === 'POST') {
    const { day, focusIds, recap } = await readJson(req).catch(() => ({}));
    const v = visitor(req, res);
    if (!tokenStore.has(v)) return send(res, 200, { paired: false });
    const outcome = await withToken(tokenStore, v, (t) => getSchedule(t));
    if (!outcome.paired) return send(res, 200, { paired: false, expired: Boolean(outcome.expired) });
    const { reserved = [], favorites = [], personalTime = [] } = outcome.result ?? {};
    if (recap) {
      const items = catalog.getMany(reserved);
      const venues = [...new Set(items.map((s) => s.venue).filter(Boolean))];
      const dayCounts = new Map();
      for (const s of items) if (s.sessionTime?.date) dayCounts.set(s.sessionTime.date, (dayCounts.get(s.sessionTime.date) || 0) + 1);
      const days = [...dayCounts.keys()];
      // "YYYY-MM-DD", matching the values already in `days`, or null with
      // nothing dated. The date with the most reserved sessions, ties broken
      // by whichever came first in `items`.
      const busiestDay = [...dayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return send(res, 200, { paired: true, recap: { totalSessions: items.length, venues, days, busiestDay } });
    }
    const reservedCards = catalog.getMany(reserved).map(sessionCard);
    const favoriteCards = catalog.getMany(favorites).map(sessionCard);
    const timeline = buildTimeline(day, reservedCards, favoriteCards, personalTime);
    // Interest signal for recommend() below: topics from what the attendee
    // already reserved or favorited, from the full (not sessionCard-mapped,
    // which drops topics) session records.
    const excludeIds = [...reserved, ...favorites];
    const interestTopics = [...new Set(catalog.getMany(excludeIds).flatMap((s) => s.topics || []))];
    // Desktop shows every day at once (DESIGN.md § Layout). Cheap to build
    // alongside the single day since buildTimeline already scans everything.
    const week = Object.keys(EVENT_DAYS).map((d) => {
      const t = buildTimeline(d, reservedCards, favoriteCards, personalTime);
      const recommended = catalog.recommend(d, interestTopics, excludeIds, 3).map(sessionCard);
      return { day: t.day, blocks: t.blocks, recommended };
    });
    return send(res, 200, {
      paired: true,
      day: timeline.day,
      blocks: timeline.blocks,
      clashDays: timeline.clashDays,
      week,
      recommended: week.find((w) => w.day === timeline.day)?.recommended ?? [],
      reserved: reservedCards.filter((s) => s.day === timeline.day),
      favorites: favoriteCards.filter((s) => s.day === timeline.day),
      // AWS hasn't given these a time yet, so they never land in any day's
      // timeline (buildTimeline drops anything with no sessionTime) — surface
      // them once, outside the grid, or a favorite just vanishes.
      unscheduledFavorites: favoriteCards.filter((s) => !s.day),
      focus: focusIds ?? null,
      // Real top tracks from the synced catalog, for the suggestion chips
      // (no enums to pick from — AWS-EVENTS-INTEGRATION.md § Session shape).
      topics: catalog.topTracks(6),
      // The attendee's own top topic from what they've reserved or favorited,
      // for a personalized opening line. scripts/provision.mjs § OPENING_PHRASE.
      topInterest: catalog.topTopic(excludeIds),
    });
  }
  return send(res, 404, { error: 'not_found' });
}

// Called by the page itself (a native `client` tool), never by Kaltura's
// cloud — so identity is the same HttpOnly visitor cookie every other Web API
// route already trusts. ARCHITECTURE.md § Tools.
async function tool(req, res, name) {
  if (req.method !== 'POST' || !TOOLS.has(name)) return send(res, 404, { error: 'not_found' });
  const v = visitor(req, res);
  const args = await readJson(req).catch(() => ({}));
  try {
    const ctx = makeToolCtx(catalog, tokenStore, v);
    const result = await TOOL_HANDLERS[name](args, ctx);
    return send(res, 200, result);
  } catch (e) {
    console.error(`tool ${name} error:`, e);
    return send(res, 200, { answer: "That didn't work. Try again in a moment." });
  }
}

// Single-use: a paired device hands its AWS tokens to whichever device loads
// this link, then the token is gone so it can't be replayed. ARCHITECTURE.md § Pairing.
async function handoff(req, res, code) {
  sweep(handoffs);
  const h = handoffs.get(code);
  handoffs.delete(code);
  const from = h && tokenStore.get(h.visitor);
  if (from) {
    const v = visitor(req, res);
    const expires_in = Math.max(1, Math.round((from.expiresAt - Date.now()) / 1000));
    tokenStore.set(v, { access_token: from.access_token, refresh_token: from.refresh_token, expires_in });
  }
  // A link already used or opened after HANDOFF_TTL_MS has no `from`. Say so
  // instead of a bare redirect: the gate looks identical either way, so the
  // attendee has no way to tell "never paired" from "this link is dead."
  res.writeHead(302, { Location: from ? '/' : '/?handoff_failed=1' });
  res.end();
}

async function serveStatic(req, res, path) {
  const file = normalize(join(CLIENT, path === '/' ? 'index.html' : path));
  if (!file.startsWith(CLIENT + '/')) return send(res, 404, { error: 'not_found' });
  try {
    const body = await readFile(file);
    // Pairing updates the page in place without a reload (see openPairing in
    // app.js), so a stale cached copy of app.js can silently keep running for
    // a whole session. Always revalidate instead of trusting a cached copy.
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { send(res, 404, { error: 'not_found' }); }
}

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/' && req.method === 'GET' && url.searchParams.has('handoff')) {
      return await handoff(req, res, url.searchParams.get('handoff'));
    }
    if (path.startsWith('/tools/')) return await tool(req, res, path.slice('/tools/'.length));
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method === 'GET') return await serveStatic(req, res, decodeURIComponent(path));
    send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
}).listen(Number(PORT), () => console.log(`Nevada on http://localhost:${PORT}`));

// Exported so tests can find the ephemeral port and close it; unused in production.
export default server;
