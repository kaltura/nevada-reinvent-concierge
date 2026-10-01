import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTokenStore } from '../tokens.mjs';

function tempFile(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nevada-tokens-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'home', 'tokens.json');
}

test('starts signed out when there is no file', (t) => {
  assert.equal(makeTokenStore(tempFile(t)).get(), null);
});

test('set stores the tokens and an absolute expiry', (t) => {
  const store = makeTokenStore(tempFile(t));
  store.set({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
  const tok = store.get();
  assert.deepEqual([tok.access_token, tok.refresh_token, tok.expiresAt > Date.now()], ['a', 'r', true]);
});

test('a new store reads back what the last one saved', (t) => {
  const file = tempFile(t);
  makeTokenStore(file).set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  assert.equal(makeTokenStore(file).get().refresh_token, 'r');
});

test('the token file is readable only by the current user', (t) => {
  const file = tempFile(t);
  makeTokenStore(file).set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('the folder is created private', (t) => {
  const file = tempFile(t);
  makeTokenStore(file).set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
});

test('clear forgets the tokens and deletes the file', (t) => {
  const file = tempFile(t);
  const store = makeTokenStore(file);
  store.set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  store.clear();
  assert.deepEqual([store.get(), existsSync(file)], [null, false]);
});

test('a corrupt file starts signed out instead of crashing', (t) => {
  const file = tempFile(t);
  makeTokenStore(file).set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  writeFileSync(file, '{not json');
  assert.equal(makeTokenStore(file).get(), null);
});

test('a token file without both tokens starts signed out', (t) => {
  const file = tempFile(t);
  const store = makeTokenStore(file);
  store.set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  for (const bad of ['{}', '{"access_token":"a"}', '{"access_token":1,"refresh_token":"r"}', 'null']) {
    writeFileSync(file, bad);
    assert.equal(makeTokenStore(file).get(), null, bad);
  }
});

test('a folder that already exists with open permissions is made private', { skip: process.platform === 'win32' }, (t) => {
  const file = tempFile(t);
  mkdirSync(join(file, '..'), { mode: 0o755 });
  chmodSync(join(file, '..'), 0o755);
  makeTokenStore(file).set({ access_token: 'a', refresh_token: 'r', expires_in: 60 });
  assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
});
