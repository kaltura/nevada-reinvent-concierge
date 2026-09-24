[← Back to README](README.md)

# Features

What Marquee must beat, where it wins, and what's in or out. Market facts were checked on 2026-09-23.

## The baseline: AWS's own app

The official AWS Events app is what every attendee already has. It's good, and it already uses AI:

- AI session picks based on role and interests
- An AI assistant for questions
- Reservations, schedule-change alerts and calendar sync
- Maps with turn-by-turn directions between venues, and live shuttle times

So "it has AI" is not a reason to use Marquee. Sources: the [re:Invent FAQ](https://aws.amazon.com/events/reinvent/faqs/) (Mobile App section) and AWS's [Know Before You Go](https://builder.aws.com/content/35iYepTKrrpDlEVwLGuPPfJ6X4y/know-before-you-go-attending-reinvent-2025-in-person) guide.

Other event apps (Swapcard, Brella, Grip and similar) share one feature set: matchmaking, suggestion lists and meeting booking. Digital-human kiosks such as [RAVATAR](https://ravatar.com/) are built for single visits at a booth or sign, not a plan that lasts a week.

## Where Marquee wins

| Marquee does | The official app |
|---|---|
| Plans with you face to face. A realistic avatar you can talk to, type to or tap, and it shows and points at what it means. | Tap and scroll, and a text assistant |
| Knows what's on your screen. "Book this one" just works. | Every action is a new search or tap |
| Solves clashes. It finds a repeat that fits, offers a swap and books it after you say yes. | You search for repeats yourself. Attendees [complain about it](https://www.reddit.com/r/aws/comments/1h6ustk/reinvent_2024_pet_peeves/). |
| Speaks first. Morning briefing, seating-open nudge, travel warnings. | Push alerts on changes |
| Surprises you on request (wildcard) | Suggests more of the same |

Early mover: the AWS Events API and MCP server went public on 2026-09-23. An AWS developer advocate published a [how-to](https://builder.aws.com/content/3JjrKKy63DJ80xhHTHd50DUIoxx/how-to-plan-reinvent-2026-with-the-new-aws-events-api-and-mcp-server) the same day. It plans through an AI assistant over MCP. We found no hosted avatar concierge on the API yet. Say only that, and recheck it before any launch copy.

White space: we found no conference app that resolves a clash against real, API-backed reservations with a spoken swap. General calendar apps already detect conflicts, so keep the claim this narrow.

## Awe moments, ranked

| # | Moment | Why it lands | Data | Effort |
|---|---|---|---|---|
| 1 | [Conflict swap](EXPERIENCE-UX.md#conflict-swap) with repeats | Answers a real attendee request to "see ALL occurrences" of a session. Marquee explains it face to face while both blocks glow, and a tap or a word fixes it. | `conflictsWith` plus our repeat matching | Medium |
| 2 | [Show and tell](EXPERIENCE-UX.md#talk-type-or-tap) | Marquee points at the card it's talking about and understands "this one". It feels like planning with a person. | Screen context plus `point_at` | Low |
| 3 | Travel check between venues | Shuttle and walking time is the top attendee complaint | Venue mapping plus a static table (see [ARCHITECTURE.md § Search](ARCHITECTURE.md#search)) | Medium |
| 4 | Full-session fallback | Turns "full" into a next step | `seatAvailability`, repeats | Low |
| 5 | Morning briefing | Marquee greets you each morning with your day. Feels like a real concierge, not a search box. | `GetSchedule` plus the keynote list | Low |
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
| Try before pairing, then QR or code pairing | 1 | |
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
