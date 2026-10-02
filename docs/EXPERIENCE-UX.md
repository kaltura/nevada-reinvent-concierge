[← Back to README](../README.md)

# Experience and UX

What the attendee sees and hears. Visual rules are in [DESIGN.md](DESIGN.md). The tools behind each moment are in [ARCHITECTURE.md § Tools](ARCHITECTURE.md#tools). What's built and what's planned is in [§ Status](#status).

## Rules

- Nevada is live on screen for the whole visit, and the screen shows what she's talking about.
- Talk, type or tap, in any order, at any time. All three are turns in the same conversation.
- The screen shows only real data. Blocks and the schedule come from our Web API, never from what the model remembers.
- Nothing gets booked without a clear yes, spoken, typed or tapped.
- Every answer is short: one to three spoken sentences, and the screen carries the detail.

## First run

There's no avatar and nothing to search until AWS sign-in succeeds. Nevada needs a real account to build a real plan, and a stale spoken greeting from before sign-in would be confusing anyway. So the entire experience sits behind a sign-in gate.

1. They run `npx nevada-reinvent`. The browser opens on the gate: Nevada's mark and "Sign in with your AWS Events account and I'll build your plan for the week", with a single "Sign in with AWS" link and the line "Your sign-in stays on this computer."
2. They sign in with AWS Builder ID. AWS sends the browser back to the app, which reloads on the home screen (see [ARCHITECTURE.md § Sign-in](ARCHITECTURE.md#sign-in)). There's no code to copy. If sign-in fails, the gate shows a toast and the link works again (the toasts are listed in [ARCHITECTURE.md § Sign-in](ARCHITECTURE.md#sign-in)).
3. A one-line disclosure says "Nevada is an AI concierge", with a Continue button. That tap calls `acknowledgeDisclosure()` and also counts as the gesture that unlocks audio. Nevada's live video fades in and she opens with: "Hi, I'm Nevada. I've picked a few sessions for each day to get you started. Tell me if you're deep into a track like agentic AI or serverless, and I'll build around that instead." (If the attendee has already favorited or reserved sessions with a clear topic, she opens by naming that topic instead.) They can say a track or type it. The mic permission prompt appears only when they first tap the mic.

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
- **Chat fallback** for when video can't run is planned (see [§ Status](#status)). The plan: Nevada's last frame stays as a still, replies arrive as text in the caption area, the conversation carries on, and "Try video" goes back with a real tap.

## Schedule canvas

The home screen after sign-in. In a narrow window it's one day at a time: a day strip (Mon Nov 30 to Fri Dec 4) above a vertical timeline. In a wide window it's the full week.

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

Prompt text only (`prompts/target-audience.md`), no setting on the page. Nevada assumes First-timer until the attendee says otherwise ("switch to builder mode") or a discovery question places them by job, experience or goal. A persona changes tone and default filters only. The tools stay the same.

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
| Reserved seating open | Turn favorites into seats, on request. A greeting on the first visit after opening is planned (see [§ Status](#status)). |
| Event week | Travel checks and quick fixes, on request. Short answers. A morning briefing is planned (see [§ Status](#status)). |
| After the event | A recap card is available on request (see [§ Recap card](#recap-card)). Signing out is a manual action: the "Sign out of AWS Events" button in the dialog the header pill ("Signed in") opens. It is not an automatic post-event step. |

## Recap card

On request ("show my recap"). A card with the attendee's session count, venues, days and busiest day, plus a Share button. Share opens the system share sheet with a one-line summary, or copies that line where there is no share sheet. It holds only the attendee's own numbers, no session codes and no AWS marks beyond the plain event name.

## Status

Built and shipped in `nevada-reinvent`:

- Sign-in gate, disclosure, opening line, "Welcome back" after the background grace
- Talk, type and tap as turns; open mic with mute; quiet mode; captions; screen context and `point_at`
- Schedule canvas with day and week views, travel tags, clash edges and the "not yet scheduled" strip
- Search, fill my gaps, see all times, wildcard, full-session repeats
- Favorite, reserve, cancel, swap with the conflict sheet, personal time
- Recap card with Share
- Lifecycle phases, countdown and the "Signed in, but ..." banner

Planned, not yet built:

| Idea | What it adds |
|---|---|
| Chat fallback | Keeps the conversation going as text when video can't run, in the same thread |
| Seating-open greeting | On the first visit after seating opens: "Seating is open. Six of your favorites are still unreserved. Want to go through them?" |
| Morning briefing | In event week, the first open each day starts with Nevada's briefing: first session and when to leave, keynotes, gaps worth filling, any clash and one wildcard. In-app only, while the tab is open. |
| Recap on the last day | Nevada offers the recap card herself instead of waiting to be asked |
| Wildcard reveal | A small flourish when the wildcard block lands |
| Clash nudge | The red edge pulses once and Nevada mentions the clash unprompted |

Not planned:

| Idea | Why not |
|---|---|
| Team planning | Each teammate signs in on their own laptop. Heavy for a first release. |
| Maps and directions | Not in the API. The official app already does it well. |
| Phone and tablet support | The app runs on the attendee's own computer, so a phone has nothing to connect to. |
| Push notifications | The app runs only while the terminal command is running, so it can't wake a device. |
| Popularity score | The API gives only a seat band, not numbers. |
| Speaker follow | Speakers are bare names with no ID, so matches would misfire. |
| Live keynote watching | Out of scope for a planning tool. |

## Network and backgrounding

| Situation | What the attendee sees |
|---|---|
| Autoplay blocked | "Tap anywhere to hear Nevada" on the frame. Any tap or button press starts the sound. |
| Mic denied | "Mic is off. You can still type, and Nevada answers out loud." |
| Video stalls | Blurred last frame and "Reconnecting…" on the frame. If it doesn't clear within 5 s: "Lost connection to Nevada. Reload to reconnect." |
| Weak network | A chat fallback that keeps the conversation going as text is planned, not yet built. Today, a stalled connection follows the "Video stalls" row above. |
| App in the background under 30 s | Nothing. The session holds. |
| Back after longer | "Welcome back" and a quiet reconnect. No first-visit greeting. |
| Sign-in lapsed | A toast: "Your AWS sign-in expired. Sign in again to keep going." The avatar session and mic end, the header pill goes back to "Sign in" and the sign-in gate shows. This includes a lapse mid-conversation. |
| Signed in, but AWS refused the schedule | The experience still starts, so Nevada can answer catalog questions. A banner that stays on screen says "Signed in, but ..." with the reason, for example "AWS says you are not registered" or "AWS is busy, try again in a minute". Before 8 October it says the AWS schedule opens on 8 October. |

## Accessibility

- Captions are on by default, on the avatar frame. Screen readers skip them, because Nevada's voice already says the same words. In quiet mode they become a live region. Notices with no voice, like "Mic is off", also go to the toast region.
- Anything you can say, you can type or tap. The whole plan works by keyboard.
- The disclosure is a real dialog and must be accepted before the avatar talks.
- Mic state shows three ways: icon, the aura growing on the frame with mic level, and `aria-pressed` on the mic button.
- The toast region (`role="status"`, `aria-live="polite"`) echoes what changed after a booking, favorite or swap, for example "You're in." or "Saved."
- Every control is a real `<button>` or `<label>`, with a tap target of at least 44 px.
- Colour contrast meets WCAG AA. Motion follows `prefers-reduced-motion` (see [DESIGN.md](DESIGN.md)).
