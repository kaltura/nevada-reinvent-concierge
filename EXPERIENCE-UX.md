[← Back to README](README.md)

# Experience and UX

What the attendee sees and hears. Visual rules are in [DESIGN.md](DESIGN.md). The tools behind each moment are in [ARCHITECTURE.md § Tools](ARCHITECTURE.md#tools).

## Rules

- Nevada is live on screen for the whole visit, and the screen shows what she's talking about.
- Talk, type or tap, in any order, at any time. All three are turns in the same conversation.
- The screen shows only real data. Blocks and the schedule come from our Web API, never from what the model remembers.
- Nothing gets booked without a clear yes, spoken, typed or tapped.
- Every answer is short: one to three spoken sentences, and the screen carries the detail.

## First run

There's no avatar and nothing to search until AWS pairing succeeds. Nevada needs a real account to build a real plan, and a stale spoken greeting from before pairing would be confusing anyway. So the entire experience sits behind a connect gate.

1. They open the link on whatever device is at hand. The gate shows Nevada's mark and "Connect your AWS Events account and I'll build your plan for the week", with a single "Connect my AWS Events account" button. No QR code here. They're already on this device.
2. They tap it. The gate shows a 6-character code and one command to copy and run in a terminal on that same device (see [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing)).
3. Once paired, a success screen offers a "Show a QR for my phone" button to continue the live conversation there instead, or a "Continue here" button to stay on the current device (see [ARCHITECTURE.md § Phone handoff](ARCHITECTURE.md#phone-handoff)).
4. Whichever device continues: a one-line disclosure says "Nevada is an AI concierge", with a Continue button. That tap calls `acknowledgeDisclosure()` and also counts as the gesture that unlocks audio. Nevada's live video fades in and she opens with: "Hi, I'm Nevada. I've picked a few sessions for each day to get you started. Tell me if you're deep into a track like agentic AI or serverless, and I'll build around that instead." (If the attendee has already favorited or reserved sessions with a clear topic, she opens by naming that topic instead.) They can say a track or type it. The mic permission prompt appears only when they first tap the mic.

## Talk, type or tap

Nevada is a person-shaped host, not a voice assistant with a chat box. Each input is a turn, and Nevada answers face to face, out loud and with captions.

| Input | How | Good for |
|---|---|---|
| Talk | Tap once to start the mic, then just talk. Tap again to mute | The hotel room, a hallway, planning on the go |
| Type | The composer, always on screen | Quiet rooms, a loud floor, exact session codes |
| Tap | Chips, timeline blocks, conflict options | Fast choices. The tap is sent as a turn, so Nevada answers and the screen updates. |
| Look | Switching days, scrolling | Not a turn. Nevada just knows what's on screen. |

- **Nevada sees what you see.** With a block on screen, "book this one" or "what else is on then?" just works. The page tells Nevada which sessions are on screen, as IDs only.
- **Nevada points.** When she talks about one block on screen, a ring lights it (see [DESIGN.md § Components](DESIGN.md#components)).
- **Interrupt like a person.** Typing or tapping while Nevada talks stops her, and she answers the new turn. During her opening line, the turn waits until the line ends.
- **Taps carry a label.** Tapping a block sends a turn such as "Tell me more about Multi-agent systems in production (session ABC123)", so Nevada knows exactly which one. She still needs a spoken or typed yes before booking anything.
- **Your words, then Nevada's.** The attendee's own line shows on the frame after they finish speaking. There is no live transcript while they talk. The aura behind Nevada grows with their voice, so they can see she hears them.
- **Quiet mode.** The voice toggle on the frame mutes Nevada's voice. The video and captions carry on, and the attendee types. For session rooms and the shuttle.
- **Open mic, not push-to-talk.** The first tap starts the mic and it stays open, so nobody has to hold or re-tap it for every turn. The same button mutes and unmutes, and `aria-pressed` keeps it clear for screen readers.
- **Typing and tapping still work while the mic is open.** Nothing is blocked or queued: whichever turn arrives first, spoken, typed or tapped, is the one Nevada answers.
- **Chat fallback** for when video can't run is planned, not yet built (see [§ Network and backgrounding](#network-and-backgrounding)). The plan: Nevada's last frame stays as a still, replies arrive as text in the caption area, the conversation carries on, and "Try video" goes back with a real tap.

## Schedule canvas

The home screen after pairing. On a phone it's one day at a time: a day strip (Mon Nov 30 to Fri Dec 4) above a vertical timeline. On a laptop it's the full week.

| Block | Meaning |
|---|---|
| Solid | Reserved. A seat is held. |
| Outlined | Favorite. No seat. |
| Striped | Personal time |
| Dashed | Nevada's pick: a topic-based suggestion, or a session from her last `show_sessions` call, shown in its real day and time |
| Gap with a travel tag | Time to move between venues, when the next session is in another venue |
| Red edge | Two blocks overlap |

The canvas redraws from `GetSchedule` after every change. Tapping a block asks Nevada to tell you more about it; she answers and points at it rather than opening anything new.

Each session block shows its level and AWS session code, for example `L300 AIM301`. Favorites and personal time carry a × that removes them after one confirm tap, with no turn for Nevada. On touch screens the × always shows. With a mouse or keyboard it shows on hover or focus. A favorite removed this way isn't suggested back in its old slot, unless Nevada shows it again.

A favorite AWS hasn't scheduled yet has no day or time, so it can't go in the grid. It shows instead as a horizontal strip below the timeline, "Favorited, not yet scheduled", visible no matter which day is selected.

## Conflict swap

The signature moment. The attendee asks to reserve something that clashes, and Nevada solves it out loud instead of showing an error.

```
Attendee: Reserve the agent workshop on Tuesday.
Nevada:     [highlight_conflict] That clashes with your 2 pm serverless talk.
          The workshop repeats Thursday at 10 at the Wynn, and you're free then.
          Take Thursday, or swap out the serverless talk?
          (The sheet rises under Nevada with both blocks and the options.)
Attendee: (taps "Thursday 10:00, Wynn", or says "Thursday")
Nevada:     [celebrate_action] Done. Thursday at 10, Wynn.
```

How it works:

- `ReserveSessions` returns `scheduleConflict` with `conflictsWith`, the attendee's clashing session IDs (see [AWS-EVENTS-INTEGRATION.md § Bulk results](AWS-EVENTS-INTEGRATION.md#bulk-results)).
- The proxy adds options: repeats of the new session that fit, repeats of the old one that fit, and a direct swap.
- The conflict sheet shows the same options as buttons. A tap sends the option as a turn.
- A direct swap drops the old seat first. If the new session is not `available`, Nevada warns first: "If it fills before I get you in, I'll try to get your old seat back, but I can't promise it."

## Everyday moments

| Moment | What happens |
|---|---|
| Fill my gaps | "What can I do Tuesday afternoon?" Nevada finds sessions that fit the gap, the travel time and the attendee's interests, and highlights three to five in the day/week grid. |
| Travel check | When two blocks are in different venues with too little time between them, the gap tag turns amber and Nevada mentions it once. Times come from a static table (see [ARCHITECTURE.md § Search](ARCHITECTURE.md#search)). |
| Full session | When a session is full, Nevada offers a repeat with seats first. If the session shows `walkUp`, she says walk-up is an option. She never promises a seat. |
| Wildcard | "Surprise me." One session far from the attendee's usual topics that still fits the schedule, shown as a normal dashed suggested block (see [DESIGN.md § Fun moments](DESIGN.md#fun-moments)). |
| See all times | "When else is this on?" Lists every repeat, marking which ones fit. Attendees ask for this a lot. |

## Personas

Picked at first run or any time ("switch to first-timer mode"). A persona changes tone and default filters only. The tools stay the same.

| Persona | Changes |
|---|---|
| First-timer | Explains logistics without being asked (venues, walking time, reserved vs walk-up) |
| Builder | Leans toward workshops, chalk talks and 300 to 400 level |
| Leader | Leans toward keynotes, leadership sessions and 100 to 200 level |

## Lifecycle

Nevada detects the phase from API behaviour (see [AWS-EVENTS-INTEGRATION.md § Lifecycle](AWS-EVENTS-INTEGRATION.md#lifecycle)).

| Phase | Nevada's focus |
|---|---|
| Catalog live | Explore and favorite. If asked to reserve: "Reserved seating isn't open yet. I'll keep this on your list." A countdown shows on the home screen. |
| Reserved seating open | Turn favorites into seats, on request. A proactive greeting on the first visit after opening ("Seating is open. Six of your favorites are still unreserved. Want to go through them?") is planned, not yet built. |
| Event week | Travel checks and quick fixes, on request. Short answers. A morning briefing (see [§ Morning briefing](#morning-briefing)) is planned, not yet built. |
| After the event | A recap card is available on request (see [§ Recap card](#recap-card)). Disconnecting the AWS account is a manual action, a "Disconnect this AWS account" button in the dialog the header's Connect pill opens, not an automatic post-event step. |

## Morning briefing

Planned, not yet built. In event week, the plan is for the first open each day to start face to face: Nevada greets the attendee and gives a briefing, while the day's timeline fills in below her:

- First session: time, venue and when to leave.
- Keynotes that day, for example the CEO keynote on Tuesday morning.
- Gaps worth filling and any clash.
- One wildcard, if there is a gap.

The briefing would be in-app only at first. Optional push notifications would come later and need the app on the Home Screen on iOS (see [ROADMAP.md](ROADMAP.md)). A notification would open the app, and Nevada would start the briefing.

## Recap card

On request: "Your re:Invent: 14 sessions, 3 venues, 1 wildcard." It's a shareable image through the Web Share sheet. It holds only the attendee's own numbers, no session codes and no AWS marks beyond the plain event name. Showing it automatically on the last day is planned, not yet built.

## Network and backgrounding

| Situation | What the attendee sees |
|---|---|
| Autoplay blocked | "Tap anywhere to hear Nevada" on the frame. Any tap or button press starts the sound. |
| Mic denied | "Mic is off. You can still type, and Nevada answers out loud." |
| Video stalls | Blurred last frame and "Reconnecting…" on the frame. If it doesn't clear within 5 s: "Lost connection to Nevada. Reload to reconnect." |
| Weak network | A chat fallback that keeps the conversation going as text is planned, not yet built. Today, a stalled connection follows the "Video stalls" row above. |
| App in the background under 30 s | Nothing. The session holds. |
| Back after longer | "Welcome back" and a quiet reconnect. No first-visit greeting. |
| Token expired | A toast: "Your AWS connection lapsed. Reconnect to keep going." If it happens mid-conversation, Nevada may also say "Your AWS connection expired. Pair again to see your schedule." Tap Connect in the header to pair again. |

## Accessibility

- Captions are on by default, on the avatar frame. Screen readers skip them, because Nevada's voice already says the same words. In quiet mode they become a live region. Notices with no voice, like "Mic is off", also go to the toast region.
- Anything you can say, you can type or tap. The whole plan works by keyboard.
- The disclosure is a real dialog and must be accepted before the avatar talks.
- Mic state shows three ways: icon, the aura growing on the frame with mic level, and `aria-pressed` on the mic button.
- The toast region (`role="status"`, `aria-live="polite"`) echoes what changed after a booking, favorite or swap, for example "You're in." or "Saved."
- Every control is a real `<button>` or `<label>`, with a tap target of at least 44 px.
- Colour contrast meets WCAG AA. Motion follows `prefers-reduced-motion` (see [DESIGN.md](DESIGN.md)).
