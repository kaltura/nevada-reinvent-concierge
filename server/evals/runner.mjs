/**
 * Live eval runner. Drives the real shared intellect (server/agent.json's
 * configId) through server/evals/cases.mjs, over a real KalturaChatSession,
 * using the same tool-dispatch contract as client/app.js, minus the DOM. Design:
 * ARCHITECTURE.md § Evals.
 *
 * Usage: npm run eval [-- --grep "name substring"]
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Management } from '@kaltura/intelligent-agents/management';
import { KalturaChatSession } from '@kaltura/intelligent-agents/experience';
import { pairedCookie, unpairedCookie } from './session.mjs';
import { judge } from './judge.mjs';
import { CASES } from './cases.mjs';
import { minutesOf } from '../dates.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URL = `http://localhost:${process.env.PORT || 8080}`;
const CONCURRENCY = 4;
const TURN_TIMEOUT_MS = 45_000;

/** A hung upstream call (AWS, the intellect) must not wedge the whole serialized run forever. */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const { configId } = JSON.parse(readFileSync(join(ROOT, 'server', 'agent.json'), 'utf8'));
const { KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET } = process.env;
if (!KALTURA_PARTNER_ID || !KALTURA_ADMIN_SECRET) {
  console.error('Set KALTURA_PARTNER_ID and KALTURA_ADMIN_SECRET in .env');
  process.exit(2);
}
const kaltura = new Management({ partnerId: Number(KALTURA_PARTNER_ID), adminSecret: KALTURA_ADMIN_SECRET });

const grep = process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : null;

async function apiFetch(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// "8:30am" / "2pm" -> "08:30" / "14:00". The only time format /api/schedule's
// blocks carry (schedule.mjs's formatClock); still exact, just not 24h HH:MM.
function parseClock(clock) {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/i.exec(clock);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function scheduleSnapshot(cookie) {
  const data = await apiFetch('/api/schedule', {}, cookie);
  if (!data.paired) return null;
  const reservedIds = new Set();
  const favoriteIds = new Set();
  const personal = new Map(); // id -> {day, clock, length, title}, needed to recreate one a case wrongly deletes
  for (const w of data.week) {
    for (const b of w.blocks) {
      if (b.kind === 'reserved') reservedIds.add(b.sessionId);
      if (b.kind === 'personal') personal.set(b.id, { day: w.day, clock: b.clock, length: b.length, title: b.title });
    }
  }
  for (const s of data.unscheduledFavorites) favoriteIds.add(s.sessionId);
  for (const w of data.week) for (const b of w.blocks) if (b.kind === 'favorite') favoriteIds.add(b.sessionId);
  return { reservedIds, favoriteIds, personal };
}

// A case can misresolve a vague reference ("that favorite") onto something
// that predates the run, not what the case itself just created. Confirmed
// live: a real account's pre-existing favorites vanished this way. Cleanup
// must be symmetric: undo new writes AND restore anything the case's turns
// caused to go missing, not just diff away what's new.
async function cleanup(cookie, before, after) {
  if (!before || !after) return;
  for (const id of after.reservedIds) if (!before.reservedIds.has(id)) await apiFetch('/tools/cancel_reservation', { id }, cookie);
  for (const id of after.favoriteIds) if (!before.favoriteIds.has(id)) await apiFetch('/tools/unfavorite_session', { id }, cookie);
  for (const id of after.personal.keys()) if (!before.personal.has(id)) await apiFetch('/tools/delete_personal_time', { id }, cookie);

  const missingReserved = [...before.reservedIds].filter((id) => !after.reservedIds.has(id));
  if (missingReserved.length) await apiFetch('/tools/reserve_sessions', { ids: missingReserved }, cookie);
  const missingFavorites = [...before.favoriteIds].filter((id) => !after.favoriteIds.has(id));
  if (missingFavorites.length) await apiFetch('/tools/favorite_sessions', { ids: missingFavorites }, cookie);
  for (const [id, block] of before.personal) {
    if (after.personal.has(id)) continue;
    const start = parseClock(block.clock);
    if (!start) continue; // unparseable clock string: nothing safe to recreate from
    await apiFetch('/tools/add_personal_time', {
      // /api/schedule never exposes the original description, so this is a
      // best-effort recreation, not exact. That matters far less than getting the
      // block back on the calendar at all.
      title: block.title, description: block.title, day: block.day,
      start, end: minutesToHHMM(minutesOf(start) + block.length),
    }, cookie);
  }
}

const SERVER_TOOLS = [
  'get_topics', 'search_sessions', 'get_session', 'get_my_schedule', 'favorite_sessions',
  'unfavorite_session', 'reserve_sessions', 'cancel_reservation', 'swap_reservation',
  'add_personal_time', 'update_personal_time', 'delete_personal_time',
];
const CLIENT_TOOLS = ['show_sessions', 'render_schedule', 'highlight_conflict', 'celebrate_action', 'show_recap', 'point_at'];

function wireTools(session, cookie, turnCalls) {
  const screen = { view: 'home', day: null, visible: [], focused: null };
  for (const name of SERVER_TOOLS) {
    session.onToolCall(name, async (args, call) => {
      const result = await apiFetch(`/tools/${name}`, args, cookie)
        .catch(() => ({ answer: "That didn't work and I don't know why. Try again in a moment." }));
      turnCalls.push({ name, args, result });
      if (call.toolMetadata?.waitForResponse) session.respondToTool(call.toolMetadata.id, result).catch(() => {});
    });
  }
  for (const name of CLIENT_TOOLS) {
    session.onToolCall(name, (args) => {
      turnCalls.push({ name, args, result: null });
      if (name === 'show_sessions') Object.assign(screen, { view: 'day', visible: args.sessionIds, focused: null });
      if (name === 'point_at') screen.focused = args.sessionId;
      try { if (session.state === 'connected') session.setDynamicPrompt(screen); } catch { /* not yet connected */ }
    });
  }
}

// All paired cases share one real AWS test account. Running their
// snapshot→turns→cleanup sequences concurrently would let one case's writes
// land inside another's before/after diff, cleaning up the wrong session.
// Serialize them; only the single unpaired (no AWS access) case runs outside
// this lock, so mapLimit's concurrency only shortens judge-call wait time.
let pairedLock = Promise.resolve();
function withPairedLock(fn) {
  const run = pairedLock.then(fn, fn);
  pairedLock = run.then(() => {}, () => {});
  return run;
}

function runCase(kase) {
  return kase.paired === false ? runCaseBody(kase) : withPairedLock(() => runCaseBody(kase));
}

async function runCaseBody(kase) {
  let cookie;
  try {
    cookie = kase.paired === false ? await unpairedCookie(BASE_URL) : await getPairedCookie();
  } catch (e) {
    // A rejected pairedCookiePromise (see getPairedCookie) stays rejected for
    // every later case that awaits it. Report per case, and don't let one
    // throw crash the whole concurrent run.
    return { name: kase.name, failures: [`crashed: ${e.message}`] };
  }
  const before = kase.paired === false ? null : await scheduleSnapshot(cookie);

  const conv = await kaltura.sessions.createConversationToken({ configId });
  const transcript = { turns: [] };
  const turnCalls = []; // mutated in place: wireTools's handlers close over this exact array
  const session = new KalturaChatSession({ token: conv, requestVars: { returning: '', page_context: '', paired: '1', topInterest: '' } });
  wireTools(session, cookie, turnCalls);
  await session.connect();

  const failures = [];
  try {
    for (const text of kase.turns) {
      turnCalls.length = 0;
      const reply = await withTimeout(session.sendText(text), TURN_TIMEOUT_MS, `turn "${text.slice(0, 40)}"`);
      transcript.turns.push({ text: reply.text, toolCalls: [...turnCalls] });
    }

    for (const exp of kase.expect ?? []) {
      const { pass, detail } = exp.check(transcript);
      if (!pass) failures.push(`rule: ${exp.description}: ${detail}`);
    }
    for (const { turn, rubric } of kase.judge ?? []) {
      const text = transcript.turns.map((t, i) => `Turn ${i}: ${t.text}`).join('\n');
      const { pass, reason } = await judge(rubric, turn === undefined ? text : `Turn ${turn}: ${transcript.turns[turn]?.text ?? ''}`);
      if (!pass) failures.push(`judge: ${rubric}: ${reason}`);
    }
  } catch (e) {
    failures.push(`crashed: ${e.message}`);
  } finally {
    try { session.disconnect(); } catch { /* already closed */ }
    if (kase.paired !== false) {
      const after = await scheduleSnapshot(cookie).catch(() => null);
      await cleanup(cookie, before, after).catch((e) => console.error(`cleanup failed for "${kase.name}":`, e.message));
    }
  }
  return { name: kase.name, failures };
}

// Write cases run for real against whatever account this cookie pairs. Refuse
// to touch an account that already has real state. Evals must run against a
// dedicated, empty throwaway AWS test account, never someone's real week.
async function assertEmptyAccount(cookie) {
  const snap = await scheduleSnapshot(cookie);
  if (!snap) throw new Error('could not read the paired account schedule, refusing to run write evals');
  const dirty = snap.reservedIds.size || snap.favoriteIds.size || snap.personal.size;
  if (dirty) {
    throw new Error('paired account already has reservations, favorites or personal time and evals need an empty, dedicated test account');
  }
}

let pairedCookiePromise = null;
function getPairedCookie() {
  pairedCookiePromise ??= pairedCookie(BASE_URL).then(async (cookie) => {
    await assertEmptyAccount(cookie);
    return cookie;
  });
  return pairedCookiePromise;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next; next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const cases = grep ? CASES.filter((c) => c.name.includes(grep)) : CASES;
console.log(`Running ${cases.length} eval case(s) against intellect ${configId} at ${BASE_URL}...\n`);

let failed = 0;
const results = await mapLimit(cases, CONCURRENCY, async (kase) => {
  const r = await runCase(kase);
  if (r.failures.length) {
    failed += 1;
    console.log(`✗ ${r.name}`);
    for (const f of r.failures) console.log(`    ${f}`);
  } else {
    console.log(`✓ ${r.name}`);
  }
  return r;
});

console.log(`\n${results.length - failed}/${results.length} passed.`);
// Not process.exit(): stdout to a pipe/file is async, and exit() can cut off
// buffered writes before they flush. Confirmed live: a 55-case run reached
// this point with failed=0 but the redirected log held none of the ✓/✗ lines.
process.exitCode = failed ? 1 : 0;
