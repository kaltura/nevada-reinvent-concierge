/**
 * AWS Events API client. Contract: AWS-EVENTS-INTEGRATION.md.
 * Only this proxy calls AWS; the Kaltura agent never does.
 *
 * Request and response shapes are confirmed against the live
 * https://api.awsevents.com/v1/openapi.json, not just the integration doc.
 */
const BASE = 'https://api.awsevents.com/v1';
const EVENT_ID = 'reinvent2026';
const TOKEN_URL = 'https://oauth.awsevents.com/oauth2/token';
const REVOKE_URL = 'https://oauth.awsevents.com/oauth2/revoke';
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

// Two tool calls for the same visitor can both hit a 401 close together. If
// each called refreshAccessToken separately and AWS rotates the refresh
// token, the second call's refresh can fail after the first already stored a
// good token, wrongly deleting it. Dedupe so concurrent callers share one
// in-flight refresh and both get its result.
const refreshInFlight = new Map(); // visitor → Promise

function dedupedRefresh(visitor, refreshToken) {
  let p = refreshInFlight.get(visitor);
  if (!p) {
    p = refreshAccessToken(refreshToken).finally(() => refreshInFlight.delete(visitor));
    refreshInFlight.set(visitor, p);
  }
  return p;
}

/**
 * Run `fn(accessToken)` for `visitor`'s stored tokens. Refreshes once on a
 * 401 and retries; deletes the record and reports "must pair again" if the
 * refresh itself fails or the retry still 401s. AWS-EVENTS-INTEGRATION.md
 * § Authentication: "refresh on demand ... a failed refresh means the
 * attendee must pair again."
 * @returns {Promise<{paired:false,expired?:boolean}|{paired:true,result:*}>}
 */
export async function withToken(tokenStore, visitor, fn) {
  const tokens = tokenStore.get(visitor);
  if (!tokens) return { paired: false };
  tokenStore.touch(visitor);
  try {
    return { paired: true, result: await fn(tokens.access_token) };
  } catch (e) {
    if (!(e instanceof AwsError) || e.status !== 401) throw e;
    const fresh = await dedupedRefresh(visitor, tokens.refresh_token).catch((e) => {
      console.error(`refresh failed for visitor ${visitor.slice(0, 8)}:`, e.message);
      return null;
    });
    if (!fresh) { tokenStore.delete(visitor); return { paired: false, expired: true }; }
    // AWS can omit refresh_token when it doesn't rotate it; keep the old one
    // instead of overwriting it with undefined and breaking the next refresh.
    // Carry the pairingId forward too, or a refreshed record would fall out
    // of its pairing's Disconnect group.
    tokenStore.set(visitor, { ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token, pairingId: tokens.pairingId });
    try {
      return { paired: true, result: await fn(fresh.access_token) };
    } catch (e2) {
      if (e2 instanceof AwsError && e2.status === 401) { tokenStore.delete(visitor); return { paired: false, expired: true }; }
      throw e2;
    }
  }
}
