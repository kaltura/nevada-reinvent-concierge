/**
 * Catalog sync and search index. Search option B (our own index): lexical
 * scoring plus structured filters, no external embedding provider configured.
 * ARCHITECTURE.md § Search, AWS-EVENTS-INTEGRATION.md § Session shape,
 * § Pagination, § Catalog sync.
 */
import { listSessions } from './aws.mjs';
import { dayToDate, minutesOf } from './dates.mjs';

// Free-text venue → our six known venues. AWS-EVENTS-INTEGRATION.md § Event facts.
const VENUES = [
  ['MGM', /mgm/i],
  ['WYN', /wynn/i],
  ['VEN', /venetian/i],
  ['ENC', /encore/i],
  ['CPL', /caesars palace/i],
  ['CFM', /caesars forum/i],
];
export function mapVenue(freeText) {
  if (!freeText) return null;
  const found = VENUES.find(([, re]) => re.test(freeText));
  return found ? found[0] : freeText;
}

// Static venue-to-venue minutes. Provisional until AWS publishes 2026
// transport details (2025 guidance: 30 to 45 minutes). ARCHITECTURE.md § Search.
const CODES = ['MGM', 'WYN', 'VEN', 'ENC', 'CPL', 'CFM'];
export const TRAVEL_MINUTES = Object.fromEntries(CODES.map((a) => [a, Object.fromEntries(
  CODES.map((b) => [b, a === b ? 0 : (a === 'VEN' && b === 'ENC') || (a === 'ENC' && b === 'VEN') || (a === 'CPL' && b === 'CFM') || (a === 'CFM' && b === 'CPL') ? 15 : 35]),
)]));
export function travelMinutes(a, b) {
  if (!a || !b || a === b) return 0;
  return TRAVEL_MINUTES[a]?.[b] ?? 35;
}

function normalizedTitle(title) {
  return String(title || '').replace(/\[repeat\]/i, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
}
function repeatKey(session) {
  const code = (session.abbreviation || '').replace(/-r\d*$/i, '');
  const speakers = (session.speakers || []).map((s) => s.name).sort().join(',');
  return code || `${normalizedTitle(session.title)}|${speakers}`;
}

// Free-text arrays from the session shape (AWS-EVENTS-INTEGRATION.md § Session
// shape). All folded into search instead of separate structured filters: AWS
// gives no enums for any of these, so a real filter list would need building
// from the synced catalog anyway, and query text already reaches them this way.
const FREE_TEXT_ARRAYS = [
  'tracks', 'topics', 'areasOfInterest', 'roles', 'services', 'industries',
  'segments', 'features', 'customerPersonas', 'experiences', 'additionalActivities', 'focusAreas',
];
function tokenize(session) {
  const bag = [
    session.title, session.abbreviation, session.type, session.level, session.venue, session.room,
    ...FREE_TEXT_ARRAYS.flatMap((k) => session[k] || []),
    ...(session.abstract ? [session.abstract] : []),
  ].filter(Boolean).join(' ').toLowerCase();
  return new Set(bag.match(/[a-z0-9]+/g) || []);
}

export function makeCatalog() {
  const sessions = new Map(); // sessionId -> normalized session
  const repeatGroups = new Map(); // repeatKey -> Set<sessionId>
  let totalCount = 0;
  let lastSync = null;

  function normalize(raw) {
    const venue = mapVenue(raw.venue);
    const session = { ...raw, venue, tokens: undefined };
    session.tokens = tokenize({ ...raw, venue });
    return session;
  }

  function upsert(raw) {
    const session = normalize(raw);
    sessions.set(session.sessionId, session);
    const key = repeatKey(session);
    if (!repeatGroups.has(key)) repeatGroups.set(key, new Set());
    repeatGroups.get(key).add(session.sessionId);
    session.repeatKey = key;
  }

  /** Replace the snapshot with exactly this set of raw sessions. Used by sync() per page, and directly in tests. */
  function seed(rawSessions) {
    const seen = new Set();
    for (const raw of rawSessions) { upsert(raw); seen.add(raw.sessionId); }
    for (const id of [...sessions.keys()]) if (!seen.has(id)) sessions.delete(id);
    for (const [, ids] of repeatGroups) for (const id of [...ids]) if (!sessions.has(id)) ids.delete(id);
  }

  /** Full walk of ListSessions, replacing the snapshot. AWS-EVENTS-INTEGRATION.md § Pagination. */
  async function sync(accessToken) {
    const all = [];
    let nextToken;
    do {
      const page = await listSessions(accessToken, { includeAbstracts: true, nextToken });
      all.push(...(page.items ?? []));
      totalCount = page.totalCount ?? totalCount;
      nextToken = page.nextToken;
    } while (nextToken);
    seed(all);
    lastSync = Date.now();
    return { count: sessions.size, totalCount };
  }

  function topicCounts(sessionList) {
    const counts = new Map();
    for (const s of sessionList) for (const t of s.topics || []) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
  }

  // No enums for topics (AWS-EVENTS-INTEGRATION.md § Session shape), so the
  // suggestion chips pick the real most-common ones instead of a guess.
  function topTracks(limit = 6) {
    return [...topicCounts(sessions.values()).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
  }

  /** The single most common topic across these session ids, or null. Used to
   * greet a returning attendee by what they've actually shown interest in. */
  function topTopic(ids) {
    const ranked = [...topicCounts(getMany(ids)).entries()].sort((a, b) => b[1] - a[1]);
    return ranked[0]?.[0] ?? null;
  }

  // Cold-start fallback for an attendee with nothing reserved or favorited
  // yet to infer interest from: scarce seats look like the sessions everyone
  // else is picking. AWS-EVENTS-INTEGRATION.md § Session shape for the enum.
  const SCARCITY = { veryLimited: 3, limited: 2, walkUp: 1, available: 0 };

  /** Top `limit` sessions on `day`, ranked by topic overlap with `interestTopics`
   * (falling back to seat scarcity when there's no overlap), excluding
   * `excludeIds` and anything with no seats left. */
  function recommend(day, interestTopics, excludeIds, limit = 3) {
    const date = dayToDate(day);
    if (!date) return [];
    const exclude = new Set(excludeIds);
    const want = new Set((interestTopics || []).map((t) => t.toLowerCase()));
    const pool = [...sessions.values()].filter((s) => (
      s.sessionTime?.date === date && !exclude.has(s.sessionId) && s.seatAvailability !== 'unavailable'
    ));
    const scored = pool.map((s) => {
      const overlap = (s.topics || []).filter((t) => want.has(t.toLowerCase())).length;
      return { s, score: overlap * 10 + (SCARCITY[s.seatAvailability] ?? 0) };
    });
    return scored
      .sort((a, b) => b.score - a.score || minutesOf(a.s.sessionTime.time) - minutesOf(b.s.sessionTime.time))
      .slice(0, limit)
      .map((x) => x.s);
  }

  function get(sessionId) { return sessions.get(sessionId) ?? null; }
  function getMany(ids) { return (ids || []).map(get).filter(Boolean); }
  function getRepeats(sessionId) {
    const s = get(sessionId);
    if (!s) return [];
    return [...(repeatGroups.get(s.repeatKey) ?? [sessionId])];
  }

  function matchesDay(session, day) {
    if (!day) return true;
    return session.sessionTime?.date === dayToDate(day);
  }

  function search({ query, day, from, to, venue, level, mode } = {}) {
    const wantVenue = venue ? mapVenue(venue) || venue.toUpperCase() : null;
    const fromMin = from ? minutesOf(from) : null;
    const toMin = to ? minutesOf(to) : null;
    const qTokens = query ? new Set(String(query).toLowerCase().match(/[a-z0-9]+/g) || []) : null;

    const pool = [...sessions.values()].filter((s) => {
      if (day && !matchesDay(s, day)) return false;
      if (wantVenue && s.venue !== wantVenue) return false;
      if (level && String(s.level) !== String(level)) return false;
      if (s.sessionTime && (fromMin !== null || toMin !== null)) {
        const start = minutesOf(s.sessionTime.time);
        if (fromMin !== null && start < fromMin) return false;
        if (toMin !== null && start > toMin) return false;
      }
      return true;
    });

    const chronological = () => [...pool].sort((a, b) => minutesOf(a.sessionTime?.time ?? '00:00') - minutesOf(b.sessionTime?.time ?? '00:00')).slice(0, 5);

    // With no query (e.g. "what's on Tuesday"), order chronologically instead
    // of catalog insertion order, which is meaningless for a schedule tool.
    if (!qTokens || qTokens.size === 0) return chronological();

    const scored = pool.map((s) => {
      let overlap = 0;
      for (const t of qTokens) if (s.tokens.has(t)) overlap += 1;
      return { s, score: overlap };
    });

    if (mode === 'wildcard') {
      return scored.filter((x) => x.score === 0).sort(() => Math.random() - 0.5).slice(0, 5).map((x) => x.s);
    }
    const matched = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.s);
    // A query word with no real content match (e.g. a time phrase like
    // "morning" leaking into query instead of from/to) shouldn't wipe out
    // results that day/time/venue/level already narrowed down to.
    if (matched.length || !(day || from || to || venue || level)) return matched;
    return chronological();
  }

  return {
    sync, seed, upsert, get, getMany, getRepeats, search, topTracks, topTopic, recommend,
    size: () => sessions.size,
    totalCount: () => totalCount,
    lastSync: () => lastSync,
  };
}
