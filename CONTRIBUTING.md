# Contributing

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```sh
npm install
npm test
```

You need Node.js 20.6 or later (`.nvmrc` pins 20.6.0). No account, secret or `.env` file is needed. To run the app from source, see [README.md](README.md#run-it-from-source).

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

## Maintainers

Only the owner of the Kaltura agent needs these steps. They need `KALTURA_ADMIN_SECRET` in a gitignored `.env`. Never commit it. The widget ID and partner ID are public and fine to share.

```sh
cp -n .env.example .env # then fill it in
npm run provision       # creates the agent, tools and widget; run once
npm run update-prompts  # pushes edits in prompts/ to the live agent
```

Changed a file in `prompts/`? Run `npm run update-prompts` after the merge. `base-directive.md` needs `npm run provision` instead. Each `.env` value and the full script list are in [README.md](README.md#maintainers).
