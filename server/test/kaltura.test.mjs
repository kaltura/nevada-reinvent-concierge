import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeKaltura } from '../kaltura.mjs';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const res = (status, body) => ({ status, ok: status < 400, json: async () => body });

function fakeKaltura({ rejectAppInit = 0, widgetStatus = 200 } = {}) {
  const calls = [];
  let rejects = rejectAppInit;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).endsWith('startWidgetSession')) return res(widgetStatus, { ks: `ks${calls.filter((c) => c.url.endsWith('startWidgetSession')).length}` });
    if (rejects-- > 0) return res(401, {});
    return res(200, { ks: 'djJ8', conversationManagerUrl: 'wss://cm', srsBaseUrl: 'https://srs', turnServerUrl: 'turn:t', partnerId: 1 });
  };
  return calls;
}

test('appInit mints a widget session from the widget id alone, then calls appInit with it', async () => {
  const calls = fakeKaltura();
  const result = await makeKaltura('W1').appInit();
  assert.equal(result.ks, 'djJ8');
  const form = new URLSearchParams(calls[0].opts.body);
  assert.deepEqual([form.get('widgetId'), form.get('format'), calls[1].opts.headers.Authorization], ['W1', '1', 'KS ks1']);
});

test('the widget session is reused between calls', async () => {
  const calls = fakeKaltura();
  const kaltura = makeKaltura('W1');
  await kaltura.appInit();
  await kaltura.appInit();
  assert.equal(calls.filter((c) => c.url.endsWith('startWidgetSession')).length, 1);
});

test('one 401 from appInit mints a new widget session and retries', async () => {
  const calls = fakeKaltura({ rejectAppInit: 1 });
  await makeKaltura('W1').appInit();
  assert.equal(calls.at(-1).opts.headers.Authorization, 'KS ks2');
});

test('a second 401 is an error, not a loop', async () => {
  fakeKaltura({ rejectAppInit: 2 });
  await assert.rejects(makeKaltura('W1').appInit(), /appInit failed \(HTTP 401\)/);
});

test('a failed widget session is an error that names no secret', async () => {
  fakeKaltura({ widgetStatus: 500 });
  await assert.rejects(makeKaltura('W1').appInit(), /widget session failed \(HTTP 500\)/);
});
