#!/usr/bin/env node
/**
 * nevada-pair CODE: connect an AWS Events account to Nevada.
 * Flow and rules: ARCHITECTURE.md § Pairing. OAuth facts: AWS-EVENTS-INTEGRATION.md § Authentication.
 *
 * Talks only to oauth.awsevents.com and NEVADA_URL. Stores nothing on disk
 * and prints nothing secret. No dependencies.
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const AUTHORIZE = 'https://oauth.awsevents.com/oauth2/authorize';
const TOKEN = 'https://oauth.awsevents.com/oauth2/token';
const CLIENT_ID = '7vmom55m1qstvq8i71ph127bfq';
const SCOPE = 'openid email events/access';
const PORTS = [8484, 8485, 8486, 8487, 8488, 8489];
// 127.0.0.1, not localhost: localhost can resolve to ::1 while we listen on IPv4.
const HOST = '127.0.0.1';
const TIMEOUT_MS = 5 * 60 * 1000;
const NEVADA_URL = (process.env.NEVADA_URL || 'https://nevada.example.com').replace(/\/$/, '');

const fail = (msg) => { console.error(`nevada-pair: ${msg}`); process.exit(1); };
const b64url = (buf) => buf.toString('base64url');

const code = (process.argv[2] || '').replace(/[\s-]/g, '').toUpperCase();
if (!/^[A-Z0-9]{6}$/.test(code)) fail('usage: npx nevada-pair CODE (the 6-character code on your phone)');
const target = new URL(NEVADA_URL);
if (target.protocol !== 'https:' && target.hostname !== 'localhost' && target.hostname !== HOST) fail('NEVADA_URL must use https');

const verifier = b64url(randomBytes(64)); // 86 characters, inside the 43 to 128 range
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(24));

function listen(ports) {
  return new Promise((resolve, reject) => {
    const [port, ...rest] = ports;
    if (port === undefined) return reject(new Error('ports 8484 to 8489 are all busy. Close what uses them and try again.'));
    const server = createServer();
    server.once('error', (e) => (e.code === 'EADDRINUSE' ? listen(rest).then(resolve, reject) : reject(e)));
    server.listen(port, HOST, () => resolve({ server, port }));
  });
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">` +
  `<div><h1>${title}</h1><p>${body}</p><p style="font-size:12px;color:#ccc">For AWS re:Invent attendees. Not affiliated with or endorsed by AWS.</p></div>`;

const { server, port } = await listen(PORTS).catch((e) => fail(e.message));
// Sent byte-for-byte the same to authorize and to the token exchange.
const redirectUri = `http://${HOST}:${port}/callback`;

const authCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('sign-in timed out after 5 minutes. Run the command again.')), TIMEOUT_MS);
  server.on('request', (req, res) => {
    const url = new URL(req.url, redirectUri);
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const done = (ok, msg) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(page(ok ? 'Almost there' : 'Sign-in failed', msg));
      clearTimeout(timer);
    };
    if (url.searchParams.get('state') !== state) { done(false, 'This sign-in did not start here. Run the command again.'); reject(new Error('state mismatch')); return; }
    const err = url.searchParams.get('error');
    if (err) { done(false, 'AWS did not sign you in. Run the command again.'); reject(new Error(`AWS returned ${err}`)); return; }
    const c = url.searchParams.get('code');
    if (!c) { done(false, 'AWS sent no code. Run the command again.'); reject(new Error('no code in callback')); return; }
    done(true, 'You can close this tab and go back to your phone.');
    resolve(c);
  });

  const auth = new URL(AUTHORIZE);
  auth.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope: SCOPE,
    identity_provider: 'AWSBuilderID', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log('Opening the AWS sign-in page. If it does not open, paste this into your browser:');
  console.log(auth.href);
  openBrowser(auth.href);
}).catch((e) => { server.close(); fail(e.message); });
server.close();

const tokenRes = await fetch(TOKEN, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: redirectUri, code: authCode, code_verifier: verifier }),
});
if (!tokenRes.ok) fail(`AWS refused the sign-in code (HTTP ${tokenRes.status}). Run the command again.`);
const { access_token, refresh_token, expires_in } = await tokenRes.json();
if (!access_token || !refresh_token) fail('AWS sent no tokens. Run the command again.');

const handoff = await fetch(`${NEVADA_URL}/api/pair/complete`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, access_token, refresh_token, expires_in }),
});
if (handoff.status === 404 || handoff.status === 410) fail('that code has expired. Get a new one on your phone.');
if (!handoff.ok) fail(`Nevada could not save the connection (HTTP ${handoff.status}). Try again.`);
console.log('Connected. Go back to your phone.');
