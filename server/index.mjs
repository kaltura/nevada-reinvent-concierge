/**
 * Nevada backend: static web app, Web API and tool proxy. Design: ARCHITECTURE.md.
 *
 * Phase 1: encrypted token store, real pairing completion, catalog sync and
 * search (option B: our own lexical index, no embedding provider configured),
 * and all 12 server tool handlers calling the AWS Events API through server/aws.mjs.
 * State is in memory, so a restart forgets everything (tokens, catalog, refs).
 * Binds to localhost only by default (see HOST below); the other Phase 1
 * relaxations here (no auth beyond pairing, no persistence) all assume that.
 *
 * The catalog sync job is meant to run on its own AWS service registration
 * (AWS-EVENTS-INTEGRATION.md § Catalog sync), which we don't have. For local
 * testing we opportunistically sync using the first attendee's access token
 * right after pairing, since ListSessions only needs a registered attendee's
 * token, not specifically a service one. Replace with a dedicated credential
 * before Phase 2 (many attendees).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { Management } from '@kaltura/intelligent-agents/management';
import { makeTokenStore } from './tokens.mjs';
import { makeCatalog } from './catalog.mjs';
import { withToken, getSchedule, getUserSub, revokeRefreshToken } from './aws.mjs';
import { TOOL_HANDLERS, makeToolCtx } from './tools.mjs';
import { sessionCard, buildTimeline } from './schedule.mjs';
import { EVENT_DAYS } from './dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'client');
// Tests point this at a fixture so they never read the real file.
const AGENT_JSON = process.env.NEVADA_AGENT_JSON || join(ROOT, 'server', 'agent.json');
const {
  PORT = '8080', HOST = '127.0.0.1', PUBLIC_ORIGIN,
  KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET, TOKEN_ENC_KEY,
  PAIR_MAX = '2000', HANDOFF_MAX = '2000', TOKEN_STORE_MAX = '5000',
} = process.env;
for (const [name, value] of Object.entries({ TOKEN_ENC_KEY, KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET })) {
  if (!value) { console.error(`Set ${name} in .env`); process.exit(2); }
}

const PAIR_TTL_MS = 10 * 60 * 1000;
// No 0/O or 1/I, so a code read off a phone can't be mistyped.
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOOLS = new Set(Object.keys(TOOL_HANDLERS));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const pairs = new Map(); // code -> { visitor, state, expires }
const handoffs = new Map(); // token -> { visitor, expires }
// A handoff token is a bearer credential for the whole AWS session (whoever
// holds it can consume it and take over that pairing), so the window it
// stays valid in is kept short.
const HANDOFF_TTL_MS = 2 * 60 * 1000;
const tokenStore = makeTokenStore(TOKEN_ENC_KEY);
const catalog = makeCatalog();
// Server-side only: the admin secret mints each attendee's agent session and
// never reaches the browser. ARCHITECTURE.md § Identity.
const kaltura = new Management({ partnerId: Number(KALTURA_PARTNER_ID), adminSecret: KALTURA_ADMIN_SECRET });

const token = () => randomBytes(24).toString('base64url');

// Signs the visitor cookie so a client can't forge an arbitrary value: only
// an id this server minted and signed is ever accepted back. That alone
// doesn't stop session fixation (an attacker could still visit first, get a
// validly signed cookie of their own, and plant that on a shared device
// ahead of a victim), so /api/pair/status also rotates the id the moment a
// pairing it's watching turns "paired" (see below), the same way handoffConsume
// already does for a phone handoff.
const COOKIE_KEY = createHmac('sha256', Buffer.from(TOKEN_ENC_KEY, 'base64')).update('nevada-visitor-cookie-v1').digest();
const sign = (id) => createHmac('sha256', COOKIE_KEY).update(id).digest('base64url').slice(0, 16);
function validSignature(id, sig) {
  const want = Buffer.from(sign(id));
  const got = Buffer.from(String(sig));
  return want.length === got.length && timingSafeEqual(want, got);
}

// The attendee's Kaltura userId: a keyed hash of their AWS `sub`, so Kaltura
// sees the same id every visit but never the AWS id itself. Rotating
// TOKEN_ENC_KEY changes every userId.
const USER_ID_KEY = createHmac('sha256', Buffer.from(TOKEN_ENC_KEY, 'base64')).update('nevada-kaltura-user-id-v1').digest();
const kalturaUserId = (sub) => `aws-${createHmac('sha256', USER_ID_KEY).update(sub).digest('base64url').slice(0, 32)}`;

// Simple sliding-window rate limit per client IP and route, to blunt
// unauthenticated brute-forcing and looped pairing/handoff calls.
const rateBuckets = new Map(); // `${ip}:${route}` -> timestamps
function rateLimited(req, route, max, windowMs) {
  const key = `${req.socket.remoteAddress}:${route}`;
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  rateBuckets.set(key, recent);
  // A distinct IP:route key never gets removed just by going quiet, so an
  // unbounded number of one-off clients would otherwise grow this forever.
  // Once it's large, sweep out anything with no activity inside this call's
  // own window instead of waiting for a dedicated timer.
  if (rateBuckets.size > 10000) {
    for (const [k, v] of rateBuckets) if (!v.some((t) => now - t < windowMs)) rateBuckets.delete(k);
  }
  return recent.length > max;
}

// Origin/Sec-Fetch-Site check for state-changing requests. Both headers are
// browser-only, so a server-to-server caller (the pair helper posting to
// /api/pair/complete) sends neither and passes through untouched.
//
// Sec-Fetch-Site is the authority whenever a browser sends it: it can't be
// spoofed by a page, unlike Origin, which a same-origin form POST can send as
// the literal string "null" (for example when Referrer-Policy: no-referrer
// is set, as it is here). Falling back to comparing that "null" against our
// own origin would wrongly reject the request, so only fall back to Origin
// when Sec-Fetch-Site is absent entirely.
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const o = req.headers.origin;
  return !o || o === origin(req);
}

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

function issueVisitorCookie(res, id) {
  // __Host- (requires Secure, Path=/, no Domain, all already true here) stops
  // a sibling subdomain or a plain-HTTP sibling port from ever setting this
  // cookie on our behalf.
  res.setHeader('Set-Cookie', `__Host-mq_v=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 60}`);
}

/** The visitor id on this request, only if it carries our own signature. */
function peekVisitor(req) {
  const found = /(?:^|;\s*)__Host-mq_v=([\w-]{32})\.([\w-]+)/.exec(req.headers.cookie || '');
  return found && validSignature(found[1], found[2]) ? found[1] : null;
}

function visitor(req, res) {
  const found = peekVisitor(req);
  if (found) return found;
  const id = token();
  issueVisitorCookie(res, id);
  return id;
}

/** Mint a fresh visitor id and set it, ignoring any id already on the
 * request. Used when binding tokens to a browser (handoff) so a cookie an
 * attacker planted ahead of time can't end up holding the real tokens. */
function rotateVisitor(res) {
  const id = token();
  issueVisitorCookie(res, id);
  return id;
}

function sweep(map) { const now = Date.now(); for (const [k, v] of map) if (v.expires < now) map.delete(k); }

// Set PUBLIC_ORIGIN once deployed behind a tunnel or proxy: req.headers.host
// is still the real public host, but req.headers['x-forwarded-proto'] is
// only as trustworthy as whatever sits in front of us, and an attacker's
// browser controls both on a direct request. PUBLIC_ORIGIN is trusted
// because only the operator sets it.
function origin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  return `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
}

// Refuse any request whose Host doesn't match where we actually are, so a
// DNS-rebinding page (an attacker-controlled domain that resolves to
// 127.0.0.1) can't reach the unauthenticated pairing endpoints through a
// victim's browser using a spoofed Host. With PUBLIC_ORIGIN set, only that
// host is allowed; otherwise only the usual local hostnames on our own port.
function hostAllowed(req) {
  if (PUBLIC_ORIGIN) return req.headers.host === new URL(PUBLIC_ORIGIN).host;
  // req.socket.localPort, not the PORT env var: PORT can be '0' (let the OS
  // pick, as the tests do), in which case only the socket knows the real port.
  const port = req.socket.localPort;
  return ['localhost', '127.0.0.1', '[::1]'].map((h) => `${h}:${port}`).includes(req.headers.host);
}

let syncInFlight = null;

/** First-pairing-only opportunistic sync. See file header. */
function syncSoon(accessToken) {
  if (catalog.size() > 0 || syncInFlight) return;
  syncInFlight = catalog.sync(accessToken)
    .then(({ count, totalCount }) => {
      console.log(`catalog sync: ${count} of ${totalCount} sessions`);
      if (count && catalog.tags() !== readFileSync(join(ROOT, 'prompts', 'catalog-tags.md'), 'utf8').trim()) {
        console.warn('catalog tags changed. Run npm run catalog-tags, then npm run update-prompts.');
      }
    })
    .catch((e) => console.error('catalog sync failed:', e.message))
    .finally(() => { syncInFlight = null; });
}

async function api(req, res, path) {
  if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });

  if (path === '/api/agent/init' && req.method === 'POST') {
    if (rateLimited(req, 'agent/init', 10, 60 * 1000)) return send(res, 429, { error: 'too_many_requests' });
    // Paired attendees only, so every agent session carries a real userId.
    const userId = tokenStore.get(visitor(req, res))?.userId;
    if (!userId) return send(res, 401, { error: 'not_paired' });
    if (!existsSync(AGENT_JSON)) return send(res, 503, { error: 'not_provisioned', fix: 'npm run provision' });
    const { configId, agentId } = JSON.parse(readFileSync(AGENT_JSON, 'utf8'));
    const conv = await kaltura.sessions.createConversationToken({ configId, userId, extraPrivileges: `agentid:${agentId}` });
    const { ks, conversationManagerUrl, srsBaseUrl, turnServerUrl } = await kaltura.application.appInit(conv.ks);
    return send(res, 200, { ks, conversationManagerUrl, srsBaseUrl, turnServerUrl });
  }
  if (path === '/api/pair/start' && req.method === 'POST') {
    if (rateLimited(req, 'pair/start', 20, 60 * 1000)) return send(res, 429, { error: 'too_many_requests' });
    sweep(pairs);
    if (pairs.size >= Number(PAIR_MAX)) return send(res, 503, { error: 'too_busy' });
    let code;
    do code = Array.from({ length: 6 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]).join('');
    while (pairs.has(code));
    const expires = Date.now() + PAIR_TTL_MS;
    pairs.set(code, { visitor: visitor(req, res), state: 'waiting', expires });
    // Arguments, not a `VAR=value` prefix, so it runs in any shell,
    // Windows included. -y skips npx's install prompt and @latest skips a
    // stale cached copy.
    const command = `npx -y nevada-pair@latest ${code} ${origin(req)}`;
    return send(res, 200, { code, expiresAt: new Date(expires).toISOString(), command });
  }
  // The helper asks before opening AWS sign-in, so a dead code or wrong
  // URL fails before the attendee signs in, not after. Tells no more than
  // /api/pair/complete's own 404 already does.
  const pairCheck = /^\/api\/pair\/check\/([A-Z0-9]{6})$/.exec(path);
  if (pairCheck && req.method === 'GET') {
    if (rateLimited(req, 'pair/check', 30, 10 * 60 * 1000)) return send(res, 429, { error: 'too_many_requests' });
    const p = pairs.get(pairCheck[1]);
    return send(res, 200, { state: p && p.state === 'waiting' && p.expires >= Date.now() ? 'waiting' : 'expired' });
  }
  const status = /^\/api\/pair\/status\/([A-Z0-9]{6})$/.exec(path);
  if (status && req.method === 'GET') {
    const p = pairs.get(status[1]);
    if (!p || p.visitor !== visitor(req, res) || p.expires < Date.now()) return send(res, 200, { state: 'expired' });
    // The first poll to see "paired" rotates the visitor id, so a cookie an
    // attacker planted on this device before pairing started (session
    // fixation) never ends up holding the real tokens: only the freshly
    // minted id this response sets does.
    if (p.state === 'paired' && !p.rotated) {
      p.rotated = true;
      const fresh = rotateVisitor(res);
      const tokens = tokenStore.get(p.visitor);
      if (tokens) {
        const expires_in = Math.max(1, Math.round((tokens.expiresAt - Date.now()) / 1000));
        tokenStore.set(fresh, { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in, pairingId: tokens.pairingId, userId: tokens.userId });
      }
      tokenStore.delete(p.visitor);
      // The handoffs /api/pair/complete just minted still point at the old id.
      for (const h of handoffs.values()) if (h.visitor === p.visitor) h.visitor = fresh;
      p.visitor = fresh;
    }
    return send(res, 200, { state: p.state });
  }
  if (path === '/api/pair/complete' && req.method === 'POST') {
    if (rateLimited(req, 'pair/complete', 30, 10 * 60 * 1000)) return send(res, 429, { error: 'too_many_requests' });
    sweep(pairs);
    const body = await readJson(req).catch(() => null);
    if (!body) return send(res, 400, { error: 'bad_json' });
    const { code, access_token, refresh_token, expires_in } = body;
    const p = code && pairs.get(String(code).toUpperCase());
    if (!p || p.expires < Date.now()) return send(res, 404, { error: 'not_found' });
    // Single-use: once a code has paired, reject any further complete for it
    // instead of accepting whichever caller shows up last. Without this, an
    // attacker who knows or guesses the code can complete it first with junk
    // tokens, or overwrite a real pairing after the fact.
    if (p.state !== 'waiting') return send(res, 409, { error: 'already_used' });
    if (typeof access_token !== 'string' || typeof refresh_token !== 'string' || !Number.isFinite(expires_in)) {
      return send(res, 400, { error: 'bad_request' });
    }
    // Ask AWS who this is rather than trusting anything the helper sends.
    // This also rejects a made-up access token before it takes the code.
    const sub = await getUserSub(access_token);
    if (!sub) return send(res, 401, { error: 'aws_rejected_token' });
    // Another complete for this code may have won while we waited on AWS.
    if (p.state !== 'waiting') return send(res, 409, { error: 'already_used' });
    // Drop anyone idle for a week before the hard cap, so an attendee who
    // never disconnects doesn't hold a slot forever and eventually lock out
    // every new pairing with a permanent 503.
    tokenStore.sweep(7 * 24 * 60 * 60 * 1000);
    if (tokenStore.size() >= Number(TOKEN_STORE_MAX)) return send(res, 503, { error: 'too_busy' });
    p.state = 'paired';
    const pairingId = token();
    tokenStore.set(p.visitor, { access_token, refresh_token, expires_in, pairingId, userId: kalturaUserId(sub) });
    syncSoon(access_token);
    // pair/index.mjs's sign-in tab is a different HTTP client than whoever
    // called /api/pair/start; it only shares that caller's cookie by luck
    // (same browser, same profile). A handoff token makes the redirect work
    // regardless of whose cookie the tab actually has.
    //
    // Two separate tokens, not one shared between the helper's "open here"
    // button and its QR: either can be used on its own without the other
    // going stale, since each is consumed independently.
    sweep(handoffs);
    // Two handoffs are minted below, so leave room for both.
    if (handoffs.size + 2 > Number(HANDOFF_MAX)) return send(res, 200, { ok: true, handoffUrl: null, qrUrl: null });
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
    const revoked = tokens ? await revokeRefreshToken(tokens.refresh_token) : true;
    // Also drops any copy a phone handoff made under a different visitor id,
    // so Disconnect ends the whole pairing rather than just this device.
    if (tokens?.pairingId) tokenStore.deleteGroup(tokens.pairingId); else tokenStore.delete(v);
    return send(res, 200, { ok: true, revoked });
  }
  if (path === '/api/pair/handoff' && req.method === 'POST') {
    if (rateLimited(req, 'pair/handoff', 30, 10 * 60 * 1000)) return send(res, 429, { error: 'too_many_requests' });
    sweep(handoffs);
    const v = visitor(req, res);
    if (!tokenStore.has(v)) return send(res, 200, {});
    if (handoffs.size >= Number(HANDOFF_MAX)) return send(res, 503, { error: 'too_busy' });
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
    // The first load after pairing races the first sync. Without the catalog it has no picks.
    await syncInFlight;
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
      // timeline (buildTimeline drops anything with no sessionTime). Surface
      // them once, outside the grid, or a favorite just vanishes.
      unscheduledFavorites: favoriteCards.filter((s) => !s.day),
      focus: focusIds ?? null,
      // The attendee's own top topic from what they've reserved or favorited,
      // for a personalized opening line. See OPENING_PHRASE in scripts/provision.mjs.
      topInterest: catalog.topTopic(excludeIds),
    });
  }
  return send(res, 404, { error: 'not_found' });
}

// Called by the page itself (a native `client` tool), never by Kaltura's
// cloud, so identity is the same HttpOnly visitor cookie every other Web API
// route already trusts. ARCHITECTURE.md § Tools.
async function tool(req, res, name) {
  if (req.method !== 'POST' || !TOOLS.has(name)) return send(res, 404, { error: 'not_found' });
  if (!sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });
  const v = visitor(req, res);
  const args = await readJson(req).catch(() => ({}));
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return send(res, 200, { answer: "That didn't work. Try again in a moment." });
  }
  await syncInFlight; // search and titles need the catalog
  try {
    const ctx = makeToolCtx(catalog, tokenStore, v);
    const result = await TOOL_HANDLERS[name](args, ctx);
    return send(res, 200, result);
  } catch (e) {
    // Never log e.body: an AwsError's body is AWS's raw response and can
    // hold the attendee's own schedule data.
    console.error(`tool ${name} error:`, e.name, e.status ?? '', e.code ?? '', e.status === undefined ? e.message : '');
    return send(res, 200, { answer: "That didn't work. Try again in a moment." });
  }
}

// Single-use: a paired device hands its AWS tokens to whichever device
// confirms this link, then the token is gone so it can't be replayed.
// ARCHITECTURE.md § Pairing.
//
// GET only shows a confirm page; consuming the token happens on POST, which
// sameOrigin() only accepts from a request our own page made. A bare GET
// redirect here would let a cross-site link or an attacker's own QR silently
// swap the opener's AWS account for the attacker's (login CSRF) with no
// click required. The confirm page needs one real click before that happens.
function handoffPage(code, alreadyPaired) {
  const warning = alreadyPaired
    ? '<p>This browser is already connected to an AWS account. Continuing replaces that connection.</p>'
    : '';
  return '<!doctype html><meta charset="utf-8"><title>Continue on this device</title>'
    + '<body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px;box-sizing:border-box">'
    + `<div style="max-width:360px"><h1>Continue on this device?</h1>${warning}`
    + `<form method="POST" action="/?handoff=${code}"><button style="padding:14px 24px;border-radius:10px;border:0;background:#fff;color:#121212;font-weight:600;font-size:16px" type="submit">Continue</button></form>`
    + '</div></body>';
}

async function handoffShow(req, res, code) {
  sweep(handoffs);
  if (!handoffs.has(code)) { res.writeHead(302, { Location: '/?handoff_failed=1' }); return res.end(); }
  const alreadyPaired = tokenStore.has(peekVisitor(req) ?? '');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(handoffPage(code, alreadyPaired));
}

async function handoffConsume(req, res, code) {
  if (!sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });
  sweep(handoffs);
  const h = handoffs.get(code);
  handoffs.delete(code);
  const from = h && tokenStore.get(h.visitor);
  if (from) {
    // Replacing an existing connection revokes it first, and binds the new
    // tokens to a freshly minted id rather than whatever id (if any) this
    // request already carried, so a cookie an attacker set ahead of time
    // never ends up holding the handed-off tokens. Skip the revoke when the
    // prior cookie already holds this exact pairing (the common case: the
    // same browser that started pairing, or re-scanning a QR for a pairing
    // this device already has) or every device on that pairing would lose
    // access the moment one of them continues here.
    const priorVisitor = peekVisitor(req);
    const priorTokens = priorVisitor && tokenStore.get(priorVisitor);
    if (priorTokens && priorTokens.refresh_token !== from.refresh_token) await revokeRefreshToken(priorTokens.refresh_token);
    if (priorVisitor && priorVisitor !== h.visitor) tokenStore.delete(priorVisitor);
    const v = rotateVisitor(res);
    const expires_in = Math.max(1, Math.round((from.expiresAt - Date.now()) / 1000));
    tokenStore.set(v, { access_token: from.access_token, refresh_token: from.refresh_token, expires_in, pairingId: from.pairingId, userId: from.userId });
  }
  // A link already used or opened after HANDOFF_TTL_MS has no `from`. Say so
  // instead of a bare redirect: the gate looks identical either way, so the
  // attendee has no way to tell "never paired" from "this link is dead."
  res.writeHead(302, { Location: from ? '/' : '/?handoff_failed=1' });
  res.end();
}

async function serveStatic(req, res, rawPath) {
  let path;
  try { path = decodeURIComponent(rawPath); } catch { return send(res, 400, { error: 'bad_request' }); }
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
  // The page uses the mic and can trigger real reservation changes, so it
  // must never be frameable (clickjacking). X-Frame-Options covers browsers
  // that don't read frame-ancestors.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
  if (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  if (!hostAllowed(req)) return send(res, 421, { error: 'misdirected_request' });
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (path === '/' && url.searchParams.has('handoff')) {
      const code = url.searchParams.get('handoff');
      if (req.method === 'GET') return await handoffShow(req, res, code);
      if (req.method === 'POST') return await handoffConsume(req, res, code);
    }
    if (path.startsWith('/tools/')) return await tool(req, res, path.slice('/tools/'.length));
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method === 'GET') return await serveStatic(req, res, path);
    send(res, 405, { error: 'method_not_allowed' });
  } catch (e) {
    // Not console.error(e): an AwsError's .body can carry a real attendee's
    // schedule data (server/aws.mjs), which must never land in server logs.
    console.error('request failed:', e.name, e.status ?? '', e.code ?? '', e.status === undefined ? e.message : '');
    if (!res.headersSent) send(res, 500, { error: 'server_error' });
  }
}).listen(Number(PORT), HOST, () => console.log(`Nevada on http://${HOST}:${PORT}`));

// Exported so tests can find the ephemeral port and close it; unused in production.
export default server;
