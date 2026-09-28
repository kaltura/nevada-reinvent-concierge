/**
 * Push edited prompts/*.md files to the already-live intellect.
 * provision.mjs only creates; capabilities are cached for ~24h so those still
 * need a fresh create, but prompt text has no such cache and setPrompts is a
 * read-merge-write, so this is safe to run any time after an edit.
 *
 * Run:  npm run update-prompts
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Management } from '@kaltura/intelligent-agents/management';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_JSON = join(ROOT, 'server', 'agent.json');
const PERSONA_NAME = 'Nevada';

const { KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET } = process.env;
const missing = Object.entries({ KALTURA_PARTNER_ID, KALTURA_ADMIN_SECRET }).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) { console.error(`Set ${missing.join(', ')} in .env`); process.exit(2); }
if (!existsSync(AGENT_JSON)) { console.error(`${AGENT_JSON} missing. Run npm run provision first.`); process.exit(2); }

const { configId } = JSON.parse(readFileSync(AGENT_JSON, 'utf8'));
const kaltura = new Management({ partnerId: Number(KALTURA_PARTNER_ID), adminSecret: KALTURA_ADMIN_SECRET });

function prompt(key, headerTemplate, value) { return { key, label: key, headerTemplate, type: 'custom', value }; }
const readPrompt = (name) => readFileSync(join(ROOT, 'prompts', `${name}.md`), 'utf8').trim();

// Same blocks and order as provision.mjs § intellectBody.prompts.
const prompts = [
  prompt('name', 'Your name is:', PERSONA_NAME),
  prompt('targetAudience', 'Adjust your vocabulary and depth to the following group of people:', readPrompt('target-audience')),
  prompt('eventFacts', 'Facts about the event itself, not from the session catalog:', readPrompt('event-facts')),
  prompt('restrictedTopics', 'Never discuss these topics. Steer back to planning in one sentence:', readPrompt('restricted-topics')),
  prompt('goal', 'Your success is measured by this goal:', readPrompt('goal')),
  prompt('obeyRules', 'Rules you must obey without exception:', readPrompt('rules')),
  prompt('screen', 'What the attendee has on screen right now, as JSON with view, day, visible session IDs in order and the focused one:', '{{ page_context }}'),
];

const admin = await kaltura.sessions.createAdminToken();
const { lint } = await kaltura.intellects.setPrompts(configId, prompts, admin, {
  knownVars: ['returning', 'page_context', 'paired'],
});
if (lint.findings.length) console.warn('⚠ prompt lint:', JSON.stringify(lint.findings));
else console.log('✓ prompt lint clean');
console.log('✅ pushed prompts/*.md to intellect', configId);
