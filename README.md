# re:Invent Concierge — Plan

A voice-and-visual AI concierge that helps AWS re:Invent 2026 attendees plan their week: find sessions, build a real schedule, catch conflicts, and get a spoken daily briefing. Built on `@kaltura/intelligent-agents` (the Kaltura SDK) and the AWS Events API.

This folder is planning only. No code yet. Docs:

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System components, data flow, the auth bridge, the tool inventory |
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The AWS Events API contract this project depends on: exact schemas, endpoints, quotas, errors, sync strategy |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee sees and hears: voice mode, on-page cards, schedule canvas, personalization |
| [FEATURES.md](FEATURES.md) | Competitive gap analysis, why the GenUI architecture is on current best practice, the full feature menu by effort/wow-factor |
| [ROADMAP.md](ROADMAP.md) | Build phases, open questions, risks |

## Why this project, and why standalone

This is a separate project from `AWS-Bedrock-Presentation` — different AWS team, different purpose. It gets its own domain and its own purpose-built UI, not a slot inside an existing deck or docs site. It showcases the Kaltura SDK's voice-avatar and GenUI capabilities against a real, freshly-launched AWS API (AWS Events API, launched Sept 2026) rather than static content.

## The scoping decision: built for every attendee, not just one login

AWS's Events API has one hard constraint: sign-in only works through a local loopback OAuth redirect (`http://127.0.0.1:PORT` or `http://[::1]:PORT`), on a fixed allow-list with no hosted-redirect option and no self-service way to add one. There is no way to run this OAuth flow purely on a server. See [AWS-EVENTS-INTEGRATION.md § Authentication](AWS-EVENTS-INTEGRATION.md#authentication) for the confirmed detail.

That constraint looks like a wall, but it's not one that only lets in a single user. AWS's own guidance is: "an application you distribute runs on each attendee's machine and signs that person in." A one-time local pairing step is exactly as much work for one attendee as for a thousand. So the concierge is architected for any attendee to onboard, not hard-wired to one account:

1. Attendee visits the concierge's real website.
2. They run one command (`npx reinvent-concierge-login` or a downloadable one-file script) — it opens their browser, does the AWS Builder ID sign-in and PKCE exchange on `127.0.0.1`, then hands a refresh token to the hosted backend via a short-lived pairing code and exits.
3. Everything after that — voice concierge, schedule, recommendations — runs entirely in the browser against the hosted app. The attendee never touches localhost again.

Building the plan this way costs nothing extra over "just for me" and turns the demo into something anyone at re:Invent can actually use, which is the stronger showcase.

## Wow-factor summary

The full UX reasoning is in [EXPERIENCE-UX.md](EXPERIENCE-UX.md); the competitive/creative case behind it is in [FEATURES.md](FEATURES.md). Headlines:

- **Voice concierge that never hallucinates your calendar.** Every schedule claim is grounded in a live `GetSchedule` read, not the model's memory of the conversation.
- **The avatar drives the page, not just a chat log.** Session cards, a real weekly schedule grid, and conflict highlights appear on screen as the agent talks, via the SDK's client-command channel — a presenter walking you through your own week, not a chatbot transcript.
- **Conflict-aware scheduling with live suggested swaps** — a UI pattern no researched competitor or public example has actually built (see [FEATURES.md](FEATURES.md)), not just a known pattern re-implemented.
- **"Fill my gaps."** Point at empty blocks on the schedule canvas and ask the agent to propose sessions that fit the time, your interests, and your existing reservations.
- **A "wildcard" pick on request** — a session deliberately outside your usual interests, straight out of AWS's own launch-post example prompt, turned into a first-class feature instead of a one-off example.
- **Morning briefing + evening digest**, every day of the event — the daily rhythm that makes this feel like an ongoing concierge relationship across re:Invent's week, not a single chatbot session. No researched competitor does this.
- **Countdown-to-launch personality.** The concierge knows what phase of the event lifecycle it's in — pre-catalog, catalog live, reserved-seating-open, event week — and adjusts its own suggestions and urgency accordingly.
- **A secondary text/chat surface using the SDK's real GenUI widgets** (session galleries, follow-up chips, sourced answers) for attendees who'd rather browse than talk — see [EXPERIENCE-UX.md § Two surfaces](EXPERIENCE-UX.md#two-surfaces-voice--client-commands-vs-chat--genui) for why voice and chat need two different rendering mechanisms on this SDK.
- **Early-mover framing.** The AWS Events API/MCP server launched the same day this project was scoped, with no public builds found yet — a real, sayable claim for a showcase piece independent of the concierge's own quality.
