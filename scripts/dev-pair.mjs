/**
 * Pairs a browser session without opening the connect gate first: starts
 * pairing, then launches pair/index.mjs itself so the only thing left for
 * the human to do is sign in on the AWS page it opens. No copy-pasting a
 * command into a second terminal. Only the human completes that sign-in;
 * this script never touches AWS itself.
 */
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = `http://localhost:${process.env.PORT || 8080}`;
const PAIR_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'pair', 'index.mjs');

function cookieFrom(res) {
  const setCookie = res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : null;
}

async function postJson(path, body, cookie) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { json: await res.json(), cookie: cookieFrom(res) ?? cookie };
}

const start = await postJson('/api/pair/start', {});
const { code } = start.json;
const cookie = start.cookie;

const pairing = spawn(process.execPath, [PAIR_SCRIPT, code], {
  stdio: 'inherit',
  env: { ...process.env, NEVADA_URL: BASE_URL },
});
const exitCode = await new Promise((resolve) => pairing.on('close', resolve));
if (exitCode !== 0) process.exit(exitCode);

const { json } = await postJson('/api/pair/handoff', {}, cookie);
console.log(`\nClick "Open Nevada" in the tab that just opened. To keep talking on a second device instead:\n\n  ${json.url}\n`);
