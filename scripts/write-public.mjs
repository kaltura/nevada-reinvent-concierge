// Runs on `npm pack` and `npm publish`: copies the public widget id into the package.
import { readFileSync, writeFileSync } from 'node:fs';

let widgetId;
try {
  ({ widgetId } = JSON.parse(readFileSync('server/agent.json', 'utf8')));
} catch (e) {
  console.error(e.code === 'ENOENT'
    ? 'server/agent.json is missing. Run `npm run provision` first.'
    : `Can't read server/agent.json: ${e.message}`);
  process.exit(1);
}
writeFileSync('server/public.json', `${JSON.stringify({ widgetId })}\n`);
