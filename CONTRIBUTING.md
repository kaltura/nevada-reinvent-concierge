# Contributing

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

```sh
cp .env.example .env    # fill it in, never commit it
npm install
npm run provision       # creates the agent, tools and widget; run once
npm start
```

See [README.md](README.md) for prerequisites and the full script list.

## Tests

```sh
npm test
```

Runs the unit suite in `server/test/*.test.mjs`. No live credentials needed. Keep this green.

## Evals

`npm run eval` drives the real Kaltura agent against a real AWS Events account and needs live credentials, a paired AWS test account and the `claude` CLI as the judge. Maintainers run evals; you don't need to run them to send a pull request. If you add or change a case, `npm test` checks that it's well formed.

## Pull requests

1. Branch from `main`.
2. Keep the change focused. Split unrelated fixes into separate PRs.
3. Run `npm test` and make sure it passes.
4. Open the PR against `main` and fill in the pull request template.
5. A maintainer reviews and merges.

## Style

- Plain ES modules (`.mjs`), no build step, no TypeScript.
- Match the existing code: short functions, comments that explain why, not what the code already says.
- No new dependencies without a good reason. The one runtime dependency is `@kaltura/intelligent-agents`.
- Write commit messages and comments in plain, direct English.
