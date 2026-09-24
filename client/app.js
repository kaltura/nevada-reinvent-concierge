/**
 * Marquee web app shell. Runtime rules: ARCHITECTURE.md § Runtime.
 *
 * Built so far: widget token, one KalturaAgentSession (voice first, shared
 * thread with chat), disclosure, mic start, captions and client tools that
 * fetch what they show from our Web API. The Web API data routes return 501
 * until ROADMAP.md Phase 1, so the tools only show a toast for now. Not built:
 * the quiet reconnect with `returning` after the background grace (Phase 1).
 */
import { KalturaAgentSession, isSilentOpening, SILENT_OPENING_LABEL } from '@kaltura/intelligent-agents';
import { Management } from '@kaltura/intelligent-agents/management';

const $ = (id) => document.getElementById(id);
const mic = $('mic');
const captions = $('captions');
const stage = $('stage');

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
  requestVars: { session_ref: sessionRef, returning: '' },
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

// Transport-only events and methods. The first transport attaches in connect().
session.on('transportChanged', ({ transport }) => {
  transport.on('disclosure', ({ disclosureText }) => {
    if (disclosureText) $('disclosure-text').textContent = disclosureText;
    $('disclosure').showModal();
  });
  transport.on('micStarted', () => { mic.dataset.state = 'listening'; });
});

$('disclosure-ok').addEventListener('click', () => {
  $('disclosure').close();
  session.transport.acknowledgeDisclosure();
});

// Mic taps are the user gesture the browser needs for audio and the mic.
mic.addEventListener('click', async () => {
  const t = session.transport;
  if (session.mode !== 'avatar') return session.switchMode('avatar');
  if (!t.micStarted) return t.startMic();
  // Toggle push-to-talk when the agent has isTapToTalk, else the mic button mutes.
  if (t.capabilities?.tapToTalk) {
    if (t.tapToTalkActive) t.endTapToTalk(); else t.startTapToTalk();
    mic.dataset.state = t.tapToTalkActive ? 'listening' : 'idle';
  } else {
    if (t.micEnabled) t.mute(); else t.unmute();
    mic.dataset.state = t.micEnabled ? 'listening' : 'idle';
  }
});

$('type').addEventListener('click', async () => {
  const text = prompt('Ask Marquee');
  if (!text) return;
  if (session.mode !== 'chat') await session.switchMode('chat');
  session.sendText(text);
});

$('bubble').addEventListener('click', () => { stage.hidden = !stage.hidden; });

session.on('warning', ({ code }) => {
  if (code === 'playback_blocked') {
    captions.textContent = 'Tap the mic to hear Marquee.';
    mic.addEventListener('click', () => session.transport.startPlayback(), { once: true });
  }
  if (code === 'mic_permission_denied') captions.textContent = 'Mic is off. Tap Type to chat instead.';
});
session.on('responsePending', () => { mic.dataset.state = 'thinking'; });
session.on('responseSettled', () => { if (mic.dataset.state === 'thinking') mic.dataset.state = 'idle'; });
session.on('avatarStartTalking', () => { mic.dataset.state = 'speaking'; stage.hidden = !$('cards').hidden; });
session.on('avatarStopTalking', () => { mic.dataset.state = 'idle'; });
session.on('transcript', ({ type, text }) => {
  if (type !== 'final' || !text || text === SILENT_OPENING_LABEL || isSilentOpening(text)) return;
  captions.textContent = text;
});
session.on('error', () => toast('Marquee hit a snag. Try again.'));

// Client tools: IDs in, page data from our Web API. Args: ARCHITECTURE.md § Tools.
session.onToolCall('show_sessions', async ({ sessionIds, title }) => {
  const data = await show('/api/sessions', { ids: sessionIds });
  if (!data) return;
  $('cards').setAttribute('aria-label', title);
  $('cards').hidden = false;
  stage.hidden = true;
});
session.onToolCall('render_schedule', ({ day, focusIds }) => show('/api/schedule', { day, focusIds }));
session.onToolCall('highlight_conflict', ({ sessionId, conflictsWith }) => show('/api/sessions', { ids: [sessionId, ...conflictsWith] }));
session.onToolCall('celebrate_action', ({ kind }) => {
  toast({ reserve: "You're in.", favorite: 'Saved.', swap: 'Swapped.' }[kind] ?? 'Done.');
  if ('vibrate' in navigator) navigator.vibrate(12);
});
session.onToolCall('show_recap', () => show('/api/schedule', { recap: true }));

countdown();
// A failed connect can't be retried on the same session. Reload builds a new one.
await session.connect().catch(() => toast("Couldn't reach Marquee. Reload to try again."));
