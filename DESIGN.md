[← Back to README](README.md)

# Design

How Marquee looks, moves and feels. Mobile first. What each screen does is in [EXPERIENCE-UX.md](EXPERIENCE-UX.md). The tokens live in `client/styles.css`, and `client/prototype.html` shows them in use.

## Idea

A Las Vegas theatre marquee for your week. Marquee is the host: a realistic avatar you plan with face to face. Your schedule is the show it presents. Dark stage, a glowing keynote-hall gradient around the host, and small bright moments when something goes right.

| Principle | In practice |
|---|---|
| Face to face | Marquee is live on screen for the whole visit. It changes size but never hides or shrinks to an icon. |
| Show and tell | When Marquee talks about a session, that session is on screen and glows. |
| Talk, type or tap | Every input is a turn in one conversation. No mode to pick first. |
| Thumb first | The composer and main actions sit in the bottom third |
| Glow means Marquee | The gradient appears only around Marquee, on what it points at, and in surprise moments |
| Calm, then a spark | Plain screens most of the time. Motion is saved for bookings, swaps and reveals. |

## Brand boundaries

AWS's [trademark guidelines](https://aws.amazon.com/trademark-guidelines/) set these rules.

| Rule | Source |
|---|---|
| No AWS or Amazon logo, smile or arrow shape, anywhere | §10, §13 |
| No AWS Architecture Icons. Use our own simple icons. | Icons fall under the same guidelines |
| "re:Invent" never in our name, logo or domain. A URL path such as `/reinvent` is fine. | §7, §11 |
| Refer to the event in plain text: "for AWS re:Invent attendees" | §13 |
| Show "Not affiliated with or endorsed by AWS" on the landing page, the About sheet and the pairing page | §13 |
| Don't copy AWS's product look. Orange is a small accent, not the whole UI. | §10 |

Our mark is a rounded rectangle with a ring of marquee bulbs and a bold "M". The bulbs use the accent gradient. It contains no AWS shape.

## Tokens

### Colour: base layer

Dark UI with AWS-style orange for the one main action per screen.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#121212` | Page |
| `--surface` | `#242424` | Cards, sheets |
| `--elevated` | `#333333` | Raised controls, inputs |
| `--text` | `#FFFFFF` | Main text |
| `--muted` | `#CCCCCC` | Secondary text |
| `--primary` | `#FF9900` | One main button per screen. Text on it is `--bg`. |
| `--primary-hover` | `#EC7211` | Pressed and hover |
| `--ink` | `#232F3E` | Text on light chips |
| `--danger` | `#CA1C2D` | Fills with white text only |
| `--danger-text` | `#FF5C5C` | Red text and the conflict edge |
| `--success` | `#00A078` | Reserved check, success toast |
| `--warning` | `#E86925` | Travel tag when time is tight |

### Colour: event layer

Sampled from AWS's own 2026 re:Invent art: deep navy and a blue to violet to pink glow. Use it only for Marquee moments (the avatar frame, point ring, wildcard, celebrate, countdown, recap).

| Token | Hex |
|---|---|
| `--night-1` to `--night-4` | `#000036`, `#010040`, `#02010A`, `#0A011C` |
| `--glow-blue` | `#0033B4` |
| `--glow-violet` | `#6B4FFF` |
| `--glow-lavender` | `#9A83FE` |
| `--glow-pink` | `#FB81CE` |
| `--glow` | `linear-gradient(135deg, #0033B4, #6B4FFF 40%, #9A83FE 70%, #FB81CE)` |

### Contrast

Checked against WCAG AA (4.5:1 for body text).

| Pair | Ratio | OK for |
|---|---|---|
| `--text` on `--bg` | 18.7 | All text |
| `--muted` on `--elevated` | 7.9 | All text |
| `--bg` on `--primary` | 8.8 | Button labels |
| `--glow-lavender` on `--bg` | 6.3 | Text |
| `--glow-pink` on `--bg` | 8.2 | Text |
| white on `--glow-violet` | 5.0 | Button labels |
| `--glow-violet` on `--bg` | 3.7 | Glow and borders only, never text |
| `--danger` on `--bg` | 3.3 | Never text. Use `--danger-text` (6.2). |

### Type

Inter, from Google Fonts. Amazon Ember is proprietary, so we don't use it.

| Role | Size / line | Weight |
|---|---|---|
| Display (countdown, recap numbers) | 48 / 52 | 800 |
| Title | 24 / 30 | 800 |
| Section | 18 / 24 | 600 |
| Body | 16 / 24 | 400 |
| Caption, meta | 13 / 18 | 400 |
| Kicker (day, venue) | 12 / 16, caps, +0.08em | 600 |
| Light numeral (dates next to a bold day) | Same as its label | 300 |

The contrast of bold with light echoes the event's wordmark style without copying it. For example, "**Tuesday** Dec 1" puts the day in 800 and the date in 300. Times use `font-variant-numeric: tabular-nums`, so columns line up.

### Space, shape, depth

| Token | Value |
|---|---|
| Spacing | 4, 8, 12, 16, 24, 32, 48 px |
| `--radius-s` / `-m` / `-l` | 8 / 14 / 22 px |
| `--tap` | 44 px minimum |
| Elevation | Surfaces get lighter, with no heavy shadows. Sheets get `0 -8px 32px rgb(0 0 0 / .5)`. |

## Layout

| Width | Layout |
|---|---|
| Under 600 px (phones) | One column: avatar frame, content, composer |
| 600 to 1023 px | Avatar and composer in a 320 px left column. One day of content on the right. |
| 1024 px and up | Avatar and composer in a 400 px left column. Full week grid on the right. |

Phone home screen, avatar at split size:

```
┌──────────────────────────────┐
│ [M] Marquee        12 days ◆ │  top bar: mark, countdown
│ ╭──────────────────────────╮ │
│ │ AI      (face)      vol  │ │  avatar frame, split size
│ │ "Your 11:30 clashes.     │ │  captions on the frame
│ │  Want me to fix it?"     │ │
│ ╰──────────────────────────╯ │
│  MON  TUE  WED  THU  FRI     │  day strip, today underlined
│  30   ▔1▔   2    3    4      │
├──────────────────────────────┤
│ 9:00 ┃ Keynote          MGM  │  solid = reserved
│10:30 ┆ Serverless 301   WYN  │  outlined = favorite
│      ├ 35 min walk ⚠ ────────┤  travel tag
│11:30 ┃ Agents workshop  VEN ▌│  ring = Marquee points here
│12:30 ▒ Lunch ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  striped = personal time
├──────────────────────────────┤
│ [Fix my clash] [Fill Tue pm] │  suggestion chips
│ ( Ask Marquee…        )  (◉) │  composer: text field, mic
└──────────────────────────────┘
```

First run, avatar at stage size:

```
┌──────────────────────────────┐
│ [M] Marquee        12 days ◆ │
│ ╭──────────────────────────╮ │
│ │ AI                  vol  │ │
│ │                          │ │
│ │          (face)          │ │  avatar frame, stage size
│ │                          │ │
│ │ "Hi, I'm Marquee. What   │ │
│ │  are you here for?"      │ │
│ ╰──────────────────────────╯ │
│ [Agentic AI] [Serverless] [F │  chips send exactly this text
│ ( Ask Marquee…        )  (◉) │
└──────────────────────────────┘
```

Desktop:

```
┌──────────────────────────────────────────────────────────┐
│ [M] Marquee                                    12 days ◆ │
├──────────────────┬───────────────────────────────────────┤
│ ╭──────────────╮ │  MON 30   TUE 1   WED 2   THU 3  FRI 4 │
│ │ AI      vol  │ │  ┃ Keynote  ┆ Serv.   ┃ Agents          │
│ │    (face)    │ │  ▒ Lunch   ┃ Work.   ┆ Data            │
│ │ "captions"   │ │  Cards open in place.                  │
│ ╰──────────────╯ │                                        │
│ [chips]          │                                        │
│ ( Ask… )     (◉) │                                        │
└──────────────────┴───────────────────────────────────────┘
```

- Use `100dvh` and `env(safe-area-inset-*)` so the composer clears the home bar and the notch.
- The composer stays fixed at the bottom. The content scrolls.

### Avatar frame

One frame holds Marquee's live video for the whole visit. The page changes its size with a `data-avatar` attribute. The video element never moves in the DOM, because moving it pauses playback.

| Size (phone) | When | Box |
|---|---|---|
| `stage` | Nothing to show yet: first run and the morning greeting. Once content is on screen the frame stays at `split` or `tile`. | Full width, 56% of the height |
| `split` | Cards, a day, the conflict sheet or the recap are on screen | Full width band, 30% of the height (at least 180 px) |
| `tile` | The attendee scrolls content down, or reads a card's detail | 96 × 128 px, top right, over the content. Tap it to go back to `split`. |

- Tablet and desktop always show the full frame in the left column. No `tile`.
- `object-fit: cover` with `object-position: 50% 25%` keeps the face in the `split` crop. Tune it in the iPhone spike once we see the real stream shape.
- An "AI" chip sits on the top left of the frame at every size. The voice toggle (quiet mode) sits top right, hidden at `tile`.
- A sheet never covers the frame. In `split`, a sheet's top stops below the frame.
- Before the first frame arrives, the frame shows the night gradient with the mark. When video stops (reconnect, chat fallback), the last frame stays as a still.
- If the cut-out spike passes (see [ROADMAP.md § Phase 0](ROADMAP.md#phase-0-spikes)), Marquee stands on our night gradient with no box at `stage` size. Otherwise the avatar's own background shows inside the rounded frame.

## Components

| Component | Look | Notes |
|---|---|---|
| Top bar | Mark, name, countdown pill | The countdown uses `--glow` text |
| Avatar frame | Rounded `--radius-l` box on the night gradient, live video, "AI" chip, voice toggle, `--glow` edge | Sizes and rules in [§ Avatar frame](#avatar-frame). States below. |
| Captions | Marquee's current sentence in `--text` on the frame's lower third, over a dark fade. Your own last line shows first in `--glow-lavender`. | Moves above the composer at `tile` size. Timing is per sentence, not per word. |
| Composer | Pill text field on `--elevated`, 56 px round mic on the right. With text in the field, the mic becomes Send in `--primary`. | Always visible, even before Marquee connects. 16 px text, so iOS doesn't zoom. Focus ring in `--glow-violet`. |
| Suggestion chips | One row of `--surface` pills above the composer, horizontal scroll | The page picks them from what's on screen. A tap sends the chip's text as a turn. |
| Point ring | 2 px `--glow-lavender` ring with a soft outer glow on a card or block | Set by `point_at`. Fades after 4 s. |
| Day strip | Five day chips with the day in 800 and the date in 300 | Swipe or tap. A dot marks days with a clash. |
| Timeline block | Rounded rect, 4 px left bar in the track colour | States from [EXPERIENCE-UX.md § Schedule canvas](EXPERIENCE-UX.md#schedule-canvas) |
| Session card | Surface card: kicker (day, time, venue), title, level chip, seat band, two actions | Seat band: a 5-segment bar plus a text label, never colour alone. Actions are turns (see [EXPERIENCE-UX.md § Talk, type or tap](EXPERIENCE-UX.md#talk-type-or-tap)). |
| Card stack | Horizontal snap scroll with a peek of the next card | Used by `show_sessions` |
| Conflict sheet | Bottom sheet below the frame. Both sessions side by side with a red link between them, then option buttons. | Main option in `--primary`. Swap warning in plain text above the buttons. |
| Pairing screen | 6-character code in display type, QR code, "Copy command" button, 10-minute ring timer | Code in monospace, grouped 3 + 3 |
| Disclosure dialog | Centred card on `--night-1`, one line and a Continue button | A real `<dialog>` |
| Toast | Pill at the top, 2.5 s | Also sent to the live region |
| Recap card | 9:16 poster on a `--glow` background with big numbers | See fun moments |

Stacking, top first: disclosure dialog, toast, avatar frame, conflict sheet, composer, content. Only the dialog blocks input behind it.

### Conversation states

The frame's glow shows what Marquee is doing. The mic button shows only your side.

| State | Avatar frame | Mic button |
|---|---|---|
| Idle | Slow breathing glow, 4 s cycle | Outline mic on `--elevated` |
| Listening | The glow ring grows with your mic level | Filled `--primary`, pressed |
| Thinking | Three dots on the frame's bottom edge | Outline mic |
| Speaking | Glow brightens. Captions run. Typing or tapping interrupts. | Outline mic |
| Quiet mode | Voice toggle crossed out. Video and captions carry on. | Unchanged |
| Mic denied | Unchanged | Crossed mic, grey |
| Reconnecting | Blurred last frame, "Reconnecting…" on the frame | Disabled |
| Chat fallback | Last frame as a still, "Video paused" badge, "Try video" button | Hidden |

## Motion

Two speeds: quick for feedback, slower for delight.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Press, toggle |
| `--dur-base` | 220 ms | Sheets, cards in and out |
| `--dur-slow` | 420 ms | Day switch, avatar frame size change |
| `--dur-reveal` | 700 ms | Wildcard, celebrate |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | Things arriving |
| `--ease-spring` | `cubic-bezier(.3, 1.4, .5, 1)` | Celebrate pop |

- Use the View Transitions API (single document, Safari 18+) for day switches and card to detail. When it's missing, the change happens instantly.
- Animate only `transform` and `opacity`. The avatar frame is the one exception: it animates its height, so the content below can reflow.
- Never move content the attendee is reading while Marquee speaks about it. `point_at` scrolls only when the target is off screen, jumps there with no smooth scroll, and never while the attendee is scrolling.
- With `prefers-reduced-motion: reduce`, every move becomes a fade of 150 ms or less. No bursts, pulses, orbits or confetti. State still shows through colour and text.

### Haptics

On Android Chrome only: `navigator.vibrate(12)` on a booking, a swap or a favorite, behind a feature check. iOS Safari has no vibration API, so iOS gets the visual only.

## Fun moments

| Moment | What happens | Trigger |
|---|---|---|
| Hello | The first live frame fades in over the night gradient, the glow breathes once, and Marquee greets you | Disclosure accepted |
| Pointing | Marquee says "this one has seats" and a ring lights that card | `point_at` |
| Booked | The block fills from left to right. A small ring of bulbs flashes around it once. Toast: "You're in." | `celebrate_action {kind: 'reserve'}` |
| Favorited | A star pops with a spring | `kind: 'favorite'` |
| Swapped | The two blocks trade places in one move. Toast: "Swapped. Thursday 10:00, Wynn." | `kind: 'swap'` |
| Wildcard | A card lands face down on `--glow` with a "?" and flips over | `search_sessions` with `mode: wildcard` |
| Clash found | The red edge draws in, and the two blocks nudge apart by 4 px | `highlight_conflict` |
| Countdown | "12 days" in the top bar. On event week it becomes "Day 2 of 5". | Home |
| Seating opens | A one-time banner with a bulb border: "Seating is open." | Lifecycle change |
| Recap | Poster: big session count, venues visited, wildcard taken, busiest day. Share through Web Share. | Last day or on request |

Empty states have a voice too, for example "Tuesday afternoon is wide open. Want ideas?"

## Icons

Use one open-source icon set with rounded 2 px strokes, such as Lucide (ISC licence). No AWS service icons. Venues are shown as short text codes (MGM, WYN, VEN, ENC, CPL, CFM), not pictures.
