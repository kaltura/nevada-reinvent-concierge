/**
 * Rebuild prompts/catalog-tags.md, the search words the agent picks from.
 * ARCHITECTURE.md § Search. It reads the catalog (read only) with the sign-in
 * that `npm start` saved in NEVADA_HOME (default ~/.nevada). Needs no .env.
 *
 * Run it after AWS changes the catalog topics, tracks or levels, then push the
 * prompt with npm run update-prompts.
 *
 * Run:  npm run catalog-tags
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCatalog } from '../server/catalog.mjs';
import { makeTokenStore } from '../server/tokens.mjs';
import { withToken } from '../server/aws.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'catalog-tags.md');
// The prompt is sent on every turn. About 2,000 tokens at 3.5 characters each.
const MAX_CHARS = 7000;

const tokenStore = makeTokenStore(join(process.env.NEVADA_HOME || join(homedir(), '.nevada'), 'tokens.json'));
const catalog = makeCatalog();
const outcome = await withToken(tokenStore, (token) => catalog.sync(token));
if (!outcome.signedIn) {
  console.error('Not signed in. Run `npm start`, sign in to AWS Events, then run this again.');
  process.exit(1);
}
const { count } = outcome.result;
const tags = catalog.tags();
const summary = `${count} sessions → ${tags.split(', ').length} tags, ${tags.length} characters, about ${Math.round(tags.length / 3.5)} tokens`;
if (tags.length > MAX_CHARS) { console.error(`${summary}. Over the ${MAX_CHARS}-character budget, so nothing was written.`); process.exitCode = 1; }
else { writeFileSync(OUT, `${tags}\n`); console.log(`${summary}. Wrote prompts/catalog-tags.md.`); }
