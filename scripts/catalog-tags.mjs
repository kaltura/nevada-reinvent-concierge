/**
 * Rebuild prompts/catalog-tags.md, the search words the agent picks from.
 * ARCHITECTURE.md § Search. You sign in to AWS once, through the pairing
 * helper; the script downloads the catalog (read only), writes the file and
 * revokes the sign-in. Needs no .env and no running server.
 *
 * Run it when the server logs that the catalog tags changed, then push the
 * prompt with npm run update-prompts.
 *
 * Run:  npm run catalog-tags
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeCatalog } from '../server/catalog.mjs';
import { revokeRefreshToken } from '../server/aws.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'prompts', 'catalog-tags.md');
// The prompt is sent on every turn. About 2,000 tokens at 3.5 characters each.
const MAX_CHARS = 7000;

// Stands in for Nevada's two pairing routes, so the helper hands its tokens here.
const code = randomBytes(3).toString('hex').toUpperCase();
let tokens;
const server = createServer(async (req, res) => {
  if (req.url === `/api/pair/check/${code}`) return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"state":"waiting"}');
  if (req.url === '/api/pair/complete' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    tokens = JSON.parse(body);
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"handoffUrl":null,"qrUrl":null}');
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const helper = spawn(process.execPath, [join(ROOT, 'pair', 'index.mjs'), code, `http://127.0.0.1:${server.address().port}`], { stdio: 'inherit' });
const exitCode = await new Promise((resolve) => helper.on('close', resolve));
server.close();
if (exitCode !== 0 || !tokens) process.exit(exitCode || 1);

const catalog = makeCatalog();
try {
  const { count } = await catalog.sync(tokens.access_token);
  const tags = catalog.tags();
  const summary = `${count} sessions → ${tags.split(', ').length} tags, ${tags.length} characters, about ${Math.round(tags.length / 3.5)} tokens`;
  if (tags.length > MAX_CHARS) { console.error(`${summary}. Over the ${MAX_CHARS}-character budget, so nothing was written.`); process.exitCode = 1; }
  else { writeFileSync(OUT, `${tags}\n`); console.log(`${summary}. Wrote prompts/catalog-tags.md.`); }
} finally {
  await revokeRefreshToken(tokens.refresh_token);
}
