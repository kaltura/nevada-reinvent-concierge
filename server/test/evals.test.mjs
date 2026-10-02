import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { calledTool, notCalledTool, toolArgs, replyContains, replyExcludes } from '../evals/expectations.mjs';
import { CASES } from '../evals/cases.mjs';

const transcript = {
  turns: [
    { text: 'Here are three serverless talks.', toolCalls: [{ name: 'search_sessions', args: { query: 'serverless' } }] },
    { text: 'Booked.', toolCalls: [{ name: 'reserve_sessions', args: { ids: ['a'] } }] },
  ],
};

test('calledTool and notCalledTool respect the turn scope', () => {
  assert.equal(calledTool('search_sessions').check(transcript).pass, true);
  assert.equal(calledTool('search_sessions', { turn: 1 }).check(transcript).pass, false);
  assert.equal(notCalledTool('reserve_sessions', { turn: 0 }).check(transcript).pass, true);
  assert.equal(notCalledTool('reserve_sessions').check(transcript).pass, false);
});

test('toolArgs fails when the tool was never called', () => {
  assert.equal(toolArgs('search_sessions', (a) => a.query === 'serverless').check(transcript).pass, true);
  assert.equal(toolArgs('get_session', () => true).check(transcript).pass, false);
});

test('replyContains and replyExcludes ignore case', () => {
  assert.equal(replyContains(0, ['SERVERLESS']).check(transcript).pass, true);
  assert.equal(replyExcludes(1, 'booked').check(transcript).pass, false);
});

test('eval case names are unique', () => {
  const names = CASES.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
});

for (const kase of CASES) {
  test(`eval case is well formed: ${kase.name}`, () => {
    assert.ok(kase.turns.length > 0 && kase.turns.every((t) => typeof t === 'function' || (typeof t === 'string' && t.trim())));
    assert.ok(kase.paired === undefined || kase.paired === false);
    for (const { turn, rubric } of kase.judge ?? []) {
      assert.equal(typeof rubric, 'string');
      assert.ok(turn === undefined || (turn >= 0 && turn < kase.turns.length), `judge turn ${turn} out of range`);
    }
    // An empty reply per turn: every check must return a result, not throw on a bad turn index.
    const empty = { turns: kase.turns.map(() => ({ text: '', toolCalls: [] })) };
    for (const exp of kase.expect ?? []) {
      assert.equal(typeof exp.description, 'string');
      assert.equal(typeof exp.check(empty).pass, 'boolean', exp.description);
    }
  });
}

const runner = fileURLToPath(new URL('../evals/runner.mjs', import.meta.url));
function runRunner(home) {
  const env = { ...process.env };
  delete env.NEVADA_HOME;
  if (home !== undefined) env.NEVADA_HOME = home;
  return spawnSync(process.execPath, [runner], { env, encoding: 'utf8' });
}

test('the eval runner exits with 2 when NEVADA_HOME is not set', () => {
  assert.equal(runRunner().status, 2);
});

test('the eval runner exits with 2 when NEVADA_HOME is relative', () => {
  assert.equal(runRunner('relative/folder').status, 2);
});

test('the eval runner explains a relative NEVADA_HOME', () => {
  assert.match(runRunner('relative/folder').stderr, /must be an absolute path/);
});
