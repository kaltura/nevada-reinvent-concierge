/**
 * Nevada's local app: a single-user server bound to this machine. It serves
 * the page, the tool proxy and the AWS sign-in callback. Design:
 * ARCHITECTURE.md.
 *
 * Nothing here is shared between people. One signed-in attendee, tokens in a
 * 0600 file under `home`, no cookies. Access control is the loopback bind,
 * the Host check (DNS rebinding) and the same-origin check (cross-site POST).
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { makeTokenStore } from './tokens.mjs';
import { makeCatalog } from './catalog.mjs';
import { makeKaltura } from './kaltura.mjs';
import { withToken, getSchedule, signInRequest, exchangeCode, revokeRefreshToken } from './aws.mjs';
import { TOOL_HANDLERS, makeToolCtx, awsProblem } from './tools.mjs';
import { sessionCard, buildTimeline } from './schedule.mjs';
import { EVENT_DAYS } from './dates.mjs';

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
const SIGN_IN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_SIGN_INS = 20;
const SYNC_MAX_AGE_MS = 60 * 60 * 1000;
const SYNC_RETRY_MS = 60 * 1000;
const TOOLS = new Set(Object.keys(TOOL_HANDLERS));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

/**
 * @param {{home:string, widgetId:string|null}} options
 *   home: folder for tokens.json and catalog.json. widgetId: public Kaltura widget id.
 * @returns the http.Server. The caller picks the port and calls listen().
 */
export function createApp({ home, widgetId }) {
  const tokenStore = makeTokenStore(join(home, 'tokens.json'));
  const catalog = makeCatalog();
  const kaltura = widgetId ? makeKaltura(widgetId) : null;
  const pendingSignIns = new Map(); // state -> { verifier, redirectUri, expires }
  const catalogFile = join(home, 'catalog.json');
  let syncedAt = 0;
  let syncInFlight = null;
  let syncFailedAt = 0;

  try {
    const cached = JSON.parse(readFileSync(catalogFile, 'utf8'));
    catalog.seed(cached.sessions, cached.syncedAt);
    syncedAt = cached.syncedAt;
  } catch { /* no cache yet, or an unreadable one: sync fills it after sign-in */ }

  /** Refreshes the catalog with the attendee's own token. Never rejects. */
  function syncIfStale() {
    if (syncInFlight) return syncInFlight;
    if (!tokenStore.get() || (catalog.size() > 0 && Date.now() - syncedAt < SYNC_MAX_AGE_MS)) return null;
    // Without this, a sync that keeps failing on an empty catalog makes every request wait for a new one.
    if (Date.now() - syncFailedAt < SYNC_RETRY_MS) return null;
    syncInFlight = withToken(tokenStore, (t) => catalog.sync(t))
      .then((outcome) => {
        if (!outcome.paired) return;
        syncedAt = Date.now();
        console.log(`catalog sync: ${outcome.result.count} of ${outcome.result.totalCount} sessions`);
        mkdirSync(home, { recursive: true, mode: 0o700 });
        const tmp = `${catalogFile}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ syncedAt, sessions: outcome.result.raw }));
        renameSync(tmp, catalogFile);
      })
      .catch((e) => {
        syncFailedAt = Date.now();
        console.error('catalog sync failed:', e.name, e.status ?? '', e.message);
      })
      .finally(() => { syncInFlight = null; });
    return syncInFlight;
  }

  /** Waits for a sync only when there is nothing cached to answer from. */
  async function catalogReady() {
    const sync = syncIfStale();
    if (catalog.size() === 0) await sync;
  }

  // Origin/Sec-Fetch-Site check for state-changing requests. Sec-Fetch-Site is
  // the authority whenever a browser sends it: a page can't spoof it, unlike
  // Origin, which a same-origin form POST can send as the string "null" under
  // Referrer-Policy: no-referrer. Fall back to Origin only when it is absent.
  function sameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site) return site === 'same-origin' || site === 'none';
    const o = req.headers.origin;
    return !o || o === `http://${req.headers.host}`;
  }

  // Refuse any request whose Host isn't this machine on our own port, so a
  // DNS-rebinding page (an attacker domain that resolves to 127.0.0.1) can't
  // drive the app through the attendee's browser.
  function hostAllowed(req) {
    // req.socket.localPort, not a config value: port 0 lets the OS pick.
    const port = req.socket.localPort;
    return ['localhost', '127.0.0.1', '[::1]'].map((h) => `${h}:${port}`).includes(req.headers.host);
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  }

  function redirect(res, location) {
    res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
  }

  function readJson(req, limit = 16 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too_large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new Error('bad_json')); } });
      req.on('error', reject);
    });
  }

  // AWS only accepts the exact redirect URIs registered for this client:
  // http://127.0.0.1:<8484-8489>/callback. Always use that host form.
  const redirectUriFor = (req) => `http://127.0.0.1:${req.socket.localPort}/callback`;

  function signInStart(req, res) {
    // A top-level navigation from this page or the address bar passes. Another site's link doesn't.
    if (!sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });
    const now = Date.now();
    for (const [state, p] of pendingSignIns) if (p.expires < now) pendingSignIns.delete(state);
    while (pendingSignIns.size >= MAX_PENDING_SIGN_INS) pendingSignIns.delete(pendingSignIns.keys().next().value);
    const redirectUri = redirectUriFor(req);
    const { url, state, verifier } = signInRequest(redirectUri);
    pendingSignIns.set(state, { verifier, redirectUri, expires: now + SIGN_IN_TTL_MS });
    redirect(res, url);
  }

  // Only a state this server minted is accepted, and only once, so a forged
  // callback can't sign the attendee in to someone else's account.
  async function signInCallback(req, res, params) {
    const pending = pendingSignIns.get(params.get('state') ?? '');
    pendingSignIns.delete(params.get('state') ?? '');
    // Unknown covers a server restart mid sign-in too: pendingSignIns is in memory.
    if (!pending || pending.expires < Date.now()) return redirect(res, '/?signin=expired');
    if (params.get('error') === 'access_denied') return redirect(res, '/?signin=cancelled');
    if (params.get('error') || !params.get('code')) return redirect(res, '/?signin=failed');
    let tokens;
    try {
      tokens = await exchangeCode({ code: params.get('code'), verifier: pending.verifier, redirectUri: pending.redirectUri });
    } catch (e) {
      console.error('sign-in failed:', e.name, e.status ?? '', e.code ?? '');
      return redirect(res, '/?signin=failed');
    }
    try {
      tokenStore.set(tokens);
    } catch (e) {
      // e.message names the folder (unsafe_home, EACCES, EROFS), never a token.
      console.error(`Couldn't save your sign-in: ${e.message}\nSet NEVADA_HOME to a folder you own, then sign in again.`);
      return redirect(res, '/?signin=storage');
    }
    syncFailedAt = 0; // a new sign-in may fix what made the last sync fail
    syncIfStale();
    redirect(res, '/');
  }

  async function api(req, res, path) {
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });

    // The launcher asks this to find an instance that is already running.
    if (path === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, app: 'nevada-reinvent' });

    if (path === '/api/agent/init' && req.method === 'POST') {
      // Signed-in attendees only: the agent is only useful with a schedule to work on.
      if (!tokenStore.get()) return send(res, 401, { error: 'not_paired' });
      if (!kaltura) return send(res, 503, { error: 'not_provisioned' });
      try {
        return send(res, 200, await kaltura.appInit());
      } catch (e) {
        console.error('agent init failed:', e.message);
        return send(res, 502, { error: 'agent_unavailable' });
      }
    }
    if (path === '/api/signout' && req.method === 'POST') {
      // Revoke the refresh token at AWS, then delete our copy. An access token
      // already issued dies on its own within 60 minutes, and the attendee's
      // Builder ID browser session stays: this ends only this app's access.
      // Clear first, so a refresh already in flight can't write the tokens back.
      const tokens = tokenStore.get();
      tokenStore.clear();
      const revoked = tokens ? await revokeRefreshToken(tokens.refresh_token) : true;
      return send(res, 200, { ok: true, revoked });
    }
    if (path === '/api/sessions' && req.method === 'POST') {
      const { ids } = await readJson(req).catch(() => ({}));
      return send(res, 200, { sessions: catalog.getMany(ids).map(sessionCard) });
    }
    if (path === '/api/schedule' && req.method === 'POST') {
      const { day, focusIds, recap } = await readJson(req).catch(() => ({}));
      if (!tokenStore.get()) return send(res, 200, { paired: false });
      // The first load after sign-in races the first sync. Without the catalog it has no picks.
      await catalogReady();
      let outcome;
      try {
        outcome = await withToken(tokenStore, (t) => getSchedule(t));
      } catch (e) {
        // A 500 here would show a signed-in attendee the sign-in gate again, in a loop.
        console.error('schedule failed:', e.name, e.status ?? '', e.code ?? '', e.status === undefined ? e.message : '');
        return send(res, 200, { paired: true, error: awsProblem(e) });
      }
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

  // Called by the page itself (a native `client` tool). ARCHITECTURE.md § Tools.
  async function tool(req, res, name) {
    if (req.method !== 'POST' || !TOOLS.has(name)) return send(res, 404, { error: 'not_found' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'cross_site_blocked' });
    const args = await readJson(req).catch(() => ({}));
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return send(res, 200, { answer: "That didn't work. Try again in a moment." });
    }
    await catalogReady(); // search and titles need the catalog
    try {
      const ctx = makeToolCtx(catalog, tokenStore);
      const result = await TOOL_HANDLERS[name](args, ctx);
      return send(res, 200, result);
    } catch (e) {
      // Never log e.body: an AwsError's body is AWS's raw response and can
      // hold the attendee's own schedule data.
      console.error(`tool ${name} error:`, e.name, e.status ?? '', e.code ?? '', e.status === undefined ? e.message : '');
      return send(res, 200, { answer: "That didn't work. Try again in a moment." });
    }
  }

  async function serveStatic(req, res, rawPath) {
    let path;
    try { path = decodeURIComponent(rawPath); } catch { return send(res, 400, { error: 'bad_request' }); }
    const file = normalize(join(CLIENT, path === '/' ? 'index.html' : path));
    if (!file.startsWith(CLIENT + sep)) return send(res, 404, { error: 'not_found' });
    try {
      const body = await readFile(file);
      // Revalidate every time, or a stale cached app.js can keep running after an upgrade.
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch { send(res, 404, { error: 'not_found' }); }
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    // The page uses the mic and can change real reservations: never frameable (clickjacking).
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    if (!hostAllowed(req)) return send(res, 421, { error: 'misdirected_request' });
    try {
      const url = new URL(req.url, 'http://x');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/auth/start') return signInStart(req, res);
      if (req.method === 'GET' && path === '/callback') return await signInCallback(req, res, url.searchParams);
      if (path.startsWith('/tools/')) return await tool(req, res, path.slice('/tools/'.length));
      if (path.startsWith('/api/')) return await api(req, res, path);
      if (req.method === 'GET') return await serveStatic(req, res, path);
      send(res, 405, { error: 'method_not_allowed' });
    } catch (e) {
      // Not console.error(e): an AwsError's .body can carry the attendee's
      // schedule data (server/aws.mjs), which must never land in logs.
      console.error('request failed:', e.name, e.status ?? '', e.code ?? '', e.status === undefined ? e.message : '');
      if (!res.headersSent) send(res, 500, { error: 'server_error' });
    }
  });

  syncIfStale();
  return server;
}
