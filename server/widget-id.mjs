import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** public.json is generated into the npm package (prepack); a source checkout has agent.json. */
export function resolveWidgetId() {
  if (process.env.NEVADA_WIDGET_ID) return process.env.NEVADA_WIDGET_ID;
  for (const file of ['public.json', 'agent.json']) {
    try { return JSON.parse(readFileSync(join(here, file), 'utf8')).widgetId ?? null; } catch { /* try the next file */ }
  }
  return null;
}
