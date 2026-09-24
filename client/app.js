/**
 * Marquee web app shell. Runtime rules: ARCHITECTURE.md § Runtime.
 *
 * Built so far: widget token, one KalturaAgentSession in avatar mode with
 * Marquee live the whole visit, disclosure, talk, type or tap turns, captions,
 * quiet mode, screen context and client tools that fetch what they show from
 * our Web API. The Web API data routes return 501 until ROADMAP.md Phase 1,
 * so the tools only show a toast for now. Not built: the quiet reconnect with
 * `returning` after the background grace and the conflict sheet (Phase 1),
 * and the chat fallback (Phase 3).
 */
import { KalturaAgentSession, isSilentOpening, SILENT_OPENING_LABEL } from '@kaltura/intelligent-agents';
import { Management } from '@kaltura/intelligent-agents/management';

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

// Page data for a client tool. Until Phase 1 the routes answer 501.
async function show(path, body) {
  try {
    return await api(path, body);
  } catch (err) {
    toast(err.status === 501 ? 'Coming soon' : "Couldn't load that");
    return null;
  }
}

// "12 days" before the event, "Day 2 of 5" during it. DESIGN.md § Fun moments.
function countdown() {
  const days = Math.ceil((Date.parse('2026-11-30T00:00:00-08:00') - Date.now()) / 864e5);
  const day = 1 - days;
  $('countdown').textContent = days > 0 ? `${days} day${days > 1 ? 's' : ''}` : day <= 5 ? `Day ${day} of 5` : '';
}

const { partnerId, widgetId } = await api('/api/config');
const kaltura = new Management({ partnerId: Number(partnerId) });
const widget = await kaltura.sessions.createWidgetToken({ widgetId });
const init = await kaltura.application.appInit(widget.ks);
const { sessionRef } = await api('/api/session-ref', {});

const session = new KalturaAgentSession({
  token: init.ks,
  mode: 'avatar',
  // Request variables stick to the thread. Clear with '', never by omitting a key.
  requestVars: { session_ref: sessionRef, returning: '', page_context: '' },
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
  },
});

// sendText throws until the attendee accepts the disclosure.
let acknowledge;
const disclosed = new Promise((resolve) => { acknowledge = resolve; });

// Captions: the attendee's last line in lavender, then Marquee's sentence.
let heard = '';
function caption(said = '') {
  const you = document.createElement('span');
  you.className = 'you';
  you.textContent = heard;
  captions.replaceChildren(...(heard ? [you] : []), said);
}

// Push-to-talk capture when the agent has isTapToTalk, else the open mic.
const capturing = (t) => (t.capabilities?.tapToTalk ? t.tapToTalkActive : t.micEnabled);
function listening(on) {
  mic.dataset.state = on ? 'listening' : 'idle';
  mic.setAttribute('aria-pressed', on);
  $('ask').placeholder = on ? 'Listening. Tap the mic to finish.' : 'Ask Marquee';
  if (frame.dataset.voice !== 'speaking') frame.dataset.voice = on ? 'listening' : 'idle';
}

// What the attendee sees, as IDs only. setDynamicPrompt replaces the whole
// page_context value, so keep one merged state and always send all of it.
const screen = { view: 'home', day: null, visible: [], focused: null };
function syncScreen(patch) {
  Object.assign(screen, patch);
  session.setDynamicPrompt(screen);
}

// stage, split or tile. DESIGN.md § Avatar frame.
const size = (s) => { app.dataset.avatar = s; };

// Typed and tapped turns. In avatar mode Marquee answers out loud.
function say(text) {
  if (!text) return false;
  // sendText throws while a push-to-talk capture is open.
  if (session.transport?.tapToTalkActive) {
    toast('Listening. Tap the mic to finish.');
    return false;
  }
  heard = text;
  caption();
  disclosed.then(() => session.sendText(text)).catch(() => toast("Couldn't send that. Try again."));
  return true;
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  if (say($('ask').value.trim())) $('ask').value = '';
});
// Disabled in the HTML so Enter can't reload the page before this handler exists.
$('ask').disabled = false;
// Chips and card actions carry the turn text, e.g. "Reserve Multi-agent
// systems in production (session ABC123)". EXPERIENCE-UX.md § Talk, type or tap.
document.addEventListener('click', ({ target }) => {
  const button = target.closest('[data-turn]');
  if (button) say(button.dataset.turn || button.textContent.trim());
});

// Scrolling the day shrinks the frame to a tile on phones. Only when the
// content can still scroll with the frame out of the way, so it can't flicker.
let scrolledAt = 0;
$('main').addEventListener('scroll', ({ target }) => {
  scrolledAt = Date.now();
  if (target.id !== 'timeline') return;
  if (target.scrollTop === 0) size('split');
  else if (app.dataset.avatar !== 'tile' && target.scrollTop > 48
    && target.scrollHeight - target.clientHeight > frame.offsetHeight + 48) size('tile');
}, { capture: true, passive: true });
frame.addEventListener('click', () => { if (app.dataset.avatar === 'tile') size('split'); });
// Tile captions sit just above the composer.
new ResizeObserver(([{ target }]) => app.style.setProperty('--composer-h', `${target.offsetHeight}px`))
  .observe(document.querySelector('.composer-bar'));

// Quiet mode: video and captions carry on. With no voice, screen readers read the captions.
$('quiet').addEventListener('click', ({ currentTarget }) => {
  const audio = $('avatar-audio');
  audio.muted = !audio.muted;
  currentTarget.setAttribute('aria-pressed', audio.muted);
  captions.setAttribute('aria-live', audio.muted ? 'polite' : 'off');
});

// Transport-only events and methods. The first transport attaches in connect().
session.on('transportChanged', ({ transport }) => {
  transport.on('disclosure', ({ disclosureText }) => {
    if (disclosureText) $('disclosure-text').textContent = disclosureText;
    $('disclosure').showModal();
  });
  transport.on('micStarted', () => listening(capturing(transport)));
  transport.on('localMicLevel', ({ level }) => frame.style.setProperty('--mic-level', Math.min(1, level)));
});

$('disclosure-ok').addEventListener('click', () => {
  $('disclosure').close();
  session.transport.acknowledgeDisclosure();
  acknowledge();
});

// Mic taps are the user gesture the browser needs for the mic.
mic.addEventListener('click', () => {
  const t = session.transport;
  if (!t) return;
  if (!t.micStarted) return t.startMic();
  // Toggle push-to-talk when the agent has isTapToTalk, else the mic button mutes.
  if (t.capabilities?.tapToTalk) {
    if (t.tapToTalkActive) t.endTapToTalk(); else t.startTapToTalk();
  } else if (t.micEnabled) t.mute(); else t.unmute();
  listening(capturing(t));
});

session.on('warning', ({ code }) => {
  // No voice says these, so the toast sends them to screen readers too.
  if (code === 'playback_blocked') {
    caption('Tap anywhere to hear Marquee.');
    toast('Tap anywhere to hear Marquee.');
    document.addEventListener('click', () => session.transport.startPlayback(), { once: true, capture: true });
  }
  if (code === 'mic_permission_denied') {
    mic.dataset.state = 'off';
    caption('Mic is off. You can still type, and Marquee answers out loud.');
    toast('Mic is off. You can still type.');
  }
});
// The frame shows Marquee's side. The mic button shows only the attendee's.
session.on('responsePending', () => { frame.dataset.voice = 'thinking'; });
session.on('responseSettled', () => { if (frame.dataset.voice === 'thinking') frame.dataset.voice = 'idle'; });
session.on('avatarStartTalking', () => { frame.dataset.voice = 'speaking'; });
session.on('avatarStopTalking', () => {
  frame.dataset.voice = session.transport && capturing(session.transport) ? 'listening' : 'idle';
});
session.on('transcript', ({ type, text }) => {
  if (!text) return;
  // The attendee's line arrives only after they finish speaking.
  if (type === 'user') {
    heard = text;
    caption();
  }
  if (type === 'final' && text !== SILENT_OPENING_LABEL && !isSilentOpening(text)) caption(text);
});
session.on('error', () => toast('Marquee hit a snag. Try again.'));

// Client tools: IDs in, page data from our Web API. Args: ARCHITECTURE.md § Tools.
// Marquee stays on screen: tools size the frame, never hide it.
session.onToolCall('show_sessions', async ({ sessionIds, title }) => {
  const data = await show('/api/sessions', { ids: sessionIds });
  if (!data) return;
  $('cards').setAttribute('aria-label', title);
  $('cards').hidden = false;
  size('split');
  syncScreen({ view: 'cards', visible: sessionIds, focused: null });
});
session.onToolCall('render_schedule', async ({ day, focusIds }) => {
  if (!await show('/api/schedule', { day, focusIds })) return;
  size('split');
  syncScreen({ view: 'day', day, focused: null });
});
session.onToolCall('highlight_conflict', async ({ sessionId, conflictsWith }) => {
  const ids = [sessionId, ...conflictsWith];
  if (!await show('/api/sessions', { ids })) return;
  size('split');
  syncScreen({ view: 'conflict', visible: ids, focused: sessionId });
});
session.onToolCall('celebrate_action', ({ kind }) => {
  toast({ reserve: "You're in.", favorite: 'Saved.', swap: 'Swapped.' }[kind] ?? 'Done.');
  if ('vibrate' in navigator) navigator.vibrate(12);
});
session.onToolCall('show_recap', async () => {
  if (!await show('/api/schedule', { recap: true })) return;
  size('split');
  syncScreen({ view: 'recap', visible: [], focused: null });
});
// Cards and blocks carry data-session. Scroll only when the target is off
// screen, with no smooth scroll, and never while the attendee is scrolling.
session.onToolCall('point_at', ({ sessionId }) => {
  const el = document.querySelector(`[data-session="${CSS.escape(sessionId)}"]`);
  if (!el) return;
  if (Date.now() - scrolledAt > 800) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  el.classList.add('focus');
  setTimeout(() => el.classList.remove('focus'), 4000);
  syncScreen({ focused: sessionId });
});

countdown();
// A failed connect can't be retried on the same session. Reload builds a new one.
await session.connect().catch(() => toast("Couldn't reach Marquee. Reload to try again."));
