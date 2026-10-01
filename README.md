# Nevada

Nevada, a live avatar concierge for AWS re:Invent attendees. Plan your week with her face to face: talk, type or tap, and she finds sessions, books them and fixes clashes. She shows and points at what she's talking about. Built on the Kaltura Intelligent Agents SDK and the AWS Events API.

Inspired by [How to plan re:Invent 2026 with the new AWS Events API and MCP server](https://builder.aws.com/content/3JjrKKy63DJ80xhHTHd50DUIoxx/how-to-plan-reinvent-2026-with-the-new-aws-events-api-and-mcp-server).

Not affiliated with or endorsed by AWS.

## Run it

```sh
npx nevada-reinvent
```

Needs Node.js 20.6 or later. Your browser opens, you sign in with your AWS Events account, and Nevada builds your plan. Everything runs on your computer at `127.0.0.1`. Press Ctrl+C to stop.

| You get | You give up |
|---|---|
| Sign-in and plan stay on your computer. No account with us. | Phones and tablets. AWS only allows sign-in redirects to `127.0.0.1` on ports 8484 to 8489. |
| Nothing to host, nothing to pay for. | Always-on features, like a morning briefing or push notifications. |

Your AWS sign-in is saved in `~/.nevada/tokens.json`, readable only by you. Set `NEVADA_HOME` to use another folder. Use it on a computer only you use. Sign out in the app to delete it and revoke it at AWS.

### Troubleshooting

| Problem | Fix |
|---|---|
| "Ports 8484 to 8489 are all busy" | Close whatever uses them, then run it again. |
| Sign-in sends you back to the sign-in screen | Try again, and use the link the app opens. Each sign-in link works once, for 10 minutes. |
| "Your AWS connection lapsed" | Sign in again. Saved sign-ins last 30 days. |
| The browser did not open | Open the URL that was printed. |
| No microphone | Allow the mic for `127.0.0.1` in your browser. Typing works without it. |

## Run it from source

```sh
npm install
npm start
```

`npm start` is the same app as `npx nevada-reinvent`. It reads the public widget ID from `server/agent.json` (or `NEVADA_WIDGET_ID`). No secret is needed to run it.

## Maintainers

Only the person who owns the Kaltura agent needs `.env`. Attendees never do.

```sh
cp -n .env.example .env # fill it in, never commit it
npm run provision       # creates the agent, tools and widget; run once
```

| Variable | Needed by | How to get it |
|---|---|---|
| `KALTURA_PARTNER_ID` | `provision`, `update-prompts` | Your Kaltura account's partner ID |
| `KALTURA_ADMIN_SECRET` | `provision`, `update-prompts` | Your Kaltura account's admin secret. Never ship it. |
| `KALTURA_VISUAL_ID`, `KALTURA_VOICE_ID` | `provision` | Avatar look and voice IDs, from `avatars.listTemplates` |

### npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs the local app |
| `npm run provision` | Creates the Kaltura agent, tools and widget; writes `server/agent.json`. Stops if that file already exists. |
| `npm run update-prompts` | Pushes prompt changes in `prompts/` to the existing agent. `base-directive.md` needs `npm run provision` instead. |
| `npm run catalog-tags` | Rebuilds `prompts/catalog-tags.md` from the live catalog. Needs you to be signed in through `npm start` first. Run `npm run update-prompts` after. |
| `npm test` | Runs the unit test suite (`server/test/*.test.mjs`) |
| `npm run eval` | Runs the agent evals. Writes to the AWS account signed in under `NEVADA_HOME`, so use a dedicated empty test account. |

### Release

`npm pack --dry-run` lists what ships. `prepack` writes `server/public.json` (the public widget ID) from `server/agent.json`. Run the secret scan, then `npm publish --otp=<code>`.

## Repo layout

| Path | What |
|---|---|
| `client/` | Browser app: avatar session, composer, disclosure, captions, screen context, client tools. `client/prototype.html` is a static design reference. |
| `server/` | The local app: static files, server tools, sign-in, token file, catalog sync and search, unit tests, evals. `index.mjs` is the `npx` entry point. |
| `scripts/` | `provision.mjs` creates the agent, tools and widget; `update-prompts.mjs` pushes prompt changes; `catalog-tags.mjs` rebuilds the catalog tag list; `write-public.mjs` writes the public widget ID into the package |
| `prompts/` | Agent prompts, read by provisioning. `catalog-tags.md` is generated. |

## Docs

| Doc | Covers |
|---|---|
| [FEATURES.md](FEATURES.md) | What Nevada does, ranked awe moments, feature menu |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee sees and hears |
| [DESIGN.md](DESIGN.md) | Look and feel: tokens, layout, components, motion |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, identity, sign-in, agent config, tools |
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The AWS Events API contract we depend on |
| [ROADMAP.md](ROADMAP.md) | Phases and spikes |
| [SECURITY.md](SECURITY.md) | Supported versions and how to report a vulnerability |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [LICENSE](LICENSE) | MIT license |

## Key decisions

| Decision | Why |
|---|---|
| One shared agent, plus a local backend | The local app holds the AWS tokens and does all AWS work. The agent never sees a token. |
| Run locally with `npx` | AWS sign-in only redirects to `127.0.0.1` on ports 8484 to 8489. Running there means no hosting and no shared secret. See [ARCHITECTURE.md § Sign-in](ARCHITECTURE.md#sign-in). |
| Avatar always on screen. Talk, type or tap in one conversation. | The avatar is the product. No mode to pick, and a loud hall or a quiet room never blocks you. |
| Desktop browser only | Sign-in needs `127.0.0.1`, which a phone can't give. |
| Open mic, mic button just mutes | No push-to-talk to hold on a crowded floor. Noise handled by client-side suppression, not by gating the mic. |
| No AWS logos, icons or trade dress | AWS trademark rules. "re:Invent" appears only in plain text, in the "for AWS re:Invent attendees" form. |

## Headline moments

Ranked, with sources, in [FEATURES.md § Awe moments](FEATURES.md#awe-moments-ranked).

1. "That clashes, but it repeats Thursday at 10 and you're free. Want that?"
2. "Book this one." Nevada knows what's on your screen, and lights up the block she's talking about.
3. "Your next one is at MGM Grand. Leave by 2:50."
4. "It's full. Here's a repeat with seats."
5. A face-to-face morning briefing in event week.
6. A shareable recap card of your week.
