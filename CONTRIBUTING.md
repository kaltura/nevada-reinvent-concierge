# Contributing

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```sh
npm install
npm test
```

You need Node.js 20.6 or later (`.nvmrc` pins 20.6.0). No account, secret or `.env` file is needed to work on the code or run the tests.

## Run it from source

```sh
NEVADA_WIDGET_ID=<public widget id> npm start
```

On Windows PowerShell, use `$env:NEVADA_WIDGET_ID='<public widget id>'; npm start`.

`npm start` is the same app as `npx nevada-reinvent`. The widget ID is public and fine to share. Without `NEVADA_WIDGET_ID`, the app reads `server/agent.json`, which `npm run provision` writes for maintainers. No secret is needed to run it.

## Repo layout

| Path | What |
|---|---|
| `client/` | Browser app: avatar session, composer, disclosure, captions, screen context, client tools |
| `server/` | The local app: static files, server tools, sign-in, token file, catalog sync and search, unit tests, evals. `index.mjs` is the `npx` entry point. |
| `scripts/` | `provision.mjs` creates the agent, tools and widget; `update-prompts.mjs` pushes prompt changes; `catalog-tags.mjs` rebuilds the catalog tag list; `write-public.mjs` writes the public widget ID into the package |
| `prompts/` | Agent prompts, read by provisioning. `catalog-tags.md` is generated. |
| `docs/` | Design, experience, architecture and AWS API notes. See the [README](README.md#docs). |

## Tests

```sh
npm test
```

Runs the unit suite in `server/test/*.test.mjs`. No live credentials needed. Keep this green.

CI runs on Ubuntu, macOS and Windows, each with Node 20.6 and 24.x. Each run does four things:

1. `npm ci`
2. `npm test`
3. `node --check` on every tracked `.js`, `.cjs` and `.mjs` file
4. A launcher smoke test: start `node server/index.mjs --no-open` and check that `/api/health` answers

Windows contributors can run `npm test` as is. If a test depends on POSIX file modes, skip that check on `win32`.

## Evals

`NEVADA_HOME=<folder> npm run eval` drives the real Kaltura agent against a real AWS Events account. It needs a dedicated, empty AWS test account signed in through `NEVADA_HOME=<folder> npm start`, and the `claude` CLI as the judge. `NEVADA_HOME` is required, so evals never touch your real sign-in. Maintainers run evals; you don't need to run them to send a pull request. If you add or change a case, `npm test` checks that it's well formed.

## Pull requests

1. Branch from `main`.
2. Keep the change focused. Split unrelated fixes into separate PRs.
3. Run `npm test` and make sure it passes.
4. Open the PR against `main` and fill in the pull request template.
5. A maintainer reviews and merges.

## Style

- Plain ES modules (`.mjs`), no build step, no TypeScript.
- Match the existing code: short functions, comments that explain why, not what the code already says.
- No runtime dependencies. Add a dependency only with a good reason.
- Write commit messages and comments in plain, direct English.
- Update `docs/` in the same PR when behavior changes.

## Maintainers

Only the person who owns the Kaltura agent needs `.env`. Attendees and contributors never do. Never commit it. The widget ID and partner ID are public and fine to share.

```sh
cp -n .env.example .env # fill it in, never commit it
npm run provision       # creates the agent, tools and widget; run once
npm run update-prompts  # pushes edits in prompts/ to the live agent
```

| Variable | Needed by | How to get it |
|---|---|---|
| `KALTURA_PARTNER_ID` | `provision`, `update-prompts` | Your Kaltura account's partner ID |
| `KALTURA_ADMIN_SECRET` | `provision`, `update-prompts` | Your Kaltura account's admin secret. Never ship it. |
| `KALTURA_VISUAL_ID`, `KALTURA_VOICE_ID` | `provision` | Avatar look and voice IDs, from `avatars.listTemplates` |

Changed a file in `prompts/`? Run `npm run update-prompts` after the merge. `base-directive.md` needs `npm run provision` instead.

### npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs the local app |
| `npm run provision` | Creates the Kaltura agent, tools and widget; writes `server/agent.json`. Stops if that file already exists. |
| `npm run update-prompts` | Pushes prompt changes in `prompts/` to the existing agent. `base-directive.md` needs `npm run provision` instead. |
| `npm run catalog-tags` | Rebuilds `prompts/catalog-tags.md` from the live catalog. Needs you to be signed in through `npm start` first. Run `npm run update-prompts` after. |
| `npm test` | Runs the unit test suite (`server/test/*.test.mjs`) |
| `NEVADA_HOME=<folder> npm run eval` | Runs the agent evals. `NEVADA_HOME` is required so evals never use your real sign-in. It writes to the AWS account signed in under that folder, so use a dedicated empty test account. |

### Release

The package is [nevada-reinvent on npm](https://www.npmjs.com/package/nevada-reinvent). To release, bump `version` in `package.json` on `main`, then run `npm pack --dry-run` and check the file list. It must not contain `.env`, `server/agent.json` or `server/evals/.cache/`. `prepack` writes `server/public.json` (the public widget ID) from `server/agent.json`. Then run `npm publish --otp=<code>` and check it with `npx nevada-reinvent@latest` from an empty folder.

### Before launch

Manual checks to run with a real account before event week. None of them is automated.

| Check | Pass |
|---|---|
| Client tools | `show_sessions` and `highlight_conflict` update the page while Nevada keeps talking, 10 of 10 turns |
| Screen context | "Book this one" with a card open picks the right session, 10 of 10 turns |
| Typed and tapped turns | 10 of 10 turns answered, none lost, including during the opening line |
| `point_at` | The ring lands on the right card in 8 of 10 turns |
| Avatar resize | 20 size changes between `stage`, `split` and `tile` with no freeze |
| Keyed avatar | Smooth on a mid-range laptop, no visible margin or green edge |
| Expo noise | Fewer misheard turns in a recorded crowd-noise test |
| Browsers | A full planning conversation in Chrome, Safari and Firefox on a laptop, on a slow network |
| Live bulk codes | Record every `BulkFailure` code seen once seating opens and update [docs/AWS-EVENTS-INTEGRATION.md § Bulk results](docs/AWS-EVENTS-INTEGRATION.md#bulk-results) |
| Catalog sync | A full sync finishes with no `429` from AWS |
| Accessibility | A clean pass with keyboard only and a screen reader |
| Fresh machine | Install to first schedule read with no help |
