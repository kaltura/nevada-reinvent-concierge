/**
 * Provision Nevada's one shared Kaltura agent: tools, intellect, avatar,
 * agent and widget. Design: ARCHITECTURE.md § Agent configuration and § Tools.
 *
 * Run once per environment:  npm run provision
 *   → writes server/agent.json { configId, avatarId, agentId, widgetId, tag, toolIds }
 *
 * Capabilities are cached for about 24 hours, so this script creates and
 * never updates. If server/agent.json exists it stops. Tools are upserted by
 * name, so use a Kaltura partner dedicated to Nevada.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Management, SILENT_OPENING, tools, lintPrompts, lintPersonaIdentity,
} from '@kaltura/intelligent-agents/management';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'server', 'agent.json');

const TAG = 'nevada';
const DISPLAY_NAME = 'Nevada';
const PERSONA_NAME = 'Nevada';
// Rendered on every avatar join, including switchMode. `returning`, `paired`
// and `topInterest` are request variables the page sets: `returning` on
// return from the background (cleared with ''), `paired` from the AWS Events
// pairing state, `topInterest` from the attendee's own top topic across what
// they've already reserved or favorited (server/catalog.mjs's topTopic), '' if none.
const OPENING_PHRASE =
  `{%- if returning -%}Welcome back.` +
  `{%- elif not paired -%}Hi, I'm ${PERSONA_NAME}. Connect your AWS Events account and I'll build your plan for the week.` +
  `{%- elif sys__is_new_thread -%}Hi, I'm ${PERSONA_NAME}.` +
  `{%- if topInterest -%} I noticed you've been favoriting {{ topInterest }} sessions, so I've lined up more like that for the week. Tell me if you'd rather go a different direction.` +
  `{%- else -%} I've picked a few sessions for each day to get you started. Tell me if you're deep into a track like agentic AI or serverless, and I'll build around that instead.{%- endif -%}` +
  `{%- else -%}${SILENT_OPENING}{%- endif -%}`;

const {
  KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET, KALTURA_VISUAL_ID, KALTURA_VOICE_ID,
} = process.env;
const missing = Object.entries({
  KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET, KALTURA_VISUAL_ID, KALTURA_VOICE_ID,
}).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Set ${missing.join(', ')} in .env`); process.exit(2); }
if (existsSync(OUT)) { console.error(`${OUT} exists. Nevada is already provisioned.`); process.exit(2); }

const kaltura = new Management({ partnerId: Number(KALTURA_PARTNER_ID), adminSecret: KALTURA_ADMIN_SECRET });

function prompt(key, headerTemplate, value) { return { key, label: key, headerTemplate, type: 'custom', value }; }
const readPrompt = (name) => readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8').trim();

const str = (p, required = true) => ({ prompt: p, type: 'str', required });
const list = (p) => ({ prompt: p, type: 'list', required: true });
const DAY = str('Event day, e.g. "tuesday". Omit for the whole week.', false);

// Proxy tools. The LLM's call reaches our own page (a native `client` tool,
// never a server-side webhook), which POSTs same-origin to our proxy and
// ACKs back {answer: "<short text>"} via respondToTool. This is what makes
// Phase 1 work on localhost with no public reachability: the browser calling
// our own server always works; Kaltura's cloud calling our server does not.
// client/app.js § SERVER_TOOLS; ARCHITECTURE.md § Tools.
const API_TOOLS = [
  ['get_topics', 'The most common topics/tracks in the catalog right now. Call this for "what topics/tracks are available" instead of guessing. Works before the account is connected.', {}],
  ['search_sessions', 'Find sessions in the catalog. Returns the top 5 with IDs. Works before the account is connected.', {
    query: str('Topic or keywords only, e.g. "serverless" or "kubernetes at scale". Leave out entirely for a request that is only about day, time, venue or level — use day/from/to/venue/level for those, never put a time-of-day word like "morning" or "afternoon" here', false),
    day: DAY,
    from: str('Earliest start, local time "HH:MM"', false),
    to: str('Latest end, local time "HH:MM"', false),
    venue: str('Venue code: MGM, WYN, VEN, ENC, CPL or CFM', false),
    level: str('100, 200, 300 or 400', false),
    mode: str('"wildcard" for one pick far from their usual topics that still fits', false),
  }],
  ['get_session', 'Details for one session: time, venue, level, seats, repeats and walk-up.', {
    sessionId: str('Session ID from an earlier tool result'),
  }],
  ['get_my_schedule', "The attendee's reserved sessions, favorites and personal time, with gaps and travel warnings.", {
    day: DAY,
  }],
  ['favorite_sessions', 'Add up to 10 sessions to favorites. Only after a clear yes.', {
    ids: list('Session IDs'),
  }],
  ['unfavorite_session', 'Remove one session from favorites. Only after a clear yes.', {
    id: str('Session ID'),
  }],
  ['reserve_sessions', 'Reserve seats. Only after a clear yes. On a clash it returns conflictsWith and swap options.', {
    ids: list('Session IDs'),
  }],
  ['cancel_reservation', 'Give up a reserved seat. Only after a clear yes.', {
    id: str('Session ID'),
  }],
  ['swap_reservation', 'Cancel dropId, then reserve addId. If the reserve fails it tries to get dropId back. Warn the attendee first when addId is not available.', {
    dropId: str('Reserved session ID to give up'),
    addId: str('Session ID to reserve'),
  }],
  ['add_personal_time', 'Block personal time, e.g. lunch or a meeting.', {
    title: str('Short label'),
    description: str('One line on what it is, e.g. "Lunch with the team"'),
    day: str('Event day, e.g. "tuesday"'),
    start: str('Local start time "HH:MM"'),
    end: str('Local end time "HH:MM"'),
  }],
  ['update_personal_time', 'Change a personal time block.', {
    id: str('Personal time ID from get_my_schedule'),
    title: str('Short label', false),
    description: str('One line on what it is', false),
    day: str('Event day', false),
    start: str('Local start time "HH:MM"', false),
    end: str('Local end time "HH:MM"', false),
  }],
  ['delete_personal_time', 'Remove a personal time block. Only after a clear yes.', {
    id: str('Personal time ID from get_my_schedule'),
  }],
].map(([name, description, args]) => tools.client({
  name, description, args, waitForResponse: true, timeout: 15,
}));

const ONCE = 'Call once, then speak, never retry.';
const CLIENT_TOOLS = [
  ['show_sessions', `Show session cards on the screen. ${ONCE}`, {
    sessionIds: list('Session IDs from a tool result'),
    title: str('Short heading, e.g. "Tuesday afternoon"'),
  }],
  ['render_schedule', `Redraw the schedule on the screen. ${ONCE}`, {
    day: DAY,
    focusIds: { prompt: 'Session IDs to highlight', type: 'list', required: false },
  }],
  ['highlight_conflict', `Show the clash sheet with swap options from reserve_sessions. ${ONCE}`, {
    sessionId: str('Session the attendee asked for'),
    conflictsWith: list('Clashing session IDs'),
    options: { prompt: 'Options exactly as reserve_sessions returned them', type: 'list', required: true },
  }],
  ['celebrate_action', `Play a short success moment after a booking change worked. ${ONCE}`, {
    kind: str('reserve, favorite or swap'),
  }],
  ['show_recap', `Show the attendee's week recap card. ${ONCE}`, {}],
  ['point_at', `Light up one session that is already on the screen while you talk about it. ${ONCE}`, {
    sessionId: str('A session ID from the screen context'),
  }],
].map(([name, description, args]) => tools.client({ name, description, args, waitForResponse: false }));

async function upsertTool(admin, config, existing) {
  const found = existing.find((t) => t.name === config.name);
  if (found) {
    await kaltura.tools.update(found.id, { config }, admin);
    console.log('✓ updated tool', config.name, found.id);
    return found.id;
  }
  const created = await kaltura.tools.add(config, admin);
  console.log('✓ created tool', config.name, created.id);
  return created.id;
}

const admin = await kaltura.sessions.createAdminToken();
const existingTools = await kaltura.tools.list(admin).all();
const toolIds = {};
for (const t of [...API_TOOLS, ...CLIENT_TOOLS]) toolIds[t.name] = await upsertTool(admin, t, existingTools);

const intellectBody = {
  tool_ids: Object.values(toolIds),
  // returning and page_context are request variables. Without this they fail silently.
  allow_client_variables: true,
  base_directive: readPrompt('base-directive'),
  opening_phrase: OPENING_PHRASE,
  prompts: [
    prompt('name', 'Your name is:', PERSONA_NAME),
    prompt('targetAudience', 'Adjust your vocabulary and depth to the following group of people:', readPrompt('target-audience')),
    prompt('eventFacts', 'Facts about the event itself, not from the session catalog:', readPrompt('event-facts')),
    prompt('restrictedTopics', 'Never discuss these topics. Steer back to planning in one sentence:', readPrompt('restricted-topics')),
    prompt('goal', 'Your success is measured by this goal:', readPrompt('goal')),
    prompt('obeyRules', 'Rules you must obey without exception:', readPrompt('rules')),
    // The page fills page_context through setDynamicPrompt. ARCHITECTURE.md § Runtime.
    prompt('screen', 'What the attendee has on screen right now, as JSON with view, day, visible session IDs in order and the focused one:', '{{ page_context }}'),
  ],
  // All 16 capabilities, set once at create. Reasons: ARCHITECTURE.md § Agent configuration.
  capabilities: {
    avatar: 'on',
    avatar_filler: 'off',
    generate_followup_questions: 'on',
    include_sources: 'off',
    kaltura_genie_experiences: 'off',
    use_knowledge_base: 'off',
    use_content_search: 'disabled',
    use_get_entry_content: 'disabled',
    use_related_files: 'disabled',
    use_web_search: 'disabled',
    video_gallery: 'disabled',
    external_video: 'disabled',
    show_link: 'disabled',
    avatar_show_content: 'disabled',
    screen_share_analysis: 'disabled',
    think_process: 'disabled',
  },
};

for (const [label, { findings }] of [
  ['persona', lintPersonaIdentity({ name: PERSONA_NAME, openingPhrase: OPENING_PHRASE, baseDirective: intellectBody.base_directive, prompts: intellectBody.prompts })],
  ['prompt', lintPrompts(intellectBody.prompts, { allowClientVariables: true, knownVars: ['returning', 'page_context', 'paired'] })],
]) {
  if (findings.length) console.warn(`⚠ ${label} lint:`, JSON.stringify(findings));
  else console.log(`✓ ${label} lint clean`);
}

const intellect = await kaltura.intellects.create(intellectBody, admin);
const { configId } = intellect;
if (!configId) throw new Error(`intellects.create returned no configId: ${JSON.stringify(intellect.raw)}`);
for (const w of intellect.warnings ?? []) console.warn('⚠', w);
console.log('✓ created intellect', configId);

// No openingPhrase on the avatar: the intellect's opening_phrase owns the first line.
const avatar = await kaltura.avatars.create({
  voice: { id: KALTURA_VOICE_ID, speed: 1.0 },
  visual: { id: KALTURA_VISUAL_ID, motionControl: { speaking: 0.6, nonSpeaking: 0.2 } },
}, admin);
console.log('✓ created avatar', avatar.id);

const { agentId } = await kaltura.agents.create({
  displayName: DISPLAY_NAME,
  intellect: { intellectType: 'genie', id: configId },
  avatarIds: [avatar.id],
  adminTags: [TAG],
  maxConversationLength: 900,
  widgetConfig: { initialPage: { title: 'Plan your week with Nevada' }, layouts: { avatar: true, chat: true } },
}, admin);
console.log('✓ created agent', agentId);

const { widgetId } = await kaltura.application.resolveWidgetId(agentId, admin);
const out = { configId, avatarId: avatar.id, agentId, widgetId, tag: TAG, toolIds };
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('✅ wrote', OUT);
