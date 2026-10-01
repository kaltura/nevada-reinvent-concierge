// Shared by the server tests: a fake AWS and Kaltura on globalThis.fetch and a real app on a free port.
import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.mjs';

export const AWS_SESSIONS = [{
  sessionId: 'AAA111', title: 'Deep dive on Lambda', venue: 'MGM Grand', isReservable: true,
  seatAvailability: 'available', sessionTime: { date: '2026-12-01', time: '09:00', length: 60 },
  topics: ['serverless'],
}, {
  // No sessionTime: AWS hasn't scheduled it yet, e.g. a wildcard pick.
  sessionId: 'CCC333', title: 'Wildcard: Reality-TV panel',
}];

const API = 'https://api.awsevents.com/v1/events/reinvent2026';
const json = (body, status = 200) => ({ status, ok: status < 400, text: async () => JSON.stringify(body), json: async () => body });

/** State and call log of the fake AWS and Kaltura. Override `respond` to change what a URL returns. */
export function fakeWorld() {
  const world = {
    schedule: { reserved: [], favorites: [], personalTime: [] },
    calls: [],
    tokenRequests: [], // form fields of each /oauth2/token call
    revoked: [],
    sessionListDelayMs: 0,
    kalturaRejectFirstAppInit: false,
    tokenGrants: { authorization_code: { access_token: 'tok1', refresh_token: 'r1', expires_in: 3600 } },
    respond: null,
  };

  async function handle(u, opts) {
    if (world.respond) { const r = await world.respond(u, opts); if (r) return r; }
    if (u === 'https://oauth.awsevents.com/oauth2/token') {
      const form = Object.fromEntries(new URLSearchParams(opts.body));
      world.tokenRequests.push(form);
      const grant = world.tokenGrants[form.grant_type];
      return grant ? json(grant) : json({ error: 'invalid_grant' }, 400);
    }
    if (u === 'https://oauth.awsevents.com/oauth2/revoke') {
      world.revoked.push(new URLSearchParams(opts.body).get('token'));
      return json({});
    }
    if (u === 'https://www.kaltura.com/api_v3/service/session/action/startWidgetSession') return json({ ks: 'widgetKs' });
    if (u === 'https://api.avatar.us.kaltura.ai/v1/application/appInit') {
      if (world.kalturaRejectFirstAppInit) { world.kalturaRejectFirstAppInit = false; return json({}, 401); }
      return json({ ks: 'djJ8init', conversationManagerUrl: 'wss://cm', srsBaseUrl: 'https://srs', turnServerUrl: 'turn:t', partnerId: 123 });
    }
    if (u === `${API}/sessions/EEE555`) return json({ sessionId: 'EEE555', title: 'Live-fetched session' });
    if (u.startsWith(`${API}/sessions`)) {
      await new Promise((resolve) => setTimeout(resolve, world.sessionListDelayMs));
      return json({ items: AWS_SESSIONS, totalCount: AWS_SESSIONS.length });
    }
    if (u === `${API}/schedule`) return json({ schedule: world.schedule });
    if (u === `${API}/reservations` && opts.method === 'POST') {
      const { sessionIds } = JSON.parse(opts.body);
      world.schedule = { ...world.schedule, reserved: [...world.schedule.reserved, ...sessionIds] };
      return json({ result: { successful: sessionIds, failed: [] } });
    }
    if (u.startsWith(`${API}/reservations/`) && opts.method === 'DELETE') {
      const id = decodeURIComponent(u.split('/').pop());
      world.schedule = { ...world.schedule, reserved: world.schedule.reserved.filter((x) => x !== id) };
      return { status: 204, ok: true, text: async () => '' };
    }
    if (u === `${API}/favorites` && opts.method === 'POST') {
      const { sessionIds } = JSON.parse(opts.body);
      world.schedule = { ...world.schedule, favorites: [...world.schedule.favorites, ...sessionIds] };
      return json({ result: { successful: sessionIds, failed: [] } });
    }
    return undefined;
  }

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(u)) return realFetch(url, opts);
    world.calls.push({ url: u, method: opts.method || 'GET', headers: opts.headers, body: opts.body });
    const res = await handle(u, opts);
    if (!res) throw new Error(`unmocked call: ${opts.method || 'GET'} ${u}`);
    return res;
  };
  after(() => { globalThis.fetch = realFetch; });
  return world;
}

/** Starts a real app on a free port with an empty home folder. */
export async function startApp({ widgetId = 'W123', home } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nevada-app-'));
  const appHome = home ?? join(dir, 'home');
  const server = createApp({ home: appHome, widgetId });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // Node 20.6 runs root after() hooks only once the loop is idle, so a ref'd
  // server would keep the run open forever and after() would never close it.
  server.unref();
  after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    server, base, home: appHome,
    get: (path, opts = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...opts }),
    postJson: (path, body, headers = {}) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
    }),
    /** Runs the real sign-in: /auth/start, then the callback AWS would send the browser to. */
    async signIn(code = 'code1') {
      const start = await fetch(`${base}/auth/start`, { redirect: 'manual' });
      const state = new URL(start.headers.get('location')).searchParams.get('state');
      return fetch(`${base}/callback?code=${code}&state=${state}`, { redirect: 'manual' });
    },
  };
}
