/**
 * Live eval runner. Drives the real agent through server/evals/cases.mjs, over a
 * real KalturaChatSession, using the same tool-dispatch contract as
 * client/app.js, minus the DOM. It starts the app in-process twice: one signed
 * in with the tokens in NEVADA_HOME (required, so evals never touch your real
 * ~/.nevada account; run `NEVADA_HOME=<folder> npm start` once and sign in with
 * a dedicated, empty test account), and one signed out for the signed-out cases.
 * Design: ARCHITECTURE.md § Evals.
 *
 * Usage: NEVADA_HOME=<absolute folder> npm run eval [-- --grep "name substring"]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { KalturaChatSession } from '@kaltura/intelligent-agents/experience';
import { createApp } from '../app.mjs';
import { makeKaltura } from '../kaltura.mjs';
import { resolveWidgetId } from '../widget-id.mjs';
import { judge } from './judge.mjs';
import { CASES } from './cases.mjs';
import { minutesOf } from '../dates.mjs';

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

const evalHome = process.env.NEVADA_HOME;
if (!evalHome) {
  console.error('Set NEVADA_HOME to a folder for the test account.\nEvals never use your real ~/.nevada.');
  process.exit(2);
}
if (!isAbsolute(evalHome)) {
  console.error(`NEVADA_HOME must be an absolute path. You set "${evalHome}".`);
  process.exit(2);
}

const widgetId = resolveWidgetId();
if (!widgetId) {
  console.error('No widget id. Set NEVADA_WIDGET_ID or run `npm run provision`.');
  process.exit(2);
}
const kaltura = makeKaltura(widgetId);

async function listen(home) {
  const server = createApp({ home, widgetId });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();
  return `http://127.0.0.1:${server.address().port}`;
}
const SIGNED_IN_URL = await listen(evalHome);
const SIGNED_OUT_URL = await listen(mkdtempSync(join(tmpdir(), 'nevada-eval-')));

const grep = process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : null;

async function apiFetch(path, body, base) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

async function scheduleSnapshot(base) {
  const data = await apiFetch('/api/schedule', {}, base);
  if (!data.signedIn) return null;
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
async function cleanup(base, before, after) {
  if (!before || !after) return;
  for (const id of after.reservedIds) if (!before.reservedIds.has(id)) await apiFetch('/tools/cancel_reservation', { id }, base);
  for (const id of after.favoriteIds) if (!before.favoriteIds.has(id)) await apiFetch('/tools/unfavorite_session', { id }, base);
  for (const id of after.personal.keys()) if (!before.personal.has(id)) await apiFetch('/tools/delete_personal_time', { id }, base);

  const missingReserved = [...before.reservedIds].filter((id) => !after.reservedIds.has(id));
  if (missingReserved.length) await apiFetch('/tools/reserve_sessions', { ids: missingReserved }, base);
  const missingFavorites = [...before.favoriteIds].filter((id) => !after.favoriteIds.has(id));
  if (missingFavorites.length) await apiFetch('/tools/favorite_sessions', { ids: missingFavorites }, base);
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
    }, base);
  }
}

const SERVER_TOOLS = [
  'get_topics', 'search_sessions', 'get_session', 'get_my_schedule', 'favorite_sessions',
  'unfavorite_session', 'reserve_sessions', 'cancel_reservation', 'swap_reservation',
  'add_personal_time', 'update_personal_time', 'delete_personal_time',
];
const CLIENT_TOOLS = ['show_sessions', 'render_schedule', 'highlight_conflict', 'celebrate_action', 'show_recap', 'point_at'];

function wireTools(session, base, turnCalls) {
  const screen = { view: 'home', day: null, visible: [], focused: null };
  for (const name of SERVER_TOOLS) {
    session.onToolCall(name, async (args, call) => {
      const result = await apiFetch(`/tools/${name}`, args, base)
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

// All signedIn cases share one real AWS test account. Running their
// snapshot→turns→cleanup sequences concurrently would let one case's writes
// land inside another's before/after diff, cleaning up the wrong session.
// Serialize them; only the single signed-out (no AWS access) case runs outside
// this lock, so mapLimit's concurrency only shortens judge-call wait time.
let signedInLock = Promise.resolve();
function withSignedInLock(fn) {
  const run = signedInLock.then(fn, fn);
  signedInLock = run.then(() => {}, () => {});
  return run;
}

function runCase(kase) {
  return kase.signedIn === false ? runCaseBody(kase) : withSignedInLock(() => runCaseBody(kase));
}

async function runCaseBody(kase) {
  let base;
  try {
    base = kase.signedIn === false ? SIGNED_OUT_URL : await getSignedInUrl();
  } catch (e) {
    // A rejected signedInUrlPromise (see getSignedInUrl) stays rejected for
    // every later case that awaits it. Report per case, and don't let one
    // throw crash the whole concurrent run.
    return { name: kase.name, failures: [`crashed: ${e.message}`] };
  }
  const before = kase.signedIn === false ? null : await scheduleSnapshot(base);

  const { ks } = await kaltura.appInit();
  const transcript = { turns: [] };
  const turnCalls = []; // mutated in place: wireTools's handlers close over this exact array
  const session = new KalturaChatSession({ token: ks, requestVars: { returning: '', page_context: '', paired: '1', topInterest: '' } });
  wireTools(session, base, turnCalls);
  await session.connect();

  const failures = [];
  try {
    for (const turn of kase.turns) {
      const text = typeof turn === 'function' ? turn(transcript) : turn;
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
    if (kase.signedIn !== false) {
      const after = await scheduleSnapshot(base).catch(() => null);
      await cleanup(base, before, after).catch((e) => console.error(`cleanup failed for "${kase.name}":`, e.message));
    }
  }
  return { name: kase.name, failures };
}

// Write cases run for real against whatever account NEVADA_HOME is signed in to. Refuse
// to touch an account that already has real state. Evals must run against a
// dedicated, empty throwaway AWS test account, never someone's real week.
async function assertEmptyAccount(base) {
  const snap = await scheduleSnapshot(base);
  if (!snap) throw new Error('not signed in. Run `npm start`, sign in with the dedicated test account, then rerun');
  const dirty = snap.reservedIds.size || snap.favoriteIds.size || snap.personal.size;
  if (dirty) {
    throw new Error('signedIn account already has reservations, favorites or personal time and evals need an empty, dedicated test account');
  }
}

let signedInUrlPromise = null;
function getSignedInUrl() {
  signedInUrlPromise ??= assertEmptyAccount(SIGNED_IN_URL).then(() => SIGNED_IN_URL);
  return signedInUrlPromise;
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
console.log(`Running ${cases.length} eval case(s)...\n`);

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
