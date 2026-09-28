/**
 * LLM judge for subtler dimensions (helpfulness, tone, correctness) that rule
 * checks can't cover. Shells out to the `claude` CLI, so no new npm
 * dependency. `--bare` skips OAuth logins: the CLI needs ANTHROPIC_API_KEY or
 * Bedrock credentials.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * @param {string} rubric What to judge, e.g. "Does the reply name a specific session and time?"
 * @param {string} transcriptText The conversation to judge, rendered as plain text.
 * @returns {Promise<{pass: boolean, reason: string}>}
 */
export async function judge(rubric, transcriptText) {
  const prompt = [
    'You are grading one turn of a conversational AI concierge for an event.',
    'Judge ONLY the rubric below against the transcript. Reply with exactly one line:',
    '"PASS: <one short reason>" or "FAIL: <one short reason>".',
    '',
    `Rubric: ${rubric}`,
    '',
    'Transcript:',
    transcriptText,
  ].join('\n');

  const { stdout } = await run('claude', [
    '-p', prompt,
    '--model', 'haiku',
    '--output-format', 'json',
    '--tools', '',
    '--permission-prompts', 'none',
    '--bare',
  ], { maxBuffer: 4 * 1024 * 1024 });

  const { result } = JSON.parse(stdout);
  const m = /^(PASS|FAIL):\s*(.*)$/is.exec(result.trim());
  if (!m) return { pass: false, reason: `judge gave an unparseable answer: ${result}` };
  return { pass: m[1] === 'PASS', reason: m[2] };
}
