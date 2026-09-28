/**
 * Rule-check primitives for eval cases. Each returns {description, check(transcript)}
 * where check returns {pass, detail}. transcript shape: runner.mjs § Transcript.
 */

function toolCallsOn(transcript, turn) {
  if (turn === undefined) return transcript.turns.flatMap((t) => t.toolCalls);
  return transcript.turns[turn]?.toolCalls ?? [];
}

export function calledTool(name, { turn, description } = {}) {
  return {
    description: description ?? `calls ${name}${turn === undefined ? '' : ` on turn ${turn}`}`,
    check(transcript) {
      const calls = toolCallsOn(transcript, turn);
      const pass = calls.some((c) => c.name === name);
      return { pass, detail: pass ? '' : `no call to ${name}; saw [${calls.map((c) => c.name).join(', ')}]` };
    },
  };
}

export function notCalledTool(name, { turn, description } = {}) {
  return {
    description: description ?? `never calls ${name}${turn === undefined ? '' : ` on turn ${turn}`}`,
    check(transcript) {
      const calls = toolCallsOn(transcript, turn);
      const bad = calls.filter((c) => c.name === name);
      return { pass: bad.length === 0, detail: bad.length ? `unexpected call to ${name}` : '' };
    },
  };
}

export function calledToolOnTurn(turn, name) {
  return calledTool(name, { turn });
}

export function notCalledToolOnTurn(turn, name) {
  return notCalledTool(name, { turn });
}

export function toolArgs(name, checkFn, { turn, description } = {}) {
  return {
    description: description ?? `${name} args satisfy check`,
    check(transcript) {
      const calls = toolCallsOn(transcript, turn).filter((c) => c.name === name);
      if (!calls.length) return { pass: false, detail: `no call to ${name} to check args on` };
      const pass = calls.some((c) => checkFn(c.args));
      return { pass, detail: pass ? '' : `no ${name} call matched: ${JSON.stringify(calls.map((c) => c.args))}` };
    },
  };
}

export function replyContains(turn, needles, { description } = {}) {
  const list = Array.isArray(needles) ? needles : [needles];
  return {
    description: description ?? `reply on turn ${turn} contains ${list.join(' / ')}`,
    check(transcript) {
      const text = (transcript.turns[turn]?.text ?? '').toLowerCase();
      const pass = list.some((n) => text.includes(n.toLowerCase()));
      return { pass, detail: pass ? '' : `reply was: "${transcript.turns[turn]?.text ?? ''}"` };
    },
  };
}

export function replyExcludes(turn, needles, { description } = {}) {
  const list = Array.isArray(needles) ? needles : [needles];
  return {
    description: description ?? `reply on turn ${turn} excludes ${list.join(' / ')}`,
    check(transcript) {
      const text = (transcript.turns[turn]?.text ?? '').toLowerCase();
      const hit = list.find((n) => text.includes(n.toLowerCase()));
      return { pass: !hit, detail: hit ? `reply contained forbidden "${hit}": "${transcript.turns[turn]?.text ?? ''}"` : '' };
    },
  };
}

export function custom(description, checkFn) {
  return { description, check: checkFn };
}
