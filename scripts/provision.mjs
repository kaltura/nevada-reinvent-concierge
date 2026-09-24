/**
 * Provision Marquee's one shared Kaltura agent: tools, intellect, avatar,
 * agent and widget. Design: ARCHITECTURE.md § Agent configuration and § Tools.
 *
 * Run once per environment:  npm run provision
 *   → writes server/agent.json { configId, avatarId, agentId, widgetId, tag, toolIds }
 *
 * Capabilities are cached for about 24 hours, so this script creates and
 * never updates. If server/agent.json exists it stops. Tools are upserted by
 * name, so use a Kaltura partner dedicated to Marquee.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  Management, SILENT_OPENING, tools, lintPrompts, lintPersonaIdentity,
} from '@kaltura/intelligent-agents/management';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'server', 'agent.json');

const TAG = 'marquee';
const DISPLAY_NAME = 'Marquee';
const PERSONA_NAME = 'Marquee';
// Rendered on every avatar join, including switchMode. `returning` is a request
// variable the page sets on return from the background and clears with ''.
const OPENING_PHRASE =
  `{%- if returning -%}Welcome back.` +
  `{%- elif sys__is_new_thread -%}Hi, I'm ${PERSONA_NAME}. What are you here for?` +
  `{%- else -%}${SILENT_OPENING}{%- endif -%}`;

const {
  KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET, PUBLIC_BASE_URL, PROXY_KEY,
  KALTURA_VISUAL_ID, KALTURA_VOICE_ID,
} = process.env;
const missing = Object.entries({
  KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET, PUBLIC_BASE_URL, PROXY_KEY, KALTURA_VISUAL_ID, KALTURA_VOICE_ID,
}).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Set ${missing.join(', ')} in .env`); process.exit(2); }
if (existsSync(OUT)) { console.error(`${OUT} exists. Marquee is already provisioned.`); process.exit(2); }

const kaltura = new Management({ partnerId: Number(KALTURA_PARTNER_ID), adminSecret: KALTURA_ADMIN_SECRET });

function prompt(key, headerTemplate, value) { return { key, label: key, headerTemplate, type: 'custom', value }; }
const readPrompt = (name) => readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8').trim();

const str = (p, required = true) => ({ prompt: p, type: 'str', required });
const list = (p) => ({ prompt: p, type: 'list', required: true });
const DAY = str('Event day, e.g. "tuesday". Omit for the whole week.', false);

// Server tools. Each is one POST to our proxy, which answers {answer: "<short text>"}.
const API_TOOLS = [
  ['search_sessions', 'Find sessions in the catalog. Returns the top 5 with IDs. Works before the account is connected.', {
    query: str('What the attendee is looking for, in their words'),
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
].map(([name, description, args]) => tools.api({
  name,
  description,
  args,
  request: {
    url: `${PUBLIC_BASE_URL}/tools/${name}`,
    method: 'POST',
    timeout: 8,
    headers: {
      'X-Proxy-Key': '{{secrets.PROXY_KEY}}',
      'X-Session-Ref': '{{ session_ref }}',
      'X-Thread': '{{ sys__thread_id }}',
    },
    body: Object.fromEntries(Object.keys(args).map((a) => [a, `{{args.${a}}}`])),
  },
  responseTemplate: '{answer}',
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
  // session_ref and returning are request variables. Without this they fail silently.
  allow_client_variables: true,
  base_directive: readPrompt('base-directive'),
  opening_phrase: OPENING_PHRASE,
  prompts: [
    prompt('name', 'Your name is:', PERSONA_NAME),
    prompt('targetAudience', 'Adjust your vocabulary and depth to the following group of people:', readPrompt('target-audience')),
    prompt('restrictedTopics', 'Never discuss these topics. Steer back to planning in one sentence:', readPrompt('restricted-topics')),
    prompt('goal', 'Your success is measured by this goal:', readPrompt('goal')),
    prompt('obeyRules', 'Rules you must obey without exception:', readPrompt('rules')),
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
  ['prompt', lintPrompts(intellectBody.prompts, { allowClientVariables: true, knownVars: ['session_ref', 'returning'] })],
]) {
  if (findings.length) console.warn(`⚠ ${label} lint:`, JSON.stringify(findings));
  else console.log(`✓ ${label} lint clean`);
}

const intellect = await kaltura.intellects.create(intellectBody, admin);
const { configId } = intellect;
if (!configId) throw new Error(`intellects.create returned no configId: ${JSON.stringify(intellect.raw)}`);
for (const w of intellect.warnings ?? []) console.warn('⚠', w);
console.log('✓ created intellect', configId);

await kaltura.intellects.secrets.set(configId, { PROXY_KEY }, admin);
const refs = await kaltura.intellects.secrets.validate(configId, admin);
if (!refs.ok) console.warn('⚠ secret refs:', JSON.stringify({ unresolved: refs.unresolved, badPrefix: refs.badPrefix }));
else console.log('✓ secrets resolve');

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
  widgetConfig: { initialPage: { title: 'Plan your week with Marquee' }, layouts: { avatar: true, chat: true } },
}, admin);
console.log('✓ created agent', agentId);

const { widgetId } = await kaltura.application.resolveWidgetId(agentId, admin);
const out = { configId, avatarId: avatar.id, agentId, widgetId, tag: TAG, toolIds };
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('✅ wrote', OUT);
