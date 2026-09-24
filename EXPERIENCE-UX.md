[← Back to README](README.md)

# Experience and UX

What the attendee sees and hears. Visual rules are in [DESIGN.md](DESIGN.md). The tools behind each moment are in [ARCHITECTURE.md § Tools](ARCHITECTURE.md#tools).

## Rules

- Juno is live on screen for the whole visit, and the screen shows what she's talking about.
- Talk, type or tap, in any order, at any time. All three are turns in the same conversation.
- The screen shows only real data. Cards and the schedule come from our Web API, never from what the model remembers.
- Nothing gets booked without a clear yes, spoken, typed or tapped.
- Every answer is short: one to three spoken sentences, and the screen carries the detail.

## First run

Attendees can try Juno before they sign in anywhere.

1. They open the link on their phone. The avatar frame and the composer are already there. A one-line disclosure says "Juno is an AI concierge", with a Continue button. That tap calls `acknowledgeDisclosure()` and also counts as the gesture that unlocks audio. Juno's live video fades in and she says hello.
2. Juno asks one question: "What are you here for?" They can say it, type it, or tap up to three chips (for example "Agentic AI", "Serverless", "First time here"). The mic permission prompt appears only when they first tap the mic.
3. Search works right away. Favorites are kept on the device as a shortlist.
4. When they want their real schedule, they tap "Connect my AWS Events account". The phone shows a code and a QR code, and the laptop step is one command (see [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing)).
5. After pairing, the shortlist becomes real AWS favorites, and Juno says "Your plan is synced".

Why try-first: the laptop step is the biggest drop-off risk. Attendees who have already seen good picks have a reason to do it.

## Talk, type or tap

Juno is a person-shaped host, not a voice assistant with a chat box. Each input is a turn, and Juno answers face to face, out loud and with captions.

| Input | How | Good for |
|---|---|---|
| Talk | Toggle mic: tap to talk, tap to send | The hotel room, a hallway, planning on the go |
| Type | The composer, always on screen | Quiet rooms, a loud floor, exact session codes |
| Tap | Chips, card buttons, conflict options | Fast choices. The tap is sent as a turn, so Juno answers and the screen updates. |
| Look | Opening a card, switching days, scrolling | Not a turn. Juno just knows what's on screen. |

- **Juno sees what you see.** With a card open, "book this one" or "what else is on then?" just works. The page tells Juno which sessions are on screen, as IDs only.
- **Juno points.** When she talks about one card or block on screen, a ring lights it (see [DESIGN.md § Components](DESIGN.md#components)).
- **Interrupt like a person.** Typing or tapping while Juno talks stops her, and she answers the new turn. During her opening line, the turn waits until the line ends.
- **Taps carry a label.** A card's Reserve button sends a turn such as "Reserve Multi-agent systems in production (session ABC123)", so Juno knows exactly which one. The tap counts as the clear yes.
- **Your words, then Juno's.** The attendee's own line shows on the frame after they finish speaking. There is no live transcript while they talk. The aura behind Juno grows with their voice, so they can see she hears them.
- **Quiet mode.** The voice toggle on the frame mutes Juno's voice. The video and captions carry on, and the attendee types. For session rooms and the shuttle.
- **Toggle mic, not open mic.** The expo floor is loud and full of other voices, and open mic would pick them up. Toggle also works with screen readers. If the push-to-talk spike fails, the mic stays open and the mic button mutes (see [ROADMAP.md § Phase 0](ROADMAP.md#phase-0-spikes)).
- **While the mic is capturing,** typed and tapped turns don't send. The composer and a toast say "Listening. Tap the mic to finish." Typed text stays in the field, and a tap needs a second tap after the capture.
- **Chat fallback** is only for when video can't run (see [§ Network and backgrounding](#network-and-backgrounding)). Juno's last frame stays as a still, replies arrive as text in the caption area, and the conversation carries on. "Try video" goes back, and it must be a real tap.

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

The signature moment. The attendee asks to reserve something that clashes, and Juno solves it out loud instead of showing an error.

```
Attendee: Reserve the agent workshop on Tuesday.
Juno:     [highlight_conflict] That clashes with your 2 pm serverless talk.
          The workshop repeats Thursday at 10 at the Wynn, and you're free then.
          Take Thursday, or swap out the serverless talk?
          (The sheet rises under Juno with both blocks and the options.)
Attendee: (taps "Thursday 10:00, Wynn", or says "Thursday")
Juno:     [celebrate_action] Done. Thursday at 10, Wynn.
```

How it works:

- `ReserveSessions` returns `scheduleConflict` with `conflictsWith`, the attendee's clashing session IDs (see [AWS-EVENTS-INTEGRATION.md § Bulk results](AWS-EVENTS-INTEGRATION.md#bulk-results)).
- The proxy adds options: repeats of the new session that fit, repeats of the old one that fit, and a direct swap.
- The conflict sheet shows the same options as buttons. A tap sends the option as a turn.
- A direct swap drops the old seat first. If the new session is not `available`, Juno warns first: "If it fills before I get you in, I'll try to get your old seat back, but I can't promise it."

## Everyday moments

| Moment | What happens |
|---|---|
| Fill my gaps | "What can I do Tuesday afternoon?" Juno finds sessions that fit the gap, the travel time and the attendee's interests, and shows three to five cards. |
| Travel check | When two blocks are in different venues with too little time between them, the gap tag turns amber and Juno mentions it once. Times come from a static table (see [ARCHITECTURE.md § Search](ARCHITECTURE.md#search)). |
| Full session | When a session is full, Juno offers a repeat with seats first. If the session shows `walkUp`, she says walk-up is an option. She never promises a seat. |
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

Juno detects the phase from API behaviour (see [AWS-EVENTS-INTEGRATION.md § Lifecycle](AWS-EVENTS-INTEGRATION.md#lifecycle)).

| Phase | Juno's focus |
|---|---|
| Catalog live | Explore and favorite. If asked to reserve: "Reserved seating isn't open yet. I'll keep this on your list." A countdown shows on the home screen. |
| Reserved seating open | Turn favorites into seats. On the first visit after opening: "Seating is open. Six of your favorites are still unreserved. Want to go through them?" |
| Event week | Morning briefing, travel checks and quick fixes. Short answers. |
| After the event | Recap card, then disconnect (see [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing)) |

## Morning briefing

In event week, the first open each day starts face to face. Juno greets the attendee at stage size and gives the briefing, while the day's timeline fills in below it:

- First session: time, venue and when to leave.
- Keynotes that day, for example the CEO keynote on Tuesday morning.
- Gaps worth filling and any clash.
- One wildcard, if there is a gap.

The briefing is in-app only in v1. Optional push notifications come later and need the app on the Home Screen on iOS (see [ROADMAP.md](ROADMAP.md)). A notification opens the app, and Juno starts the briefing.

## Recap card

On the last day, or when asked: "Your re:Invent: 14 sessions, 3 venues, 1 wildcard." It's a shareable image through the Web Share sheet. It holds only the attendee's own numbers, no session codes and no AWS marks beyond the plain event name.

## Network and backgrounding

| Situation | What the attendee sees |
|---|---|
| Autoplay blocked | "Tap anywhere to hear Juno" on the frame. Any tap or button press starts the sound. |
| Mic denied | "Mic is off. You can still type, and Juno answers out loud." |
| Video stalls | Blurred last frame and "Reconnecting…" on the frame |
| Weak network | The app tries TURN over TCP 443. If video still fails: "Signal's weak here. Switching to text." Then it switches to the chat fallback, keeping the conversation. |
| App in the background under 30 s | Nothing. The session holds. |
| Back after longer | "Welcome back" and a quiet reconnect. No first-visit greeting. |
| Token expired | "I need you to reconnect your AWS account", with the pairing button |

## Accessibility

- Captions are on by default, on the avatar frame. Screen readers skip them, because Juno's voice already says the same words. In quiet mode they become a live region. Notices with no voice, like "Mic is off", also go to the toast region.
- Anything you can say, you can type or tap. The whole plan works by keyboard.
- The disclosure is a real dialog and must be accepted before the avatar talks.
- Mic state shows three ways: icon, level ring on the frame and `aria-pressed` on the mic button.
- The toast region (`role="status"`, `aria-live="polite"`) reads what changed after each tool call, for example "Schedule updated. Workshop added Thursday 10 am."
- Every control is a real `<button>` or `<label>`, with a tap target of at least 44 px.
- Colour contrast meets WCAG AA. Motion follows `prefers-reduced-motion` (see [DESIGN.md](DESIGN.md)).
