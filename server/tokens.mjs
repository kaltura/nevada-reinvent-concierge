/**
 * Encrypted-at-rest AWS token store, keyed by visitor id. AES-256-GCM with
 * TOKEN_ENC_KEY (32 bytes, base64). ARCHITECTURE.md § Pairing token rules.
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
    /** @param {string} visitor @param {{access_token,refresh_token,expires_in}} tok */
    set(visitor, tok) {
      store.set(visitor, encrypt({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
      }));
    },
    get(visitor) {
      const rec = store.get(visitor);
      return rec ? decrypt(rec) : null;
    },
    has(visitor) { return store.has(visitor); },
    delete(visitor) { store.delete(visitor); },
    size() { return store.size; },
  };
}
