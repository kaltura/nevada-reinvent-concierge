/**
 * Nevada web app shell. Runtime rules: ARCHITECTURE.md § Runtime.
 *
 * Built so far: widget token, one KalturaAgentSession in avatar mode with
 * Nevada live the whole visit and keyed out of her green backdrop, disclosure,
 * talk, type or tap turns, captions, quiet mode, screen context, pairing,
 * the quiet reconnect with `returning` after the background grace, and the
 * client tools that render cards, the schedule timeline, the conflict sheet
 * and the recap poster from our Web API.
 * Not built: the chat fallback (Phase 3).
 */
import { KalturaAgentSession, isSilentOpening, SILENT_OPENING_LABEL } from '@kaltura/intelligent-agents';
import { Management } from '@kaltura/intelligent-agents/management';
import { attachChromaKeyAvatar } from '@kaltura/intelligent-agents/experience/chroma-key';
import { createNoiseSuppressor } from '@kaltura/intelligent-agents/experience/noise-suppressor';
import { ChromaKeyVideo } from 'chroma-key-video';

const $ = (id) => document.getElementById(id);
const app = $('app');
const frame = $('avatar');
const mic = $('mic');
const captions = $('captions');

function toast(text) {
  const el = document.createElement('p');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').replaceChildren(el);
  setTimeout(() => el.remove(), 2500);
}

// A little spark of colour for a booking, favourite or swap. Pure CSS
// animation on freshly-appended, absolutely-positioned particles.
const CONFETTI_COLORS = ['var(--glow-blue)', 'var(--glow-violet)', 'var(--glow-lavender)', 'var(--glow-pink)', 'var(--primary)'];
function burst() {
  const el = document.createElement('div');
  el.className = 'burst';
  for (let i = 0; i < 14; i++) {
    const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 50;
    const dx = (Math.cos(angle) * dist).toFixed(0);
    const dy = (Math.sin(angle) * dist - 20).toFixed(0);
    el.append(h('i', {
      style: `--dx:${dx}px;--dy:${dy}px;--r:${Math.round(Math.random() * 360)}deg;--particle:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
    }));
  }
  document.body.append(el);
  setTimeout(() => el.remove(), 1000);
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}

// Page data for a client tool.
async function show(path, body) {
  try {
    return await api(path, body);
  } catch {
    toast("Couldn't load that");
    return null;
  }
}

// Session data comes from AWS, so build elements instead of innerHTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

function timelineBlockEl(b, opts = {}) {
  if (b.kind === 'gap') {
    return b.travel
      ? h('p', { class: 'travel-tag', 'data-tight': b.tight }, `${b.minutes} min to ${b.toVenue}${b.tight ? ' ⚠' : ''}`)
      : h('button', { class: 'gap-fill', 'data-turn': `Fill the ${b.minutes} minute gap before ${b.toVenue || 'my next session'}` }, '+ Fill this gap');
  }
  // Week grid: one truncated line per block instead of the day view's
  // separate time gutter and title/venue/meta rows — there's no room for those
  // across 5 columns. The day view also renders compact (one line, no meta
  // row) to stay condensed, but keeps its own time gutter column, so it skips
  // the clock here to avoid showing it twice.
  if (opts.compact) {
    // The row truncates or clips at narrow widths (5-up week columns, phones),
    // so the full title/time/venue always rides along as a native tooltip and
    // the title itself wraps to two lines instead of hiding past an ellipsis.
    const meta = [opts.inlineClock !== false ? b.clock : null, b.venue, b.level ? `L${b.level}` : null, b.seatAvailability].filter(Boolean).join(' · ');
    const full = [b.clock, b.title, b.venue, b.level ? `Level ${b.level}` : null, b.seatAvailability].filter(Boolean).join(' · ');
    const content = [h('span', { class: 'title' }, b.title), meta ? h('span', { class: 'meta-compact' }, meta) : null];
    return b.kind === 'personal'
      ? h('div', { class: 'block block-compact', 'data-state': 'personal', title: full }, ...content)
      : h('button', {
        class: 'block block-compact', 'data-session': b.sessionId, 'data-state': b.kind, 'data-clash': b.clash,
        'data-turn': `Tell me more about ${b.title} (session ${b.sessionId})`, title: full,
      }, ...content);
  }
  // Every call site (renderTimeline, renderWeek) always passes compact: true,
  // so a non-compact block is never actually rendered by the live app. The
  // full title/venue/meta layout this used to produce lives on only as
  // client/prototype.html's static markup, which doesn't call this function.
}

// A recommended session (sessionCard shape) rendered as a block alongside
// real reserved/favorite/personal ones.
function suggestedBlock(s) {
  return {
    kind: 'suggested', sessionId: s.sessionId, title: s.title, venue: s.venue, clock: s.clock,
    level: s.level, seatAvailability: s.seatAvailability,
  };
}

function renderTimeline({ day, blocks, clashDays, recommended }) {
  $('timeline').dataset.view = 'day';
  const rows = [];
  for (const b of blocks) {
    rows.push(b.kind === 'gap' ? h('span', {}) : h('time', {}, b.clock ?? ''));
    rows.push(timelineBlockEl(b, { compact: true, inlineClock: false }));
  }
  if (!rows.length) rows.push(h('span', {}), h('p', { class: 't-caption' }, "Your day is wide open. Tell Nevada what you're here for."));
  if (recommended?.length) {
    rows.push(h('span', {}), h('p', { class: 't-caption', style: 'margin:var(--s-2) 0 0' }, 'Suggested for you'));
    for (const s of recommended) {
      rows.push(h('time', {}, s.clock ?? ''));
      rows.push(timelineBlockEl(suggestedBlock(s), { compact: true, inlineClock: false }));
    }
  }
  $('timeline').replaceChildren(...rows);
  for (const btn of document.querySelectorAll('.day')) {
    const d = btn.dataset.day;
    if (d === day) btn.setAttribute('aria-current', 'date'); else btn.removeAttribute('aria-current');
    if (clashDays?.includes(d)) btn.dataset.clash = ''; else delete btn.dataset.clash;
  }
}

// Picks from what's on screen (DESIGN.md § Suggestion chips), not a fixed
// list: a clash or a gap on the day being viewed outranks a generic topic,
// since fixing those is more useful than a track name the attendee may
// already have picked. Falls back to real top tracks from the synced
// catalog, then "First time here" only while nothing's booked yet.
function renderChips(data) {
  const gap = data.blocks?.find((b) => b.kind === 'gap' && !b.travel && b.minutes >= 30);
  const suggestions = [
    data.clashDays?.includes(data.day) && { text: 'Fix my clash', turn: 'Help me fix the clash in my schedule.' },
    gap && { text: 'Fill that gap', turn: 'Suggest something to fill the gap in my schedule.' },
    data.unscheduledFavorites?.length && { text: 'Schedule my favorites', turn: 'Help me find times for my favorited sessions.' },
    data.topics?.[0] && { text: data.topics[0], turn: data.topics[0] },
    data.topics?.[1] && { text: data.topics[1], turn: data.topics[1] },
    (data.reserved?.length || data.favorites?.length) ? null : { text: 'First time here', turn: 'First time here' },
  ].filter(Boolean);
  for (const [i, btn] of $('chips').querySelectorAll('button').entries()) {
    const s = suggestions[i];
    if (!s) { btn.hidden = true; continue; }
    btn.hidden = false;
    btn.textContent = s.text;
    btn.dataset.turn = s.turn;
  }
}

// Desktop shows every day side by side instead of one day plus tabs (DESIGN.md § Layout).
function renderWeek({ week = [], clashDays, day }) {
  $('timeline').dataset.view = 'week';
  const cols = week.map(({ day: d, blocks, recommended }) => {
    const items = blocks.filter((b) => b.kind !== 'gap').map((b) => timelineBlockEl(b, { compact: true }));
    if (recommended?.length) {
      items.push(h('p', { class: 't-caption', style: 'margin:var(--s-1) 0 0' }, 'Suggested'));
      items.push(...recommended.map((s) => timelineBlockEl(suggestedBlock(s), { compact: true })));
    }
    if (!items.length) items.push(h('p', { class: 't-caption' }, 'Open'));
    return h('div', { class: 'week-day', 'data-day': d }, ...items);
  });
  $('timeline').replaceChildren(...cols);
  for (const btn of document.querySelectorAll('.day')) {
    const d = btn.dataset.day;
    if (d === day) btn.setAttribute('aria-current', 'date'); else btn.removeAttribute('aria-current');
    if (clashDays?.includes(d)) btn.dataset.clash = ''; else delete btn.dataset.clash;
  }
}

// Favorites AWS hasn't given a time yet — buildTimeline drops them from
// every day, so they'd otherwise never appear anywhere on screen (or in
// speech: see server/tools.mjs's scheduleSpeech). Rendered once, outside the
// day/week grid, not tied to which day is selected.
function renderUnscheduled(list = []) {
  const section = $('unscheduled');
  if (!list.length) { section.hidden = true; $('unscheduled-list').replaceChildren(); return; }
  section.hidden = false;
  $('unscheduled-list').replaceChildren(...list.map((s) => h('button', {
    class: 'block block-compact', 'data-session': s.sessionId, 'data-state': 'favorite',
    'data-turn': `Tell me more about ${s.title} (session ${s.sessionId})`,
  }, h('span', { class: 'title' }, s.title), s.venue ? h('span', { class: 'meta-compact' }, s.venue) : null)));
}

// Set once startExperience() runs, which only happens after pairing — the
// gate screen (below) is everything an unpaired attendee sees.
let session;
let paired = false;
let lastDay;
let lastSchedule = null;
// What the attendee sees, as IDs only. setDynamicPrompt replaces the whole
// page_context value, so keep one merged state and always send all of it.
// Module-scoped (not just startExperience()'s local state) because the
// day-strip listener below calls this before startExperience() ever runs.
const screen = { view: 'home', day: null, visible: [], focused: null };
function syncScreen(patch) {
  Object.assign(screen, patch);
  session.setDynamicPrompt(screen);
}
// Sessions from the last show_sessions call, by day. Rendered as the same
// dashed "suggested" blocks as the server's topic-based picks, right in
// their real day/time slot, instead of a separate card list — so a search
// result always lines up with the calendar instead of floating above it.
// A fresh show_sessions call replaces this outright, same as the old card
// list did.
let highlighted = new Map();
function withHighlights(day, recommended, blocks) {
  const known = new Set([...recommended.map((r) => r.sessionId), ...blocks.map((b) => b.sessionId).filter(Boolean)]);
  return [...recommended, ...(highlighted.get(day) ?? []).filter((s) => !known.has(s.sessionId))];
}
const DESKTOP_MQ = window.matchMedia('(min-width: 1024px)');
function renderCurrentView() {
  if (!lastSchedule) return;
  if (DESKTOP_MQ.matches && lastSchedule.week) {
    renderWeek({
      ...lastSchedule,
      week: lastSchedule.week.map((w) => ({ ...w, recommended: withHighlights(w.day, w.recommended ?? [], w.blocks) })),
    });
  } else {
    renderTimeline({ ...lastSchedule, recommended: withHighlights(lastSchedule.day, lastSchedule.recommended ?? [], lastSchedule.blocks) });
  }
}
async function loadSchedule(day) {
  const data = await show('/api/schedule', { day });
  if (!data) return null;
  paired = Boolean(data.paired);
  if (!data.paired) {
    if (data.expired) toast('Your AWS connection lapsed. Reconnect to keep going.');
    return data; // the gate handles the unpaired state
  }
  // Keeps request vars accurate if a token ever lapses mid-session.
  try { if (session.state === 'connected') session.updateRequestVars({ paired: '1' }); } catch { /* */ }
  $('connect').textContent = 'Connected';
  lastDay = data.day ?? day;
  lastSchedule = data;
  renderChips(data);
  renderUnscheduled(data.unscheduledFavorites);
  renderCurrentView();
  return data;
}
DESKTOP_MQ.addEventListener('change', () => { if (paired) renderCurrentView(); });

document.querySelector('.day-strip').addEventListener('click', ({ target }) => {
  const btn = target.closest('.day');
  if (!btn) return;
  loadSchedule(btn.dataset.day);
  syncScreen({ view: 'day', day: btn.dataset.day, focused: null });
});

// Set while the sheet is open so closeConflict can tear the trap down again
// instead of leaking a document-level keydown listener behind it.
let conflictKeyHandler = null;
function closeConflict() {
  document.getElementById('conflict-sheet')?.remove();
  if (conflictKeyHandler) {
    document.removeEventListener('keydown', conflictKeyHandler);
    conflictKeyHandler = null;
  }
}
function optionEl(text, primary) {
  return h('button', { class: `option${primary ? ' btn-primary' : ''}`, 'data-turn': text }, h('span', {}, text));
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function renderRecap(recap) {
  // busiestDay is a "YYYY-MM-DD" string (server/schedule.mjs), or null if
  // nothing reserved has a date yet — skip the stat rather than show "null".
  // Parsed with an explicit UTC time so a date-only string never rolls back
  // a day for attendees west of UTC.
  const busiestDay = recap.busiestDay ? WEEKDAYS[new Date(`${recap.busiestDay}T00:00:00Z`).getUTCDay()] : null;
  $('timeline').replaceChildren(h('span', {}), h('article', { class: 'recap' },
    h('span', { class: 't-kicker' }, 'My re:Invent week'),
    h('dl', { style: 'margin:0;display:grid;gap:var(--s-3);text-align:left' },
      h('div', {}, h('dt', { class: 'stat' }, String(recap.totalSessions)), h('dd', { class: 't-section' }, 'sessions')),
      h('div', {}, h('dt', { class: 'stat' }, String(recap.venues.length)), h('dd', { class: 't-section' }, 'venues')),
      h('div', {}, h('dt', { class: 'stat' }, String(recap.days.length)), h('dd', { class: 't-section' }, 'days')),
      busiestDay && h('div', {}, h('dt', { class: 'stat' }, busiestDay.slice(0, 3)), h('dd', { class: 't-section' }, 'busiest day'))),
    h('button', { class: 'btn btn-primary', id: 'recap-share' }, 'Share')));
  $('recap-share').addEventListener('click', async () => {
    const text = `My re:Invent week: ${recap.totalSessions} sessions across ${recap.venues.length} venues.${busiestDay ? ` Busiest day: ${busiestDay}.` : ''}`;
    if (navigator.share) { await navigator.share({ text }).catch(() => {}); return; }
    await navigator.clipboard.writeText(text).catch(() => {});
    toast('Copied to clipboard');
  });
}

// "12 days" before the event, "Day 2 of 5" during it. DESIGN.md § Fun moments.
function countdown() {
  const days = Math.ceil((Date.parse('2026-11-30T00:00:00-08:00') - Date.now()) / 864e5);
  const day = 1 - days;
  $('countdown').textContent = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : day <= 5 ? `Day ${day} of 5` : '';
}

// Everything below only runs once AWS pairing has succeeded: the gate at the
// bottom of this file is the entire unpaired experience, so `paired` is
// always true by the time this is called. ARCHITECTURE.md § Pairing.
async function startExperience() {
$('gate').hidden = true;
$('app').hidden = false;
countdown();

// Awaited before connect(), not fired alongside it: the opening line's
// topInterest branch needs the attendee's top topic in requestVars at
// construction, and request vars set only after connect() arrive too late
// for the very first opening. scripts/provision.mjs § OPENING_PHRASE.
const scheduleData = await loadSchedule();

const { partnerId, widgetId } = await api('/api/config');
const kaltura = new Management({ partnerId: Number(partnerId) });
const widget = await kaltura.sessions.createWidgetToken({ widgetId });
const init = await kaltura.application.appInit(widget.ks);

session = new KalturaAgentSession({
  token: init.ks,
  mode: 'avatar',
  // Request variables stick to the thread. Clear with '', never by omitting a key.
  requestVars: { returning: '', page_context: '', paired: '1', topInterest: scheduleData?.topInterest ?? '' },
  avatar: {
    conversationManagerUrl: init.conversationManagerUrl,
    srsBaseUrl: init.srsBaseUrl,
    turnServerUrl: init.turnServerUrl,
    videoEl: $('avatar-video'),
    audioEl: $('avatar-audio'),
    socketFactory: (url, opts) => window.io(url, opts),
    isFirefox: /firefox/i.test(navigator.userAgent),
    requireDisclosureAck: true,
    micStartMode: 'deferred',
    // Expo-floor noise: the SDK's own AudioWorklet gate. Raw audio in, so the
    // browser-native Tier-1 suppressor doesn't double-process the signal.
    micConstraints: false,
    noiseProcessor: createNoiseSuppressor({ thresholdDb: -50 }),
  },
});

// sendText throws until the attendee accepts the disclosure.
let acknowledge;
let disclosureAcked = false;
const disclosed = new Promise((resolve) => { acknowledge = resolve; });
// If the avatar never connects, disclosure never fires. Let AWS pairing
// through anyway instead of hanging on a dialog that will never show.
function skipDisclosureGate() { disclosureAcked = true; acknowledge(); }

// Captions: the attendee's last line in lavender, then Nevada's sentence.
let heard = '';
function caption(said = '') {
  const you = document.createElement('span');
  you.className = 'you';
  you.textContent = heard;
  captions.replaceChildren(...(heard ? [you] : []), said);
  // Nevada's actual reply is what answers a tapped block, so that's the one
  // signal that clears the tap's pending state, not just a fixed delay.
  if (said) clearPending();
}
function clearPending() {
  document.querySelector('.block.pending')?.classList.remove('pending');
}

function listening(on) {
  mic.dataset.state = on ? 'listening' : 'idle';
  mic.setAttribute('aria-pressed', on);
  $('ask').placeholder = on ? 'Listening. Tap the mic to mute.' : 'Ask Nevada';
  if (frame.dataset.voice !== 'speaking') frame.dataset.voice = on ? 'listening' : 'idle';
}

// The frame floats free (position: fixed), so a drag just sets its inline
// left/top; leaving those set survives a state change too, remembered in
// dragHome until the attendee drags her again. DESIGN.md § Avatar frame.
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
function clearFramePosition() {
  frame.style.left = ''; frame.style.top = ''; frame.style.right = ''; frame.style.bottom = '';
}
function setFramePosition(left, top) {
  const w = frame.offsetWidth;
  const h = frame.offsetHeight;
  frame.style.left = `${clamp(left, 0, window.innerWidth - w)}px`;
  frame.style.top = `${clamp(top, 0, window.innerHeight - h)}px`;
  frame.style.right = '';
  frame.style.bottom = '';
}
let dragHome = null;
// She stays full ("stage") size everywhere; when content needs her spot, she
// moves to the corner instead of shrinking. Tracks that moved-aside state so
// leanBack (after point_at) returns her there instead of to the home spot.
let awayFromHome = false;
function positionAway() {
  const w = frame.offsetWidth;
  const h = frame.offsetHeight;
  const composerH = parseFloat(getComputedStyle(app).getPropertyValue('--composer-h')) || 160;
  setFramePosition(window.innerWidth - w - 16, window.innerHeight - h - composerH - 16);
}
function moveOutOfWay() {
  if ('dragging' in frame.dataset || dragHome) return;
  awayFromHome = true;
  positionAway();
}
function moveHome() {
  if ('dragging' in frame.dataset) return;
  awayFromHome = false;
  if (dragHome) setFramePosition(dragHome.left, dragHome.top);
  else clearFramePosition();
}

// Pointer drag to reposition her anywhere on the page. dragMoved gates the
// click handler below so a drag release doesn't also count as a tap.
let dragStart = null;
let dragMoved = false;
frame.addEventListener('pointerdown', (e) => {
  if (e.button) return;
  if (e.target.closest('button, input, a')) return; // let the mic/quiet toggle keep its own click
  frame.setPointerCapture(e.pointerId);
  const rect = frame.getBoundingClientRect();
  dragStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
  dragMoved = false;
});
frame.addEventListener('pointermove', (e) => {
  if (!dragStart) return;
  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;
  if (!dragMoved && Math.hypot(dx, dy) < 4) return;
  dragMoved = true;
  frame.dataset.dragging = '';
  setFramePosition(dragStart.left + dx, dragStart.top + dy);
});
function endDrag(e) {
  if (!dragStart) return;
  frame.releasePointerCapture(e.pointerId);
  if (dragMoved) {
    const rect = frame.getBoundingClientRect();
    dragHome = { left: rect.left, top: rect.top };
  }
  dragStart = null;
  delete frame.dataset.dragging;
}
frame.addEventListener('pointerup', endDrag);
frame.addEventListener('pointercancel', endDrag);

// Glides her next to whatever she's talking about, then back home after.
// Never fights an attendee mid-drag.
function leanToward(el) {
  if ('dragging' in frame.dataset) return;
  const target = el.getBoundingClientRect();
  const w = frame.offsetWidth;
  const h = frame.offsetHeight;
  const onRight = target.left > window.innerWidth / 2;
  const left = onRight ? target.left - w - 16 : target.right + 16;
  setFramePosition(clamp(left, 8, window.innerWidth - w - 8), clamp(target.top, 8, window.innerHeight - h - 8));
}
function leanBack() {
  if ('dragging' in frame.dataset) return;
  if (dragHome) setFramePosition(dragHome.left, dragHome.top);
  else if (awayFromHome) positionAway();
  else clearFramePosition();
}

// Typed and tapped turns. In avatar mode Nevada answers out loud.
function say(text) {
  if (!text) return false;
  heard = text;
  caption();
  disclosed.then(() => session.sendText(text)).catch(() => toast("Couldn't send that. Try again."));
  return true;
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  if (say($('ask').value.trim())) $('ask').value = '';
});
// Disabled in the HTML so Enter can't reload the page before this handler
// exists, and left disabled until the disclosure is shown and accepted:
// otherwise an eager first tap echoes a caption with no reply, right before
// the disclosure modal interrupts it.
function setInputEnabled(on) {
  $('ask').disabled = !on;
  mic.disabled = !on;
  for (const b of $('chips').querySelectorAll('button')) b.disabled = !on;
}
setInputEnabled(false);
// Chips and card actions carry the turn text, e.g. "Reserve Multi-agent
// systems in production (session ABC123)". EXPERIENCE-UX.md § Talk, type or tap.
document.addEventListener('click', ({ target }) => {
  const button = target.closest('[data-turn]');
  if (!button) return;
  // Tapping a block sends a spoken turn with no other feedback until Nevada
  // replies seconds later; dim the tapped block right away so the tap itself
  // is visibly registered, not just silently swallowed.
  if (button.classList.contains('block')) {
    clearPending();
    button.classList.add('pending');
  }
  say(button.dataset.turn || button.textContent.trim());
});

// Scrolling the day moves her to the corner instead of shrinking her, then
// back once the attendee scrolls back to the top.
let scrolledAt = 0;
$('main').addEventListener('scroll', ({ target }) => {
  scrolledAt = Date.now();
  if (target.id !== 'timeline') return;
  if (target.scrollTop === 0) moveHome();
  else if (!awayFromHome) moveOutOfWay();
}, { capture: true, passive: true });
frame.addEventListener('click', () => {
  if (dragMoved) { dragMoved = false; return; }
  if (awayFromHome) moveHome();
});
// Dragging has no keyboard equivalent, but returning her home from the
// corner is core to "she's part of the page," so give it one: tabindex="0"
// on the frame (index.html) makes it focusable, Enter/Space mirrors the tap.
// Skip when the key came from a real child button (mic/quiet toggle), which
// already handles its own activation.
frame.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('button')) return;
  e.preventDefault();
  if (awayFromHome) moveHome();
});
// Tile captions sit just above the composer.
new ResizeObserver(([{ target }]) => app.style.setProperty('--composer-h', `${target.offsetHeight}px`))
  .observe(document.querySelector('.composer-bar'));

// Quiet mode: video and captions carry on. With no voice, screen readers read the captions.
// Stops the click bubbling to the frame's own click handler below, which
// would otherwise treat this tap as "snap Nevada home" whenever she's moved
// aside mid-conversation.
$('quiet').addEventListener('click', (e) => {
  e.stopPropagation();
  const audio = $('avatar-audio');
  audio.muted = !audio.muted;
  e.currentTarget.setAttribute('aria-pressed', audio.muted);
  captions.setAttribute('aria-live', audio.muted ? 'polite' : 'off');
});

// Key Nevada out of her green backdrop so she stands on the page, not in a box.
// The render also frames her in an uneven black margin that keying keeps, so
// sample 2.5 s of frames for where she is and let CSS crop to that. If keying
// can't start (no WebGL or Canvas2D), the plain video shows in a framed box.
// DESIGN.md § Avatar frame.
// Tracked so a later transportChanged (e.g. quiet-reconnect after
// backgrounding) destroys the old keyer instead of stacking a second one.
let currentPlayer = null;
function key(videoEl, transport) {
  currentPlayer?.destroy();
  currentPlayer = null;
  let player;
  try {
    player = attachChromaKeyAvatar({
      session: transport, videoEl, ChromaKeyVideo, container: $('cutout'),
      options: { autoTune: 'adaptive' },
    });
  } catch {
    return;
  }
  currentPlayer = player;
  frame.dataset.keyed = 'on';
  disarmMediaWatchdog();
  player.addEventListener('started', () => {
    // [left, top, right, bottom] as fractions of the frame.
    const lit = [1, 1, 0, 0];
    const her = [1, 1, 0, 0];
    const grow = (box, x, y) => {
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    };
    const timer = setInterval(() => {
      const image = player.sampleFrame();
      if (!image) return;
      const { data, width, height } = image;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (Math.max(r, g, b) < 15) continue;
        const x = ((i / 4) % width + 0.5) / width;
        const y = (Math.floor(i / 4 / width) + 0.5) / height;
        grow(lit, x, y);
        if (!(g > r * 1.3 && g > b * 1.3)) grow(her, x, y);
      }
    }, 150);
    setTimeout(() => {
      clearInterval(timer);
      // Pad for hair and hands, but never into the black margin.
      const [x0, y0, x1, y1] = her.map((v, i) => (i < 2 ? Math.max(lit[i], v - 0.03) : Math.min(lit[i], v + 0.03)));
      if ((x1 - x0) * (y1 - y0) < 0.04) {
        player.destroy();
        currentPlayer = null;
        delete frame.dataset.keyed;
        return;
      }
      for (const [name, v] of [['bx', x0], ['by', y0], ['bw', x1 - x0], ['bh', y1 - y0]]) frame.style.setProperty(`--${name}`, v.toFixed(3));
      frame.dataset.keyed = 'ready';
    }, 2500);
  }, { once: true });
}

// The video element's own media events are the one signal that's true
// regardless of whether the SDK notices its transport died: if the stream
// empties or ends and nothing replaces it (a real transportChanged, caught
// below by the chroma-key player actually starting), Nevada is frozen with
// no way for the page to otherwise know. A grace period covers the normal
// case of a legitimate reconnect swapping in a fresh stream.
let mediaWatchdog = null;
function armMediaWatchdog() {
  if (mediaWatchdog) return;
  mediaWatchdog = setTimeout(() => {
    mediaWatchdog = null;
    toast('Lost connection to Nevada. Reload to reconnect.');
    caption('Lost connection to Nevada. Reload to reconnect.');
  }, 5000);
}
function disarmMediaWatchdog() {
  clearTimeout(mediaWatchdog);
  mediaWatchdog = null;
}
$('avatar-video').addEventListener('emptied', armMediaWatchdog);
$('avatar-video').addEventListener('ended', armMediaWatchdog);

// Transport-only events and methods. The first transport attaches in connect().
session.on('transportChanged', ({ transport }) => {
  // The chat fallback's transport has no video.
  if (transport.videoEl) key(transport.videoEl, transport);
  transport.on('disclosure', ({ disclosureText }) => {
    if (disclosureText) $('disclosure-text').textContent = disclosureText;
    $('disclosure').showModal();
  });
  transport.on('micStarted', () => listening(transport.micEnabled));
  transport.on('localMicLevel', ({ level }) => frame.style.setProperty('--mic-level', Math.min(1, level)));
});

// The disclosure must be accepted, not just closed — Escape fires this
// native event before any 'close' handler, so block it here.
$('disclosure').addEventListener('cancel', (e) => e.preventDefault());

$('disclosure-ok').addEventListener('click', () => {
  $('disclosure').close();
  disclosureAcked = true;
  session.transport.acknowledgeDisclosure();
  // Unlock audio synchronously in this same click, so it rides the user
  // gesture instead of missing it and falling through to the "tap anywhere"
  // recovery below.
  session.transport.startPlayback().catch(() => {});
  setInputEnabled(true);
  acknowledge();
});

// Mic taps are the user gesture the browser needs for the mic.
mic.addEventListener('click', () => {
  const t = session.transport;
  if (!t) return;
  if (!t.micStarted) return t.startMic();
  if (t.micEnabled) t.mute(); else t.unmute();
  listening(t.micEnabled);
});

session.on('warning', ({ code }) => {
  // No voice says these, so the toast sends them to screen readers too.
  if (code === 'playback_blocked') {
    caption('Tap anywhere to hear Nevada.');
    toast('Tap anywhere to hear Nevada.');
    document.addEventListener('click', () => session.transport.startPlayback(), { once: true, capture: true });
  }
  if (code === 'mic_permission_denied') {
    mic.dataset.state = 'off';
    caption('Mic is off. You can still type, and Nevada answers out loud.');
    toast('Mic is off. You can still type.');
  }
});
// The frame shows Nevada's side. The mic button shows only the attendee's.
session.on('responsePending', () => { frame.dataset.voice = 'thinking'; });
session.on('responseSettled', () => { if (frame.dataset.voice === 'thinking') frame.dataset.voice = 'idle'; });
session.on('avatarStartTalking', () => { frame.dataset.voice = 'speaking'; });
session.on('avatarStopTalking', () => {
  frame.dataset.voice = session.transport?.micEnabled ? 'listening' : 'idle';
});
session.on('transcript', ({ type, text }) => {
  if (!text) return;
  // The attendee's line arrives only after they finish speaking.
  if (type === 'user') {
    heard = text;
    caption();
  }
  if (type === 'final' && text !== SILENT_OPENING_LABEL && !isSilentOpening(text)) {
    caption(text);
    clearToolFollowup();
  }
});
session.on('error', () => { skipDisclosureGate(); clearPending(); toast('Nevada hit a snag. Try again.'); });
// R5 brain-liveness watchdog: fires every brainStallMs (default 12 s) while the
// brain stays silent after a turn starts, including turns with no tool call and
// no error event — the one class of stall the app had no signal for at all.
session.on('brainStalled', () => toast("Still working on that, one moment."));
// Soft signal the brain is looping on tool calls within one turn (no action
// taken yet at this point, just a heads-up); spiralRecovered fires once the
// SDK's own hard-limit cold-reconnect has resent the turn and gotten a fresh
// reply, so the earlier toast can stand down.
session.on('toolSpiralDetected', () => toast("This is taking a few tries, hang on."));
session.on('spiralRecovered', () => toast('Reconnected. One moment.'));
// STV media (the avatar's video/audio) can drop independently of the control
// channel — an ICE hiccup the SDK retries in place before ever escalating to a
// full cold reconnect. Without these, the frame goes silently frozen until the
// DOM-level armMediaWatchdog's 5 s guess fires; these give the real signal
// first, and disarm that guess if recovery finishes before it would.
// DESIGN.md's Conversation-states table promises a blurred frame plus an
// on-frame "Reconnecting…" label (styles.css's [data-voice="reconnecting"])
// and a disabled mic during recovery, not just a caption/toast: the frame
// is what the attendee is staring at, so that's where the real cue belongs.
function enterReconnecting() {
  frame.dataset.voice = 'reconnecting';
  mic.disabled = true;
  caption('Reconnecting to Nevada…');
  toast('Reconnecting to Nevada…');
}
function leaveReconnecting() {
  if (frame.dataset.voice === 'reconnecting') frame.dataset.voice = 'idle';
  mic.disabled = false;
  disarmMediaWatchdog();
  caption();
  toast('Reconnected.');
}
session.on('mediaRecovering', enterReconnecting);
session.on('mediaRecovered', leaveReconnecting);
session.on('reconnecting', enterReconnecting);
session.on('reconnected', leaveReconnecting);
// Generalized peer of the above: covers a tool call that resolves with real
// data but the model never speaks a follow-up at all (confirmed live on
// reserve_sessions, not just the search retry-spiral). The SDK's own watchdog
// misses this because its generic "still there?" idle nudge counts as real
// spoken output to it, masking the failure for far longer than a user should
// wait with zero acknowledgment. Armed after each server-tool response,
// cleared by the next real spoken line.
let toolFollowupTimer = null;
function armToolFollowup(ms = 9000) {
  clearTimeout(toolFollowupTimer);
  toolFollowupTimer = setTimeout(() => { clearPending(); toast("Didn't get a clear answer on that, try asking again."); }, ms);
}
function clearToolFollowup() { clearTimeout(toolFollowupTimer); toolFollowupTimer = null; }

// Backgrounding under 30 s holds the session; longer sets `returning` for the
// next join so the opening says "Welcome back" instead of staying silent.
// EXPERIENCE-UX.md § Network and backgrounding; ARCHITECTURE.md § Opening.
let hiddenAt = null;
let cancelReturning = null;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const gap = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = null;
  if (gap < 30_000 || session.state !== 'connected') return;
  try { session.updateRequestVars({ returning: '1' }); } catch { return; }
  cancelReturning?.();
  const clear = () => {
    cancelReturning = null;
    try { if (session.state === 'connected') session.updateRequestVars({ returning: '' }); } catch { /* */ }
  };
  const unsubscribe = session.once('turnStart', clear);
  const timer = setTimeout(clear, 15_000);
  cancelReturning = () => { clearTimeout(timer); unsubscribe(); clear(); };
});

// Client tools: IDs in, page data from our Web API. Args: ARCHITECTURE.md § Tools.
// Nevada stays on screen at full size: tools move the frame aside, never hide or shrink it.
session.onToolCall('show_sessions', async ({ sessionIds }) => {
  const data = await show('/api/sessions', { ids: sessionIds });
  if (!data || !lastSchedule) return;
  highlighted = new Map();
  for (const s of data.sessions) {
    if (!s.day) continue;
    if (!highlighted.has(s.day)) highlighted.set(s.day, []);
    highlighted.get(s.day).push(s);
  }
  renderCurrentView();
  moveOutOfWay();
  syncScreen({ view: 'day', day: lastSchedule.day, visible: sessionIds, focused: null });
});
session.onToolCall('render_schedule', async ({ day, focusIds }) => {
  const data = await loadSchedule(day);
  if (!data) return;
  moveOutOfWay();
  syncScreen({ view: 'day', day: data.day ?? day, focused: null });
});
session.onToolCall('highlight_conflict', async ({ sessionId, conflictsWith, options }) => {
  closeConflict();
  const opts = options ?? [];
  const ids = [sessionId, ...conflictsWith];
  const data = await show('/api/sessions', { ids });
  if (!data) return;
  const [target, clash] = data.sessions;
  moveOutOfWay();
  const sheet = h('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Schedule clash', tabindex: -1 },
    h('span', { class: 'grabber' }),
    h('span', { class: 't-kicker', style: 'color: var(--danger-text)' }, `Clash${target?.clock ? ` · ${target.clock}` : ''}`),
    h('div', { class: 'clash-pair' },
      h('div', { class: 'block' }, h('span', { class: 'title' }, target?.title ?? sessionId), h('span', { class: 'meta' }, [target?.venue, target?.clock].filter(Boolean).join(' · '))),
      h('span', { class: 'clash-link' }),
      h('div', { class: 'block' }, h('span', { class: 'title' }, clash?.title ?? conflictsWith[0]), h('span', { class: 'meta' }, [clash?.venue, clash?.clock].filter(Boolean).join(' · ')))),
    ...opts.map((text, i) => optionEl(text, i === 0 && opts.length > 1)),
    h('p', { class: 'warn' }, "Swapping drops your old seat first. If the new one fills before I get you in, I'll try to get your old seat back, but I can't promise it."));
  document.body.append(
    h('div', { class: 'scrim', id: 'conflict-sheet' }, sheet));
  document.getElementById('conflict-sheet').addEventListener('click', (e) => { if (e.target.id === 'conflict-sheet') closeConflict(); });
  // Keyboard users land here with nothing to tab to otherwise, since the
  // sheet is appended after the rest of the page: focus the first real
  // choice (or the sheet itself, via its tabindex, when there are none), let
  // Escape close it the way tapping the scrim already does, and trap Tab so
  // it can't wander back out into the page behind the scrim.
  const focusable = [...sheet.querySelectorAll('button')];
  (focusable[0] ?? sheet).focus();
  conflictKeyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeConflict(); return; }
    if (e.key !== 'Tab' || !focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', conflictKeyHandler);
  syncScreen({ view: 'conflict', visible: ids, focused: sessionId });
});
// celebrate_action only carries {kind} (ARCHITECTURE.md § Tools), not which
// session changed or where it landed. Snapshot every session's kind before
// the reload below and diff against what comes back to find it, so a swap's
// toast can name the day/time/venue Nevada already said out loud, and the
// changed block gets a small visual cue instead of just the shared confetti.
function snapshotSessions() {
  const map = new Map();
  const collect = (blocks) => { for (const b of blocks ?? []) if (b.sessionId) map.set(b.sessionId, b.kind); };
  if (lastSchedule?.week) for (const w of lastSchedule.week) collect(w.blocks);
  else collect(lastSchedule?.blocks);
  return map;
}
function findChanged(before) {
  const blocks = lastSchedule?.week
    ? lastSchedule.week.flatMap((w) => (w.blocks ?? []).map((b) => ({ ...b, day: w.day })))
    : (lastSchedule?.blocks ?? []).map((b) => ({ ...b, day: lastSchedule.day }));
  return blocks.find((b) => b.sessionId && b.kind !== before.get(b.sessionId));
}
// A once-off outline pulse on the block that just got a seat.
function pulseBlock(el) {
  el.classList.add('pulse-booked');
  setTimeout(() => el.classList.remove('pulse-booked'), 700);
}
// A little star spins onto the block that just got favorited, using the
// symbol the markup already defines but nothing draws yet (index.html #i-star).
const SVG_NS = 'http://www.w3.org/2000/svg';
function starPop(el) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'star-pop');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-star');
  svg.append(use);
  el.append(svg);
  setTimeout(() => svg.remove(), 700);
}
session.onToolCall('celebrate_action', async ({ kind }) => {
  const before = snapshotSessions();
  toast({ reserve: "You're in.", favorite: 'Saved.', swap: 'Swapped.' }[kind] ?? 'Done.');
  burst();
  if ('vibrate' in navigator) navigator.vibrate(12);
  closeConflict();
  // The change may affect the day currently on screen; pull it fresh so the
  // timeline never shows stale "wide open" text after a booking change.
  await loadSchedule(screen.day);
  const changed = findChanged(before);
  if (!changed) return;
  if (kind === 'swap' && changed.day) {
    toast(`Swapped. ${changed.title ?? 'That session'} is now ${[changed.day, changed.clock, changed.venue].filter(Boolean).join(' · ')}.`);
  }
  const el = document.querySelector(`[data-session="${CSS.escape(changed.sessionId)}"]`);
  if (!el) return;
  if (kind === 'favorite') starPop(el);
  else pulseBlock(el);
});
session.onToolCall('show_recap', async () => {
  const data = await show('/api/schedule', { recap: true });
  if (!data) return;
  renderRecap(data.recap);
  moveOutOfWay();
  syncScreen({ view: 'recap', visible: [], focused: null });
});
// Blocks carry data-session. Scroll only when the target is off screen,
// with no smooth scroll, and never while the attendee is scrolling.
session.onToolCall('point_at', ({ sessionId }) => {
  const el = document.querySelector(`[data-session="${CSS.escape(sessionId)}"]`);
  if (!el) return;
  if (Date.now() - scrolledAt > 800) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  el.classList.add('focus');
  leanToward(el);
  setTimeout(() => { el.classList.remove('focus'); leanBack(); }, 4000);
  syncScreen({ focused: sessionId });
});

// Server tools: same names and args as scripts/provision.mjs's API_TOOLS. The
// LLM's call reaches this page (a `client` tool, never Kaltura's cloud), which
// POSTs same-origin to our own proxy and ACKs the result back. This is what
// makes tool calls work on localhost. ARCHITECTURE.md § Tools.
const SERVER_TOOLS = [
  'get_topics', 'search_sessions', 'get_session', 'get_my_schedule', 'favorite_sessions',
  'unfavorite_session', 'reserve_sessions', 'cancel_reservation', 'swap_reservation',
  'add_personal_time', 'update_personal_time', 'delete_personal_time',
];
// These change what's on the schedule. celebrate_action also refreshes it,
// but only when the LLM calls it, e.g. never after a plain removal — so the
// timeline can go stale until the next day switch. Refresh here instead,
// tied to the mutation itself rather than the LLM's choice to celebrate it.
const MUTATES_SCHEDULE = new Set([
  'favorite_sessions', 'unfavorite_session', 'reserve_sessions', 'cancel_reservation',
  'swap_reservation', 'add_personal_time', 'update_personal_time', 'delete_personal_time',
]);
// Enforced peer of prompts/rules.md's "call search_sessions at most once per
// turn": that prompt rule alone didn't stop the model retrying with different
// filters mid-turn (confirmed live), so a repeat call within one turn is
// short-circuited to the first result instead of hitting the network again.
let searchThisTurn = null;
// Arms the same watchdog at turn start, not just after a tool responds — a
// turn that never calls a tool at all (confirmed live, no error, no tool
// call, no speech) had nothing watching it before beyond the SDK's own
// unresolved 12 s "still working" nudge. Longer than that nudge's interval,
// so it only fires once the SDK's own reassurance has already had its turn.
session.on('turnStart', () => { searchThisTurn = null; armToolFollowup(16000); });

for (const name of SERVER_TOOLS) {
  session.onToolCall(name, async (args, call) => {
    let result;
    if (name === 'search_sessions' && searchThisTurn) {
      result = searchThisTurn;
    } else {
      result = await api(`/tools/${name}`, args)
        .catch(() => ({ answer: "That didn't work. Try again in a moment." }));
      if (name === 'search_sessions') searchThisTurn = result;
    }
    if (call.toolMetadata?.waitForResponse) session.respondToTool(call.toolMetadata.id, result).catch(() => {});
    if (MUTATES_SCHEDULE.has(name)) loadSchedule(screen.day);
    armToolFollowup();
  });
}

// A failed connect can't be retried on the same session. Reload builds a new one.
await session.connect().catch(() => { skipDisclosureGate(); toast("Couldn't reach Nevada. Reload to try again."); });
} // startExperience

// Usually just offers the phone handoff again, but a token can lapse
// mid-session (EXPERIENCE-UX.md § Network and backgrounding), which flips
// `paired` back to false and needs the same pairing dialog the gate uses.
$('connect').addEventListener('click', () => {
  if (paired) { showPairSuccess(); return; }
  openPairing(() => loadSchedule(lastDay));
});

// Pairing: a 6-character code the attendee enters via `npx nevada-pair` on a
// laptop with AWS Builder ID sign-in. Runs on the gate, before the avatar
// experience exists at all. EXPERIENCE-UX.md § First run.
let pairingTimer = null;
function stopPairingPoll() {
  clearInterval(pairingTimer);
  pairingTimer = null;
}
async function openPairing(onPaired) {
  $('pairing').showModal();
  $('pair-code').textContent = '';
  $('pair-command').textContent = '';
  $('pair-status').textContent = 'Generating your code…';
  const { code, command } = await api('/api/pair/start', {}).catch(() => ({}));
  if (!code) { $('pair-status').textContent = "Couldn't generate a code. Try again."; return; }
  $('pair-code').textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
  $('pair-command').textContent = command;
  $('pair-status').textContent = 'Waiting…';
  stopPairingPoll();
  pairingTimer = setInterval(async () => {
    const { state } = await api(`/api/pair/status/${code}`).catch(() => ({ state: 'waiting' }));
    if (state === 'paired') {
      stopPairingPoll();
      $('pair-status').textContent = "Connected. You're all set.";
      setTimeout(() => { $('pairing').close(); onPaired(); }, 700);
    } else if (state === 'expired') {
      stopPairingPoll();
      $('pair-status').textContent = 'That code expired. Close and try again.';
    }
  }, 2500);
}
$('pair-close').addEventListener('click', () => { stopPairingPoll(); $('pairing').close(); });
$('pair-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('pair-command').textContent).catch(() => {});
  toast('Copied');
});

// Offers a handoff to a phone for the live conversation, right after pairing
// and any time after from the header pill, instead of assuming the device
// that paired is the one to keep talking on.
let pairSuccessContinue = () => {};
async function showPairSuccess(onContinue = () => {}) {
  pairSuccessContinue = onContinue;
  $('pair-success').showModal();
  const { url } = await api('/api/pair/handoff', {}).catch(() => ({}));
  if (url) {
    $('pair-handoff-link').textContent = url;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('pair-qr').innerHTML = qr.createSvgTag(6, 8);
  } else {
    $('pair-qr').hidden = true;
    $('pair-handoff-link').hidden = true;
  }
}
// Right after pairing there's no avatar experience yet, so dismissing
// without picking a device would leave nothing on screen — block that case
// only; once already connected (paired is true) it's just an FYI dialog.
$('pair-success').addEventListener('cancel', (e) => { if (!paired) e.preventDefault(); });
$('pair-continue-here').addEventListener('click', () => { $('pair-success').close(); pairSuccessContinue(); });
$('gate-connect').addEventListener('click', () => openPairing(() => showPairSuccess(startExperience)));

const initial = await api('/api/schedule', {}).catch(() => ({}));
paired = Boolean(initial.paired);
if (paired) await startExperience();
else {
  $('gate').hidden = false;
  if (initial.expired) toast('Your AWS connection lapsed. Reconnect to keep going.');
}
// A handoff link that was already used, expired, or otherwise invalid lands
// here instead of pairing silently — say so instead of just showing a
// generic unpaired gate the attendee has no way to explain.
if (new URLSearchParams(location.search).has('handoff_failed')) {
  toast("That link already expired or was used. Ask for a fresh one.");
  history.replaceState(null, '', location.pathname);
}
