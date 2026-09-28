import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { makeTokenStore } from '../tokens.mjs';

const KEY = randomBytes(32).toString('base64');

test('rejects a key that does not decode to 32 bytes', () => {
  assert.throws(() => makeTokenStore(randomBytes(16).toString('base64')));
});

test('round-trips a token through encryption', () => {
  const store = makeTokenStore(KEY);
  store.set('visitor-1', { access_token: 'a', refresh_token: 'r', expires_in: 3600 });
  const tok = store.get('visitor-1');
  assert.equal(tok.access_token, 'a');
  assert.equal(tok.refresh_token, 'r');
  assert.ok(tok.expiresAt > Date.now());
});

test('has/delete/size track visitors independently', () => {
  const store = makeTokenStore(KEY);
  assert.equal(store.has('v'), false);
  store.set('v', { access_token: 'a', refresh_token: 'r', expires_in: 60 });
  assert.equal(store.has('v'), true);
  assert.equal(store.size(), 1);
  store.delete('v');
  assert.equal(store.has('v'), false);
  assert.equal(store.size(), 0);
});

test('get returns null for an unknown visitor', () => {
  const store = makeTokenStore(KEY);
  assert.equal(store.get('nobody'), null);
});
