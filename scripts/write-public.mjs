// Runs on `npm pack` and `npm publish`: copies the public widget id into the package.
import { readFileSync, writeFileSync } from 'node:fs';

const { widgetId } = JSON.parse(readFileSync('server/agent.json', 'utf8'));
writeFileSync('server/public.json', `${JSON.stringify({ widgetId })}\n`);
