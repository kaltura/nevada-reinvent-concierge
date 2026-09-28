#!/usr/bin/env node
/**
 * nevada-pair CODE: connect an AWS Events account to Nevada.
 * Flow and rules: ARCHITECTURE.md § Pairing. OAuth facts: AWS-EVENTS-INTEGRATION.md § Authentication.
 *
 * Talks only to oauth.awsevents.com and NEVADA_URL. Stores nothing on disk
 * and prints nothing secret. No dependencies besides the vendored
 * qrcode.cjs (same file, same pinned version, already trusted in
 * client/index.html's SRI hash, so it is not a new thing to trust).
 */
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import qrcode from './qrcode.cjs';

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
if (!/^[A-Z0-9]{6}$/.test(code)) fail('usage: npx nevada-pair CODE (the 6-character code Nevada showed you)');
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
  `<body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px;box-sizing:border-box">` +
  `<div style="max-width:360px"><h1>${title}</h1><p>${body}</p><p style="font-size:12px;color:#ccc">For AWS re:Invent attendees. Not affiliated with or endorsed by AWS.</p></div>`;

// Two separate single-use links (server/index.mjs § /api/pair/complete), so
// clicking the button and scanning the QR each work on their own. Neither
// one uses up the other. No raw AWS token is ever in this page or either
// URL: both carry only an opaque handoff token the backend already holds
// tokens for. AWS-EVENTS-INTEGRATION.md § Authentication.
// Trusts only a handoff link on NEVADA_URL's own origin and root path.
// Rebuilding the href from the validated token (never the raw string from
// the response) stops a spoofed or MITM'd server from injecting HTML or
// pointing "Open Nevada" at a phishing page.
function handoffHref(urlStr) {
  const u = new URL(urlStr);
  const handoff = u.searchParams.get('handoff');
  if (u.origin !== target.origin || u.pathname !== '/' || !handoff) throw new Error('bad handoff URL');
  return `${target.origin}/?handoff=${encodeURIComponent(handoff)}`;
}

const successPage = (openHref, qrHref) => {
  const qr = qrcode(0, 'M');
  qr.addData(qrHref);
  qr.make();
  return `<!doctype html><meta charset="utf-8"><title>Connected</title>` +
    `<body style="font:16px system-ui;background:#121212;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:16px;box-sizing:border-box">` +
    `<div style="max-width:360px"><h1>Connected</h1>` +
    `<p>Open Nevada here, or scan the code below with your phone.</p>` +
    `<a href="${openHref}" style="display:block;margin:20px 0;padding:14px;border-radius:10px;background:#fff;color:#121212;text-decoration:none;font-weight:600">Open Nevada</a>` +
    `<div style="background:#fff;padding:8px;border-radius:8px;display:inline-block">${qr.createSvgTag(6, 8)}</div>` +
    `<p style="font-size:12px;color:#ccc;margin-top:24px">For AWS re:Invent attendees. Not affiliated with or endorsed by AWS.</p></div>`;
};

const { server, port } = await listen(PORTS).catch((e) => fail(e.message));
// Sent byte-for-byte the same to authorize and to the token exchange.
const redirectUri = `http://${HOST}:${port}/callback`;

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('sign-in timed out after 5 minutes. Run the command again.')), TIMEOUT_MS);
  server.on('request', async (req, res) => {
    const url = new URL(req.url, redirectUri);
    if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
    const done = (ok, msg) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(page(ok ? 'Connected' : 'Sign-in failed', msg));
      clearTimeout(timer);
    };
    const doneSuccess = (openUrl, qrUrl) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(successPage(openUrl, qrUrl));
      clearTimeout(timer);
    };
    // A wrong state can come from any local process hitting this port, not
    // just the real AWS redirect. Answer it and keep waiting for the real
    // callback instead of aborting the whole sign-in.
    if (url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(page('Sign-in failed', 'This request did not start here.'));
      return;
    }
    const err = url.searchParams.get('error');
    if (err) { done(false, 'AWS did not sign you in. Run the command again.'); reject(new Error(`AWS returned ${err}`)); return; }
    const authCode = url.searchParams.get('code');
    if (!authCode) { done(false, 'AWS sent no code. Run the command again.'); reject(new Error('no code in callback')); return; }

    const tokenRes = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: redirectUri, code: authCode, code_verifier: verifier }),
    }).catch(() => null);
    if (!tokenRes || !tokenRes.ok) { done(false, `AWS refused the sign-in code${tokenRes ? ` (HTTP ${tokenRes.status})` : ''}. Run the command again.`); reject(new Error('token exchange failed')); return; }
    const { access_token, refresh_token, expires_in } = await tokenRes.json();
    if (!access_token || !refresh_token) { done(false, 'AWS sent no tokens. Run the command again.'); reject(new Error('no tokens in response')); return; }

    const complete = await fetch(`${NEVADA_URL}/api/pair/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, access_token, refresh_token, expires_in }),
    }).catch(() => null);
    if (complete && (complete.status === 404 || complete.status === 410)) { done(false, 'That code expired. Get a new one and run the command again.'); reject(new Error('pair code expired')); return; }
    if (!complete || !complete.ok) { done(false, `Nevada could not save the connection${complete ? ` (HTTP ${complete.status})` : ''}. Try again.`); reject(new Error('pair/complete failed')); return; }
    const { handoffUrl, qrUrl } = await complete.json().catch(() => ({}));
    // A busy server pairs the tab but sends no handoff links.
    if (handoffUrl === null && qrUrl === null) {
      done(true, 'Go back to the Nevada tab. It will open by itself.');
      resolve();
      return;
    }
    let openHref, qrHref;
    try {
      openHref = handoffHref(handoffUrl);
      qrHref = handoffHref(qrUrl);
    } catch {
      done(false, 'Nevada did not send a way to continue. Try again.');
      reject(new Error('missing or invalid handoff urls'));
      return;
    }

    doneSuccess(openHref, qrHref);
    resolve();
  });

  const auth = new URL(AUTHORIZE);
  auth.search = new URLSearchParams({
    response_type: 'code', client_id: CLIENT_ID, redirect_uri: redirectUri, scope: SCOPE,
    identity_provider: 'AWSBuilderID', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  console.log(`Connecting code ${code} to ${target.host}.`);
  console.log('Opening the AWS sign-in page. If it does not open, paste this into your browser:');
  console.log(auth.href);
  openBrowser(auth.href);
}).catch((e) => { server.close(); fail(e.message); });
server.close();
console.log('Connected.');
