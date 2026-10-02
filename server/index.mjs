#!/usr/bin/env node
/**
 * `npx nevada-reinvent`: starts the local app on 127.0.0.1 and opens the browser.
 * AWS only accepts sign-in redirects to ports 8484 to 8489, so it takes the first free one.
 * If Nevada already runs on one of them, it opens that one instead of starting a second.
 *
 * Only node: built-ins are imported statically. The rest loads after the Node
 * version check, so an old Node prints a clear message instead of a syntax error.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

const PORTS = [8484, 8485, 8486, 8487, 8488, 8489];

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 6)) {
  fail(`Nevada needs Node 20.6 or newer. You have ${process.versions.node}. Install it from https://nodejs.org and run this again.`);
}

const { createApp } = await import('./app.mjs');
const { resolveWidgetId } = await import('./widget-id.mjs');

/** Resolves once the opener has finished, so a caller that exits right after can still print its hint. */
function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  return new Promise((resolve) => {
    let done = false;
    const finish = (failed) => {
      if (done) return;
      done = true;
      if (failed) console.log('Open the link above in your browser.');
      resolve();
    };
    spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => finish(true))
      .on('exit', (code) => finish(code !== 0 && code !== null));
  });
}

/** True when Nevada answers on this port. The short timeout keeps a foreign process from hanging us. */
async function nevadaRunsOn(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok && (await res.json()).app === 'nevada-reinvent';
  } catch {
    return false;
  }
}

function nevadaHome() {
  const fromEnv = process.env.NEVADA_HOME;
  if (fromEnv) {
    if (!isAbsolute(fromEnv)) fail(`NEVADA_HOME must be an absolute path. You set "${fromEnv}".`);
    return fromEnv;
  }
  let base = '';
  try { base = homedir(); } catch { /* no home folder: reported below */ }
  if (!base) fail('Nevada could not find your home folder, so it has nowhere to save your sign-in. Set NEVADA_HOME to a folder it can use.');
  return join(base, '.nevada');
}

const widgetId = resolveWidgetId();
if (!widgetId) {
  fail('No widget id found.\n'
    + 'From a source checkout, set NEVADA_WIDGET_ID to the public widget id.\n'
    + 'If you installed from npm, the package is broken. Please report it at\n'
    + 'https://github.com/kaltura/nevada-reinvent-concierge/issues');
}
const server = createApp({ home: nevadaHome(), widgetId });
const noOpen = process.argv.includes('--no-open');

/** Resolves with the listen error, or null once the server listens. */
function tryListen(port) {
  return new Promise((resolve) => {
    server.once('error', (e) => {
      server.removeAllListeners('listening');
      resolve(e);
    });
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error');
      resolve(null);
    });
  });
}

for (const port of PORTS) {
  const err = await tryListen(port);
  const url = `http://127.0.0.1:${port}/`;
  if (!err) {
    console.log(`Nevada is running at ${url}\nPress Ctrl+C to stop.`);
    if (!noOpen) openBrowser(url);
    break;
  }
  // Windows reports a port it reserves (Hyper-V, WinNAT) as EACCES, not EADDRINUSE.
  if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') fail(`Nevada could not start: ${err.message}`);
  if (err.code === 'EADDRINUSE' && await nevadaRunsOn(port)) {
    console.log(`Nevada is already running at ${url}`);
    // Some xdg-open setups stay alive until the browser closes, so do not wait for them long.
    if (!noOpen) await Promise.race([openBrowser(url), new Promise((r) => setTimeout(r, 2000))]);
    process.exit(0);
  }
  if (port === PORTS.at(-1)) {
    fail(`Ports ${PORTS[0]} to ${port} are in use or blocked. Close whatever uses them and run this again.`);
  }
}
