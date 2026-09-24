[← Back to README](README.md)

# Experience and UX

What the attendee sees and hears. Visual rules are in [DESIGN.md](DESIGN.md). The tools behind each moment are in [ARCHITECTURE.md § Tools](ARCHITECTURE.md#tools).

## Rules

- The screen shows only real data. Cards and the schedule come from our Web API, never from what the model remembers.
- Nothing gets booked without a clear yes, spoken or tapped.
- Every answer is short: one to three spoken sentences, and the screen carries the detail.
- A text box is always there, in every mode.

## First run

Attendees can try Marquee before they sign in anywhere.

1. They open the link on their phone. A one-line disclosure says "Marquee is an AI concierge", with a Continue button. That tap calls `acknowledgeDisclosure()` and also counts as the gesture that unlocks audio.
2. Marquee asks one question: "What are you here for?" They can say it or tap up to three chips (for example "Agentic AI", "Serverless", "First time here").
3. Search works right away. Favorites are kept on the device as a shortlist.
4. When they want their real schedule, they tap "Connect my AWS Events account". The phone shows a code and a QR code, and the laptop step is one command (see [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing)).
5. After pairing, the shortlist becomes real AWS favorites, and Marquee says "Your plan is synced".

Why try-first: the laptop step is the biggest drop-off risk. Attendees who have already seen good picks have a reason to do it.

## Voice and chat

One UI, two transports. The same client tools drive the same cards on both.

| | Voice | Chat |
|---|---|---|
| Transport | Avatar session | Chat session |
| Input | Toggle mic button: tap to talk, tap to send. Text box too. | Text box |
| Extra | Captions under the avatar | Follow-up chips from the SDK |
| Good for | Planning at the hotel, a quick question in a hallway | Loud expo floor, weak signal, quiet rooms |

- First open offers "Talk to Marquee" and "Type instead". The app remembers the choice.
- Switching keeps the same conversation. The switch button must be a real tap, because the browser needs one to open the mic.
- Toggle mic, not open mic. The expo floor is loud and full of other voices, and open mic would pick them up. Toggle also works with screen readers. If the push-to-talk spike fails, the mic stays open and the mic button mutes (see [ROADMAP.md § Phase 0](ROADMAP.md#phase-0-spikes)).

## Schedule canvas

The home screen after pairing. On a phone it's one day at a time: a day strip (Mon Nov 30 to Fri Dec 4) above a vertical timeline. On a laptop it's the full week.

| Block | Meaning |
|---|---|
| Solid | Reserved. A seat is held. |
| Outlined | Favorite. No seat. |
| Striped | Personal time |
| Gap with a travel tag | Time to move between venues, when the next session is in another venue |
| Red edge | Two blocks overlap |

The canvas redraws from `GetSchedule` after every change. Tapping a block opens its card.

## Conflict swap

The signature moment. The attendee asks to reserve something that clashes, and Marquee solves it out loud instead of showing an error.

```
Attendee: Reserve the agent workshop on Tuesday.
Marquee:  [highlight_conflict] That clashes with your 2 pm serverless talk.
          The workshop repeats Thursday at 10 at the Wynn, and you're free then.
          Take Thursday, or swap out the serverless talk?
Attendee: Thursday.
Marquee:  [celebrate_action] Done. Thursday at 10, Wynn.
```

How it works:

- `ReserveSessions` returns `scheduleConflict` with `conflictsWith`, the attendee's clashing session IDs (see [AWS-EVENTS-INTEGRATION.md § Bulk results](AWS-EVENTS-INTEGRATION.md#bulk-results)).
- The proxy adds options: repeats of the new session that fit, repeats of the old one that fit, and a direct swap.
- The conflict sheet shows the same options as buttons.
- A direct swap drops the old seat first. If the new session is not `available`, Marquee warns first: "If it fills before I get you in, I'll try to get your old seat back, but I can't promise it."

## Everyday moments

| Moment | What happens |
|---|---|
| Fill my gaps | "What can I do Tuesday afternoon?" Marquee finds sessions that fit the gap, the travel time and the attendee's interests, and shows three to five cards. |
| Travel check | When two blocks are in different venues with too little time between them, the gap tag turns amber and Marquee mentions it once. Times come from a static table (see [ARCHITECTURE.md § Search](ARCHITECTURE.md#search)). |
| Full session | When a session is full, Marquee offers a repeat with seats first. If the session shows `walkUp`, it says walk-up is an option. It never promises a seat. |
| Wildcard | "Surprise me." One session far from the attendee's usual topics that still fits the schedule, shown with a reveal (see [DESIGN.md § Motion](DESIGN.md#motion)). |
| See all times | "When else is this on?" Lists every repeat, marking which ones fit. Attendees ask for this a lot. |

## Personas

Picked at first run or any time ("switch to first-timer mode"). A persona changes tone and default filters only. The tools stay the same.

| Persona | Changes |
|---|---|
| First-timer | Explains logistics without being asked (venues, walking time, reserved vs walk-up). Many attendees are first-timers (see [AWS-EVENTS-INTEGRATION.md § Event facts](AWS-EVENTS-INTEGRATION.md#event-facts)). |
| Builder | Leans toward workshops, chalk talks and 300 to 400 level |
| Leader | Leans toward keynotes, leadership sessions and 100 to 200 level |

## Lifecycle

Marquee detects the phase from API behaviour (see [AWS-EVENTS-INTEGRATION.md § Lifecycle](AWS-EVENTS-INTEGRATION.md#lifecycle)).

| Phase | Marquee's focus |
|---|---|
| Catalog live | Explore and favorite. If asked to reserve: "Reserved seating isn't open yet. I'll keep this on your list." A countdown shows on the home screen. |
| Reserved seating open | Turn favorites into seats. On the first visit after opening: "Seating is open. Six of your favorites are still unreserved. Want to go through them?" |
| Event week | Morning briefing, travel checks and quick fixes. Short answers. |
| After the event | Recap card, then disconnect (see [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing)) |

## Morning briefing

In event week, the first open each day starts with a briefing card, and in voice mode Marquee reads it aloud:

- First session: time, venue and when to leave.
- Keynotes that day, for example the CEO keynote on Tuesday morning.
- Gaps worth filling and any clash.
- One wildcard, if there is a gap.

The briefing is in-app only in v1. Optional push notifications come later and need the app on the Home Screen on iOS (see [ROADMAP.md](ROADMAP.md)). A notification would open the text card, and voice stays one tap away.

## Recap card

On the last day, or when asked: "Your re:Invent: 14 sessions, 3 venues, 1 wildcard." It's a shareable image through the Web Share sheet. It holds only the attendee's own numbers, no session codes and no AWS marks beyond the plain event name.

## Network and backgrounding

| Situation | What the attendee sees |
|---|---|
| Autoplay blocked | A "Tap to hear Marquee" button |
| Mic denied | A banner to turn it on in settings. Typing still works. |
| Weak network | The app tries TURN over TCP 443. If voice still fails: "Signal's weak here. Switching to chat." Then it switches, keeping the conversation. |
| App in the background under 30 s | Nothing. The session holds. |
| Back after longer | "Welcome back" and a quiet reconnect. No first-visit greeting. |
| Token expired | "I need you to reconnect your AWS account", with the pairing button |

## Accessibility

- Captions on by default in voice mode (`CaptionService`).
- The disclosure is a real dialog and must be accepted before the avatar talks.
- Mic state shows three ways: icon, level meter and an `aria-live` text update.
- The toast region (`role="status"`, `aria-live="polite"`) reads what changed after each tool call, for example "Schedule updated. Workshop added Thursday 10 am."
- Every control is a real `<button>` or `<label>`, with a tap target of at least 44 px.
- Colour contrast meets WCAG AA. Motion follows `prefers-reduced-motion` (see [DESIGN.md](DESIGN.md)).
