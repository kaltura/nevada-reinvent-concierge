/**
 * The signed-in attendee's AWS tokens, kept in one file readable only by the
 * current user (mode 0600). The app serves a single person on their own
 * machine, so there is nothing to key by. ARCHITECTURE.md § Sign-in.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export function makeTokenStore(file) {
  let record = null;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof saved?.access_token === 'string' && typeof saved.refresh_token === 'string') record = saved;
  } catch { /* first run, or an unreadable file: start signed out */ }

  // mkdir's mode only applies to a folder it creates, so check one that already exists.
  function ensurePrivateDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') return;
    const st = statSync(dir);
    if (st.uid !== process.getuid()) throw Object.assign(new Error(`${dir} belongs to another user`), { code: 'unsafe_home' });
    if (st.mode & 0o077) chmodSync(dir, 0o700);
  }

  function save(next) {
    ensurePrivateDir(dirname(file));
    // Write then rename, so a crash never leaves half a token file behind.
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }
  }

  return {
    /** @returns {{access_token:string,refresh_token:string,expiresAt:number}|null} */
    get() { return record; },
    /** @param {{access_token:string,refresh_token:string,expires_in:number}} tok */
    set(tok) {
      const next = { access_token: tok.access_token, refresh_token: tok.refresh_token, expiresAt: Date.now() + tok.expires_in * 1000 };
      save(next);
      record = next; // only after the write worked, so a failed save never looks signed in
    },
    clear() {
      record = null;
      rmSync(file, { force: true });
    },
  };
}
