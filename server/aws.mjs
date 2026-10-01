/**
 * AWS Events API client. Contract: AWS-EVENTS-INTEGRATION.md.
 * Only this proxy calls AWS; the Kaltura agent never does.
 *
 * Request and response shapes are confirmed against the live
 * https://api.awsevents.com/v1/openapi.json, not just the integration doc.
 */
import { randomBytes, createHash } from 'node:crypto';

const BASE = 'https://api.awsevents.com/v1';
const EVENT_ID = 'reinvent2026';
const TOKEN_URL = 'https://oauth.awsevents.com/oauth2/token';
const REVOKE_URL = 'https://oauth.awsevents.com/oauth2/revoke';
const AUTHORIZE_URL = 'https://oauth.awsevents.com/oauth2/authorize';
const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';

export class AwsError extends Error {
  constructor(status, code, body) {
    super(`AWS ${status}${code ? ` ${code}` : ''}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken }),
  });
  if (!res.ok) throw new AwsError(res.status, 'refresh_failed', await res.text().catch(() => ''));
  return res.json(); // { access_token, refresh_token?, expires_in }
}

/** The AWS Builder ID sign-in URL (authorization code + PKCE) and the secrets needed to finish it. */
export function signInRequest(redirectUri) {
  const verifier = randomBytes(64).toString('base64url');
  const state = randomBytes(24).toString('base64url');
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid email events/access',
    identity_provider: 'AWSBuilderID',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state,
  }).toString();
  return { url: url.toString(), state, verifier };
}

/** Trade the sign-in code for tokens. `redirectUri` must match the one in the authorize URL exactly. */
export async function exchangeCode({ code, verifier, redirectUri }) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: redirectUri, code, code_verifier: verifier }),
  });
  if (!res.ok) throw new AwsError(res.status, 'code_exchange_failed');
  return res.json(); // { access_token, refresh_token, expires_in }
}

/** @returns {Promise<boolean>} whether AWS confirmed the revoke. */
export async function revokeRefreshToken(refreshToken) {
  try {
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, token: refreshToken }),
    });
    if (!res.ok) console.error(`revoke failed: AWS ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error('revoke failed:', e.message);
    return false;
  }
}

async function call(accessToken, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new AwsError(res.status, data && typeof data === 'object' ? data.code : undefined, data);
  return data;
}

const path = (p) => `/events/${EVENT_ID}${p}`;

// GetSchedule wraps its body as {schedule}, ReserveSessions/AssociateFavorites
// as {result}. Unwrap here so callers get the inner shape directly, confirmed
// against the live openapi.json.
export const getSchedule = async (token) => (await call(token, 'GET', path('/schedule'))).schedule;
export const reserveSessions = async (token, ids) => (await call(token, 'POST', path('/reservations'), { sessionIds: ids })).result;
export const cancelReservation = (token, id) => call(token, 'DELETE', path(`/reservations/${encodeURIComponent(id)}`));
export const associateFavorites = async (token, ids) => (await call(token, 'POST', path('/favorites'), { sessionIds: ids })).result;
export const disassociateFavorite = (token, id) => call(token, 'DELETE', path(`/favorites/${encodeURIComponent(id)}`));
export const createPersonalTime = (token, body) => call(token, 'POST', path('/personal-time'), body);
export const updatePersonalTime = (token, id, body) => call(token, 'PUT', path(`/personal-time/${encodeURIComponent(id)}`), body);
export const deletePersonalTime = (token, id) => call(token, 'DELETE', path(`/personal-time/${encodeURIComponent(id)}`));

export function listSessions(token, { locale, includeAbstracts, nextToken } = {}) {
  const qs = new URLSearchParams();
  if (locale) qs.set('locale', locale);
  if (includeAbstracts !== undefined) qs.set('includeAbstracts', String(includeAbstracts));
  if (nextToken) qs.set('nextToken', nextToken);
  const q = qs.toString();
  return call(token, 'GET', path(`/sessions${q ? `?${q}` : ''}`));
}
export const getSession = (token, sessionId) => call(token, 'GET', path(`/sessions/${encodeURIComponent(sessionId)}`));

// Two calls can hit a 401 close together. If each refreshed separately and
// AWS rotates the refresh token, the second refresh could fail after the first
// already stored a good token, wrongly signing the attendee out. Share one
// in-flight refresh instead.
let refreshInFlight = null;

function dedupedRefresh(refreshToken) {
  refreshInFlight ??= refreshAccessToken(refreshToken).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/**
 * Run `fn(accessToken)` with the stored tokens. Refreshes once on a 401 and
 * retries. If AWS rejects the refresh token (or the retry still 401s), clears
 * the tokens and reports "sign in again". A network error or AWS outage does
 * not sign anyone out: it is rethrown. AWS-EVENTS-INTEGRATION.md § Authentication.
 * @returns {Promise<{paired:false,expired?:boolean}|{paired:true,result:*}>}
 */
export async function withToken(tokenStore, fn) {
  const tokens = tokenStore.get();
  if (!tokens) return { paired: false };
  try {
    return { paired: true, result: await fn(tokens.access_token) };
  } catch (e) {
    if (!(e instanceof AwsError) || e.status !== 401) throw e;
    let fresh;
    try {
      fresh = await dedupedRefresh(tokens.refresh_token);
    } catch (refreshError) {
      if (!(refreshError instanceof AwsError) || ![400, 401].includes(refreshError.status)) throw refreshError;
      if (tokenStore.get() === tokens) tokenStore.clear();
      return { paired: false, expired: true };
    }
    // Signed out while the refresh ran: don't bring the tokens back. A sibling
    // call may already have stored the refreshed record, so only replace ours.
    const current = tokenStore.get();
    if (!current) return { paired: false };
    // AWS can omit refresh_token when it doesn't rotate it; keep the old one.
    if (current === tokens) tokenStore.set({ ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token });
    try {
      return { paired: true, result: await fn(fresh.access_token) };
    } catch (e2) {
      if (e2 instanceof AwsError && e2.status === 401) {
        if (tokenStore.get()?.access_token === fresh.access_token) tokenStore.clear();
        return { paired: false, expired: true };
      }
      throw e2;
    }
  }
}
