/**
 * AWS token store, keyed by visitor id, encrypted with AES-256-GCM using
 * TOKEN_ENC_KEY (32 bytes, base64). "At rest" means in this process's memory
 * only: the key lives in the same process. ARCHITECTURE.md § Pairing.
 */
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';

export function makeTokenStore(encKeyBase64) {
  const key = Buffer.from(encKeyBase64, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENC_KEY must decode to 32 bytes');
  const store = new Map(); // visitor -> { iv, tag, data } (all base64)

  function encrypt(obj) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(obj)), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function decrypt(rec) {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(rec.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(rec.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(rec.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString());
  }

  return {
    /** @param {string} visitor @param {{access_token,refresh_token,expires_in,pairingId?,userId?}} tok */
    set(visitor, tok) {
      store.set(visitor, encrypt({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
        // Shared by every visitor id that came from the same pairing (the
        // original device plus any phone handoff copies), so Disconnect can
        // find and remove all of them, not just the caller's own copy.
        pairingId: tok.pairingId,
        // The attendee's Kaltura userId, a pseudonym. server/index.mjs § kalturaUserId.
        userId: tok.userId,
        lastUsed: Date.now(),
      }));
    },
    get(visitor) {
      const rec = store.get(visitor);
      return rec ? decrypt(rec) : null;
    },
    /** Marks a record as still in use, so `sweep` doesn't drop it as idle. */
    touch(visitor) {
      const rec = store.get(visitor);
      if (!rec) return;
      store.set(visitor, encrypt({ ...decrypt(rec), lastUsed: Date.now() }));
    },
    has(visitor) { return store.has(visitor); },
    delete(visitor) { store.delete(visitor); },
    /** Deletes every record sharing `pairingId`: the original device plus
     * any phone-handoff copies. Disconnect uses this so it drops a whole
     * pairing, not just the caller's own copy of it. */
    deleteGroup(pairingId) {
      for (const [visitor, rec] of store) if (decrypt(rec).pairingId === pairingId) store.delete(visitor);
    },
    size() { return store.size; },
    /** Drops any record untouched for longer than `maxIdleMs`, so an
     * attendee who never disconnects doesn't hold a slot forever. */
    sweep(maxIdleMs) {
      const now = Date.now();
      for (const [visitor, rec] of store) if (now - decrypt(rec).lastUsed > maxIdleMs) store.delete(visitor);
    },
  };
}
