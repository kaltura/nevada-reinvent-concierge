#!/usr/bin/env node
/**
 * `npx nevada-reinvent`: starts the local app on 127.0.0.1 and opens the browser.
 * AWS only accepts sign-in redirects to ports 8484 to 8489, so it takes the first free one.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { resolveWidgetId } from './widget-id.mjs';

const PORTS = [8484, 8485, 8486, 8487, 8488, 8489];

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

const widgetId = resolveWidgetId();
if (!widgetId) {
  console.error('No widget id found. Reinstall the package, or set NEVADA_WIDGET_ID.');
  process.exit(1);
}
const server = createApp({ home: process.env.NEVADA_HOME || join(homedir(), '.nevada'), widgetId });

function listen(i) {
  if (i >= PORTS.length) {
    console.error(`Ports ${PORTS[0]} to ${PORTS.at(-1)} are all busy. Close whatever uses them and run this again.`);
    process.exit(1);
  }
  server.once('error', (e) => {
    if (e.code !== 'EADDRINUSE') throw e;
    server.removeAllListeners('listening');
    listen(i + 1);
  });
  server.once('listening', () => {
    server.removeAllListeners('error');
    const url = `http://127.0.0.1:${PORTS[i]}/`;
    console.log(`Nevada is running at ${url}\nPress Ctrl+C to stop.`);
    if (!process.argv.includes('--no-open')) openBrowser(url);
  });
  server.listen(PORTS[i], '127.0.0.1');
}
listen(0);
