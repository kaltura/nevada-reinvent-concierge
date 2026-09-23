[← Back to README](README.md)

# Experience & UX

What the attendee sees and hears, and why each choice fits both the SDK's real constraints and how people actually plan a conference week.

## Two surfaces: voice + client-commands, vs. chat + GenUI

The SDK's structured GenUI widgets (session galleries, sourced answers, follow-up chips) are built and battle-tested, but the SDK's own docs confirm the live voice-avatar delivery path is hardcoded to `force_experience:'avatar_only'` — meaning the built-in widgets don't reliably render over the voice socket. They render reliably over the text/HTTP chat transport instead.

So this project deliberately runs two rendering mechanisms, matched to two real attendee moods:

| Surface | Transport | Rendering mechanism | When an attendee reaches for it |
|---|---|---|---|
| **Voice concierge** (primary) | `KalturaAvatarSession`, open-mic | Our own client-command tools (`show_sessions`, `render_schedule`, …) drive a bespoke on-page UI | Hands-free planning: walking the expo floor, multitasking, a longer exploratory "help me plan Tuesday" conversation |
| **Chat companion** (secondary) | `KalturaChatSession` | Real SDK GenUI widgets — `content-gallery` for session cards, `sources` for grounded answers, `followups` for suggested next questions | Quiet environments, quick lookups, browsing at a desk |

Both share one thread via `switchMode()` — an attendee can start by voice on the show floor, then switch to chat back at the hotel, and the concierge remembers everything (`modeChanged.threadContinuity` tells the app when the thread carried over, so it can show "conversation restored").

Open-mic (not push-to-talk) is the right voice mode here: attendees ask longer, exploratory questions ("what should I do Tuesday afternoon if I care about agentic AI and I'm already reserved for the 2pm keynote deep-dive"), and re:Invent's expo floor is noisy but the attendee is typically alone with their phone/laptop at the moment they're talking to it, not shouting over a crowd into a shared mic — closer to the SDK's "investor Q&A / tutoring" open-mic profile than its "walkie-talkie burst" push-to-talk profile.

## The schedule canvas

A real weekly grid (the actual re:Invent days, Dec 1–5, 2026), not a text list. This is the one piece of UI that's always on screen once an attendee has any reservations, favorites, or personal time:

- Reserved sessions: solid blocks.
- Favorited-but-not-reserved: outlined blocks (interest recorded, no seat claimed — matching what `AssociateFavorites` actually means).
- Personal time: a visually distinct block (travel, meetings, breaks).
- Conflicts: `highlight_conflict` flags overlapping blocks the moment a reservation attempt clashes with something already on the schedule — using the exact clash detail `ReserveSessions` itself returns (which session it clashes with), not a generic warning.
- Redrawn from a fresh `GetSchedule` read every time it updates — never from the conversation's own memory of what it "just did." This matches the SDK-and-API-level rule that `GetSchedule` is the one source of truth (see [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md#endpoints-this-project-uses)).

## "Fill my gaps"

An attendee points at (clicks, or on voice just says "Tuesday afternoon") an empty stretch on the canvas and asks the concierge to propose something. The agent calls `search_sessions` with the time window, the attendee's stated interests, and the existing schedule as context, then `show_sessions` renders 3–5 candidates as cards — never auto-books anything; every reservation is an explicit attendee action, spoken or clicked.

## Wildcard pick

On request ("surprise me," "something outside my comfort zone" — AWS's own launch post uses exactly this example), `search_sessions` runs in a **diversity mode**: instead of ranking by interest-overlap, it explicitly favors sessions with *low* tag overlap against the attendee's favorites/reservations so far, then still respects hard constraints (time available, not already conflicting). Rendered through the same `show_sessions` card path as any other search — this is a ranking mode, not a new tool or a new UI.

## Persona presets

At first use (or anytime, "switch to exec mode"), the attendee can pick a persona — builder track, executive track, first-timer "survival mode" — that's a canned system-prompt/`request_vars` variant layered over the same tools everyone uses. A persona changes tone and default filters (e.g. first-timer mode proactively explains re:Invent logistics unprompted; exec mode biases `search_sessions` toward keynotes and leadership sessions), never the underlying capabilities.

## Personalization onboarding

A short spoken exchange on first use, not a form: "What's your role, and what AWS services or topics are you here for?" The answers feed `search_sessions` as a standing bias, and get revisited conversationally ("still mostly interested in agentic AI, or has that changed since day one?") rather than locked in once. If the attendee prefers to skip straight to browsing, that's fine — recommendations just start more generic and sharpen as favorites/reservations accumulate.

## Lifecycle-aware personality

The concierge's own tone and available actions track where re:Invent actually is in its calendar (see [AWS-EVENTS-INTEGRATION.md § Event lifecycle dates](AWS-EVENTS-INTEGRATION.md#event-lifecycle-dates-that-shape-the-ux)):

| Phase | Concierge behavior |
|---|---|
| Now → ~Oct 6 | Browsing and favoriting only. If asked to reserve, explain plainly that reserved seating isn't open yet — never retry a `409` as if it might succeed. |
| ~Oct 6–8 → Dec 1 | Reservations live. Proactively flag when a favorited session hasn't been reserved yet, since capacity fills over these weeks. |
| Dec 1–5 (event week) | Morning-briefing mode (below) becomes the default opening of each day's first conversation. |

## Morning briefing

Each morning of the event, the first time the attendee opens the app (or wakes the voice concierge), it leads with a short spoken summary — first session, any gaps, anything reserved that starts soon — backed by the same `render_schedule` card, not a new UI. This is a framing choice (what the agent says first), not a new mechanism.

## Moments of delight, kept restrained

`celebrate_action` fires on a successful favorite/reserve — but deliberately small (a brief highlight/pulse on the affected card, not a full-screen animation). Conference-planning is a task an attendee repeats dozens of times across the week; a delight moment that's fun once and mutes itself quickly by the tenth repeat is the right calibration, not a maximalist one.

## Accessibility

Following the SDK's own accessibility guidance directly: a text box sits alongside the voice UI at all times (typed turns work in either voice mode, satisfying concurrent voice+text access), the schedule canvas and session cards use the SDK's real `kgenui`-equivalent semantic markup patterns (real `<label>`/`<button aria-pressed>` elements, not divs with click handlers), and the mic-state feedback follows the SDK's three-signal pattern (icon change, live level indicator, an `aria-live` text update) rather than relying on a single visual cue.

## Related docs

| Doc | Covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | The tools and mechanisms behind every interaction described here |
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The API-level facts this UX is grounded in |
