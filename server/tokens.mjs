/**
 * The signed-in attendee's AWS tokens, kept in one file readable only by the
 * current user (mode 0600). The app serves a single person on their own
 * machine, so there is nothing to key by. ARCHITECTURE.md § Sign-in.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeTokenStore(file) {
  let record = null;
  try { record = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run, or an unreadable file: start signed out */ }

  function save() {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // Write then rename, so a crash never leaves half a token file behind.
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  }

  return {
    /** @returns {{access_token:string,refresh_token:string,expiresAt:number}|null} */
    get() { return record; },
    /** @param {{access_token:string,refresh_token:string,expires_in:number}} tok */
    set(tok) {
      record = { access_token: tok.access_token, refresh_token: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000 };
      save();
    },
    clear() {
      record = null;
      rmSync(file, { force: true });
    },
  };
}
