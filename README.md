# Nevada

Nevada, a live avatar concierge for AWS re:Invent attendees. Plan your week with her face to face: talk, type or tap, and she finds sessions, books them, fixes clashes and briefs you each morning. She shows and points at what she's talking about. Built on the Kaltura Intelligent Agents SDK and the AWS Events API.

Not affiliated with or endorsed by AWS.

## Status

Phase 1: one attendee, end to end, localhost only. See [ROADMAP.md](ROADMAP.md) for what's built and what's next.

## Prerequisites

- Node.js 20.6 or later
- A Kaltura account with Intelligent Agents enabled
- An AWS Builder ID, registered for the event, to test pairing

## Quick start

```sh
cp .env.example .env    # fill it in, never commit it
npm install
npm run provision       # creates the agent, tools and widget; run once
npm start
```

Open the app at the URL `npm start` prints, then pair a laptop with `npm run pair`.

## npm scripts

| Script | What it does |
|---|---|
| `npm start` | Runs the Web API and proxy server |
| `npm run provision` | Creates the Kaltura agent, tools and widget; writes `server/agent.json`. Stops if that file already exists. |
| `npm run update-prompts` | Pushes prompt changes in `prompts/` to the existing agent. `base-directive.md` needs `npm run provision` instead. |
| `npm run pair` | Starts the pairing helper for a local laptop |
| `npm test` | Runs the unit test suite (`server/test/*.test.mjs`) |
| `npm run eval` | Runs the agent evals against a running local server |

## Repo layout

| Path | What |
|---|---|
| `client/` | Browser app: avatar session, composer, disclosure, captions, screen context, client tools. `client/prototype.html` is a static design reference. |
| `server/` | Web API and proxy: server tools, encrypted token store, catalog sync and search, unit tests, evals. State is in memory, so a restart clears it. |
| `pair/` | Laptop pairing CLI (`nevada-pair`) |
| `scripts/` | `provision.mjs` creates the agent, tools and widget; `update-prompts.mjs` pushes prompt changes; `dev-pair.mjs` runs the pairing helper locally |
| `prompts/` | Agent prompts, read by provisioning |

## Docs

| Doc | Covers |
|---|---|
| [FEATURES.md](FEATURES.md) | What Nevada does, ranked awe moments, feature menu |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee sees and hears |
| [DESIGN.md](DESIGN.md) | Look and feel: tokens, layout, components, motion |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, identity, pairing, agent config, tools |
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The AWS Events API contract we depend on |
| [ROADMAP.md](ROADMAP.md) | Phases and spikes |
| [SECURITY.md](SECURITY.md) | Supported versions and how to report a vulnerability |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards |
| [LICENSE](LICENSE) | MIT license |

## Key decisions

| Decision | Why |
|---|---|
| One shared agent, plus our own backend proxy | The backend holds AWS tokens and does all AWS work. The agent never sees a token. |
| Pair once on a laptop | AWS sign-in only redirects to `localhost` or `127.0.0.1` on ports 8484 to 8489. A phone can't do that. See [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing). |
| Hand off to a phone after pairing | Pairing needs a terminal, but the live conversation is nicer on a phone. See [ARCHITECTURE.md § Phone handoff](ARCHITECTURE.md#phone-handoff). |
| Avatar always on screen. Talk, type or tap in one conversation. | The avatar is the product. No mode to pick, and a loud hall or a quiet room never blocks you. |
| Mobile web in a normal Safari or Chrome tab | No app store. iOS Home Screen mode has known mic and Wake Lock bugs. |
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
