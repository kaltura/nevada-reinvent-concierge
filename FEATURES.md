[← Back to README](README.md)

# Features, competitive gap, and wow-factor rationale

Why this project isn't "a chatbot over a session catalog," backed by research into what already exists.

## What the market already does (and why it isn't enough)

Grip, Brella, Bizzabo/Klik, Swapcard, Cvent, EventsAir, and Hubilo have all converged on the same feature set: attendee-to-attendee matchmaking, recommendation lists driven by behavioral data, and 1:1 meeting scheduling as core infrastructure. Bizzabo's Klik SmartBadge even turns physical badge-taps into a recommendation feed. This is the baseline attendees already expect — and every one of these platforms is a **forms-and-notifications UI**, not a spoken, embodied concierge. None reason out loud about a schedule conflict, none inject deliberate serendipity as a feature, and none maintain a multi-day *relationship* with the attendee — they're single-session tools you open when you need something, not something with an ongoing daily rhythm.

Voice/avatar concierges do exist elsewhere (retail kiosks, hospitality signage, museum wayfinding — RAVATAR, DisplayMan, and similar digital-human platforms), but they're overwhelmingly **passive, single-turn kiosk replacements**: stand in front of a screen, ask a question, walk away. None of them carry a relationship across a multi-day event — remembering your week, briefing you each morning, recapping each evening.

**The gap this project sits in:** an embodied, voice-first concierge that (a) reasons about your schedule out loud instead of just listing conflicts, (b) treats serendipity as a designed feature, not an accident, and (c) maintains a daily rhythm across re:Invent's full week rather than being a one-off Q&A session. Nothing in either category above does all three.

## GenUI architecture is validated by where the industry is going, not just by this SDK

Google's A2UI (Agent-to-User-Interface) protocol — an open spec for agents that emit structured widget JSON instead of raw markup, letting the client render with its own component library — reached v0.9 in April 2026. Flutter's GenUI SDK does the same thing in production: the agent assembles real interactive widgets (cards, filters, carousels) live, as the conversation progresses, rather than describing them in text. This is exactly the shape of the Kaltura SDK's own GenUI model (structured widgets over a trust boundary, client owns rendering) — the architecture isn't a one-off choice, it's converged industry practice. Worth stating plainly in any public-facing description of this project: it's applying a current best practice, not inventing an untested pattern.

One thing not found anywhere in this research: a published conflict-aware, AI-assisted conference-calendar UI pattern. Every example found was a static academic-conference calendar page. **A good clash-detection-with-suggested-swap UI is genuinely white space, not a known pattern being re-implemented** — this is the single best differentiation opportunity in the whole project.

## Being early is itself a feature

The AWS Events API and its MCP server were published the same day this project was scoped (2026-09-23). No public discussion of it existed yet on Reddit, Hacker News, or dev.to at research time — absence of results doesn't prove nothing exists, but it does mean shipping something visible in the next couple of weeks plausibly makes this one of the first public builds on a brand-new AWS API. That's a real, sayable claim for a portfolio/showcase piece, independent of how good the concierge itself is.

## Feature menu, by effort and wow-factor

| Feature | Effort | Wow factor | Notes |
|---|---|---|---|
| Voice session search/filter (topic, level, day, room) | Low | Medium | Table-stakes — must be flawless, not the differentiator itself |
| **Conflict-aware scheduling with live GenUI calendar updates** | Medium | **High** | The white-space UI opportunity above. Shows both AWS's real data and the SDK's GenUI live, not as a demo gimmick |
| **Morning briefing + evening digest (daily rhythm)** | Low | **High** | What makes this feel like an ongoing concierge relationship rather than a chatbot session — no competitor researched does this |
| "Wildcard" personality-driven pick (a session outside your comfort zone) | Low | High | Literally AWS's own example prompt in their launch post ("one session that has nothing to do with my job") — cheap, on-brand, quotable in a demo |
| "Fill my gaps" (propose sessions for an empty schedule block) | Low–Medium | Medium–High | Natural extension of search + schedule awareness already being built |
| Speaker-network exploration ("more from speakers I've favorited") | Medium | Medium | Bounded by the API's own gap — speaker is a bare name string, no ID, so this needs exact-match string logic and will misfire on collisions |
| Persona presets (builder track / exec track / first-timer) | Low | Medium | Canned system-prompt variants over the same tools — cheap framing device, good demo entry point |
| First-timer "re:Invent survival" onboarding mode | Low | Medium | Good narrative hook for a walkthrough/demo video |
| Post-session voice recap capture (dictate your own notes per session) | Low | Medium | Personal-journal feature; low external dependency, no AWS API gap to work around |
| Team/coworker schedule coordination and overlap-finding | High | Medium | Real, but each teammate needs their own local-pairing run — heavier lift, not a v1 feature |
| Room-walk / venue navigation | Medium | Low–Medium | The AWS API has no venue-map data; would need a separately-sourced venue map. Likely out of scope unless that data shows up elsewhere |
| Session "FOMO"/popularity scoring | High | Medium | The API only exposes the banded `seatAvailability` enum, not real capacity/interest numbers — a true popularity score isn't feasible from this data alone |

## What this means for the roadmap

The two highest-leverage, lowest-effort features — conflict-aware live scheduling and the morning/evening daily rhythm — are already load-bearing parts of [EXPERIENCE-UX.md](EXPERIENCE-UX.md) (the schedule canvas, `highlight_conflict`, morning briefing). The wildcard pick and persona presets are cheap additions that should be pulled into Phase 1/3 rather than left as backlog — see [ROADMAP.md](ROADMAP.md). Team coordination, room navigation, and FOMO scoring are explicitly **not v1**: each is blocked by a real data or effort constraint documented above, not just deprioritized for no reason.
