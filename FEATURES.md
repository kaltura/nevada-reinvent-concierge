[← Back to README](README.md)

# Features

What Nevada does, and its planned feature set.

Nevada plans your event week face to face. Talk, type or tap, and she finds sessions, books them, resolves clashes and briefs you each morning. She shows and points at what she's talking about on screen.

## Awe moments, ranked

| # | Moment | Why it lands | Data | Effort |
|---|---|---|---|---|
| 1 | [Conflict swap](EXPERIENCE-UX.md#conflict-swap) with repeats | Answers a real attendee request to "see ALL occurrences" of a session. Nevada explains it face to face while both blocks glow, and a tap or a word fixes it. | `conflictsWith` plus our repeat matching | Medium |
| 2 | [Show and tell](EXPERIENCE-UX.md#talk-type-or-tap) | Nevada points at the card she's talking about and understands "this one". It feels like planning with a person. | Screen context plus `point_at` | Low |
| 3 | Travel check between venues | Shuttle and walking time is the top attendee complaint | Venue mapping plus a static table (see [ARCHITECTURE.md § Search](ARCHITECTURE.md#search)) | Medium |
| 4 | Full-session fallback | Turns "full" into a next step | `seatAvailability`, repeats | Low |
| 5 | Morning briefing | Nevada greets you each morning with your day. Feels like a real concierge, not a search box. | `GetSchedule` plus the keynote list | Low |
| 6 | Shareable recap card | Fun to post, and nothing like it exists for re:Invent | `GetSchedule` | Low |
| 7 | Wildcard pick | Quotable in a demo | Index with inverted ranking | Low |

## Feature menu

| Feature | Phase | Note |
|---|---|---|
| Avatar conversation by voice, text and touch | 1 | The avatar is live the whole visit |
| Screen context and `point_at` | 1 | Behind a Phase 0 spike |
| Quiet mode (voice off, captions and video on) | 1 | |
| Search by topic, level, day, time and venue | 1 | Must be fast and right every time |
| Favorites, reservations, personal time | 1 | Reservations switch on when seating opens |
| Schedule canvas | 1 | |
| Conflict swap | 1 | |
| Terminal pairing code, then QR handoff to a phone | 1 | The connect gate blocks all use until pairing succeeds; there's no try-before-pairing mode |
| Fill my gaps, see all times, wildcard | 1 | |
| Travel check | 2 | Needs the 2026 venue data |
| Morning briefing (in-app) | 2 | |
| Personas | 3 | Prompt variants only |
| Text-only fallback for weak signal | 3 | Same conversation, last frame as a still |
| Cut-out avatar on the night gradient | 4 | Only if the Phase 0 spike passes |
| Recap card | 4 | |
| Morning push notification | 4 | iOS needs Home Screen install. Behind a device test. |

## Not in v1

| Idea | Why not |
|---|---|
| Team planning | Each teammate pairs on their own laptop. Heavy for a first release. |
| Maps and directions | Not in the API. The official app already does it well. |
| Popularity score | The API gives only a seat band, not numbers |
| Speaker follow | Speakers are bare names with no ID, so matches would misfire |
| Live keynote watching | Out of scope for a planning tool |
| Photo input (point the camera at a poster or badge) | The SDK has no camera input |
| Avatar gestures and emotions on cue | No API to trigger them |
| Rich widgets drawn by the agent | The avatar connection doesn't deliver them. Our client tools draw the screen instead. |
| Word-by-word captions and a live transcript of the attendee | Caption timing is per sentence, and the attendee's words arrive only when they finish |
