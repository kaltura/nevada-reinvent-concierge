# Nevada

Nevada is a live avatar concierge for AWS re:Invent attendees. Plan your week with her face to face: talk, type or tap, and she finds sessions, books them and fixes clashes. She shows and points at what she's talking about. Built on the Kaltura Intelligent Agents SDK and the AWS Events API.

Inspired by [How to plan re:Invent 2026 with the new AWS Events API and MCP server](https://builder.aws.com/content/3JjrKKy63DJ80xhHTHd50DUIoxx/how-to-plan-reinvent-2026-with-the-new-aws-events-api-and-mcp-server).

Not affiliated with or endorsed by AWS.

## Run it

```sh
npx nevada-reinvent
```

The first time, npx asks "Ok to proceed?". Type `y`. Your browser opens and you sign in. Nevada then builds your plan.

| You need | Note |
|---|---|
| Node.js 20.6 or later | Check with `node --version`. Older versions stop with a clear message. |
| An AWS Builder ID linked to your re:Invent registration | Without a registration, AWS refuses your schedule and Nevada says so. |
| A desktop browser | Chrome, Edge or another Chromium browser works best. Safari and Firefox work with limits. No phones or tablets. |
| Internet | The avatar and the AWS schedule run online. |
| A microphone (optional) | Typing works without it. |

| To | Do this |
|---|---|
| Stop | Press Ctrl+C in the terminal. |
| Start without opening the browser | `npx nevada-reinvent --no-open`. The terminal prints the link. |
| Sign out | Click the pill in the top bar ("Signed in"), then "Sign out of AWS Events". This deletes your saved sign-in and revokes it at AWS. |
| Remove | Delete `~/.nevada` (or the folder in `NEVADA_HOME`). Nothing else is installed. |

Everything runs on your computer at `127.0.0.1`. Your AWS sign-in stays on your computer. What you say and the schedule details Nevada reads are sent to Kaltura to run the avatar. Nothing is sent anywhere else.

Your sign-in is saved in `~/.nevada/tokens.json`, readable only by you. Set `NEVADA_HOME` to an absolute folder path to use another place. Use Nevada on a computer only you use. On Windows the folder relies on your user profile permissions.

### Troubleshooting

| Problem | Fix |
|---|---|
| "Ports 8484 to 8489 are in use or blocked" | Close whatever uses them, then run it again. AWS only allows these ports. |
| The sign-in screen shows again, with a message | Read the message. Then try again with the link the app opens. Each sign-in link works once, for 10 minutes. |
| "Nevada couldn't save your sign-in" | Nevada can't write to its folder. Read the terminal, then set `NEVADA_HOME` to a folder you own and sign in again. |
| "Signed in, but ..." banner | Sign-in worked, but AWS refused the schedule. "Not registered" means your Builder ID isn't linked to your re:Invent registration. Before 8 October the AWS schedule API isn't open yet, and the banner says so. |
| "Your AWS sign-in expired" | Sign in again. Saved sign-ins last 30 days. |
| "Open the link above in your browser." | Nevada couldn't open a browser. Copy the printed link into one. |
| Nevada is already running | Running the command again opens the running one. |
| No microphone | Allow the mic for `127.0.0.1` in your browser. Typing works without it. |

## Run it from source

```sh
npm install
NEVADA_WIDGET_ID=<public widget id> npm start
```

On Windows PowerShell, use `$env:NEVADA_WIDGET_ID='<public widget id>'; npm start`.

`npm start` is the same app as `npx nevada-reinvent`. The widget ID is public and fine to share. Without `NEVADA_WIDGET_ID`, the app reads `server/agent.json`, which `npm run provision` writes for maintainers. No secret is needed to run it.

## Maintainers

Only the person who owns the Kaltura agent needs `.env`. Attendees and contributors never do.

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
| `NEVADA_HOME=<folder> npm run eval` | Runs the agent evals. `NEVADA_HOME` is required so evals never use your real sign-in. It writes to the AWS account signed in under that folder, so use a dedicated empty test account. |

### Release

Before you publish, run `npm pack --dry-run` and check the file list. It must not contain `.env`, `server/agent.json` or `server/evals/.cache/`. `prepack` writes `server/public.json` (the public widget ID) from `server/agent.json`. Then run `npm publish --otp=<code>`.

## Repo layout

| Path | What |
|---|---|
| `client/` | Browser app: avatar session, composer, disclosure, captions, screen context, client tools |
| `server/` | The local app: static files, server tools, sign-in, token file, catalog sync and search, unit tests, evals. `index.mjs` is the `npx` entry point. |
| `scripts/` | `provision.mjs` creates the agent, tools and widget; `update-prompts.mjs` pushes prompt changes; `catalog-tags.mjs` rebuilds the catalog tag list; `write-public.mjs` writes the public widget ID into the package |
| `prompts/` | Agent prompts, read by provisioning. `catalog-tags.md` is generated. |

## Docs

| Doc | Covers |
|---|---|
| [FEATURES.md](FEATURES.md) | What Nevada does, ranked awe moments, feature menu |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee sees and hears |
| [DESIGN.md](DESIGN.md) | Look and feel: tokens, layout, components, motion |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, identity, sign-in, security model, agent config, tools |
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
5. Planned: a face-to-face morning briefing in event week.
6. A shareable recap card of your week, on request.
