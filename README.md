# Nevada

Nevada, a live avatar concierge for AWS re:Invent attendees. Plan your week with her face to face: talk, type or tap, and she finds sessions, books them, fixes clashes and briefs you each morning. She shows and points at what she's talking about. Built on the Kaltura Intelligent Agents SDK and the AWS Events API.

Not affiliated with or endorsed by AWS.

AWS reviews the name and brand before any public release.

## Docs

| Doc | Covers |
|---|---|
| [FEATURES.md](FEATURES.md) | What we must beat, where we win, ranked awe moments, feature menu |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee sees and hears |
| [DESIGN.md](DESIGN.md) | Look and feel: tokens, layout, components, motion |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, identity, pairing, agent config, tools |
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The AWS Events API contract we depend on |
| [ROADMAP.md](ROADMAP.md) | Phases, spikes, open questions, risks |

## Key decisions

| Decision | Why |
|---|---|
| One shared agent, plus our own backend proxy | The backend holds AWS tokens and does all AWS work. The agent never sees a token. |
| Pair once on a laptop | AWS sign-in only redirects to `localhost` or `127.0.0.1` on ports 8484 to 8489. A phone can't do that. See [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing). |
| Try before pairing | Attendees see good picks before the laptop step |
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

## Build state

Phase 1 (one attendee, end to end) is built, localhost only. Build order and what's next are in [ROADMAP.md](ROADMAP.md).

| Path | What | Runs today |
|---|---|---|
| `client/index.html`, `client/app.js` | Web app: widget token, avatar session, composer, disclosure, captions, screen context, all client tools | Yes |
| `client/prototype.html` | Static design prototype of every screen | Open in a browser |
| `server/` | Web API and proxy: all server tools, encrypted token store, catalog sync and search. State is in memory, so a restart clears it. | Yes |
| `pair/` | Pairing helper | Yes, end to end: hands tokens to the backend, which stores them |
| `prompts/` | Agent prompts | Read by provisioning |
| `scripts/provision.mjs` | Creates the agent, tools and widget. Writes `server/agent.json`. | Yes. Run once. It stops if `server/agent.json` exists. |

```sh
cp .env.example .env    # fill it in, never commit it
npm install
npm run provision
npm start
```
