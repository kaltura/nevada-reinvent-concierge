[← Back to README](README.md)

# Design

How Marquee looks, moves and feels. Mobile first. What each screen does is in [EXPERIENCE-UX.md](EXPERIENCE-UX.md). The tokens live in `client/styles.css`, and `client/prototype.html` shows them in use.

## Idea

A Las Vegas theatre marquee for your week. The show is your schedule, and Marquee is the host. Dark stage, a glowing keynote-hall gradient when Marquee talks, and small bright moments when something goes right.

| Principle | In practice |
|---|---|
| Your plan is the star | The schedule canvas fills the screen. The avatar steps aside when cards appear. |
| Thumb first | Main actions sit in the bottom third. The mic is bottom centre. |
| Glow means Marquee | The gradient appears only when Marquee is talking, listening or surprising you |
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

Sampled from AWS's own 2026 re:Invent art: deep navy and a blue to violet to pink glow. Use it only for Marquee moments (voice, wildcard, celebrate, countdown, recap).

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
| Under 600 px (phones) | One column. Day strip, timeline, bottom dock. |
| 600 to 1023 px | Timeline on the left, cards on the right |
| 1024 px and up | Full week grid, with avatar and chat in a right rail |

Phone home screen:

```
┌──────────────────────────────┐
│ [M] Marquee        12 days ◆ │  top bar: mark, countdown
├──────────────────────────────┤
│  MON  TUE  WED  THU  FRI     │  day strip, today underlined
│  30   ▔1▔   2    3    4      │
├──────────────────────────────┤
│ 9:00 ┃ Keynote          MGM  │  solid = reserved
│      ┃                       │
│10:30 ┆ Serverless 301   WYN  │  outlined = favorite
│      ├ 35 min walk ⚠ ────────┤  travel tag
│11:30 ┃ Agents workshop  VEN ▌│  red edge = clash
│12:30 ▒ Lunch ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  striped = personal time
│      ╎ + Fill this gap       │
├──────────────────────────────┤
│ "Your 11:30 clashes. Fix it?"│  caption bar
│   ( ◉ )  bubble   [ Type ]   │  dock: avatar, mic, text
└──────────────────────────────┘
```

- Use `100dvh` and `env(safe-area-inset-*)` so the dock clears the home bar and the notch.
- The dock stays fixed. The timeline scrolls.
- The avatar has two sizes. When it's talking with no cards on screen, it's a stage at the top (at least 40% of the height). When cards appear, it shrinks to a 72 px round bubble in the dock. Tapping the bubble brings the stage back.

## Components

| Component | Look | Notes |
|---|---|---|
| Top bar | Mark, name, countdown pill | The countdown uses `--glow` text |
| Day strip | Five day chips with the day in 800 and the date in 300 | Swipe or tap. A dot marks days with a clash. |
| Timeline block | Rounded rect, 4 px left bar in the track colour | States from [EXPERIENCE-UX.md § Schedule canvas](EXPERIENCE-UX.md#schedule-canvas) |
| Session card | Surface card: kicker (day, time, venue), title, level chip, seat band, two actions | Seat band: a 5-segment bar plus a text label, never colour alone |
| Card stack | Horizontal snap scroll with a peek of the next card | Used by `show_sessions` |
| Conflict sheet | Bottom sheet. Both sessions side by side with a red link between them, then option buttons. | Main option in `--primary`. Swap warning in plain text above the buttons. |
| Voice dock | Mic button (64 px) bottom centre, avatar bubble to the left, "Type" to the right | Mic states below |
| Caption bar | One or two lines above the dock, `--muted` text, current word in `--text` | `CaptionService` |
| Chat view | Bubbles plus follow-up chips in a horizontal row | Same cards as voice |
| Text input | Pill field on `--elevated` that replaces the dock while typing, send button in `--primary` | 16 px text, so iOS doesn't zoom. Focus ring in `--glow-violet`. |
| Pairing screen | 6-character code in display type, QR code, "Copy command" button, 10-minute ring timer | Code in monospace, grouped 3 + 3 |
| Disclosure dialog | Centred card on `--night-1`, one line and a Continue button | A real `<dialog>` |
| Toast | Pill at the top, 2.5 s | Also sent to the live region |
| Recap card | 9:16 poster on a `--glow` background with big numbers | See fun moments |

Stacking, top first: disclosure dialog, conflict sheet, toast, dock, avatar stage, timeline. Only the dialog blocks input behind it.

### Voice states

| State | Mic button | Avatar frame |
|---|---|---|
| Idle | Outline mic on `--elevated` | Still, thin border |
| Listening | Filled `--primary`, ring pulses with the mic level | Soft `--glow` border |
| Thinking | Three dots orbit the button | The glow turns slowly |
| Speaking | Button shows "tap to interrupt" | The glow brightens with the audio level |
| Muted or denied | Crossed mic, banner above the dock | Grey border |
| Reconnecting | Spinner, "Reconnecting…" in the caption bar | Blurred last frame |

## Motion

Two speeds: quick for feedback, slower for delight.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Press, toggle |
| `--dur-base` | 220 ms | Sheets, cards in and out |
| `--dur-slow` | 420 ms | Day switch, stage and bubble change |
| `--dur-reveal` | 700 ms | Wildcard, celebrate |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | Things arriving |
| `--ease-spring` | `cubic-bezier(.3, 1.4, .5, 1)` | Celebrate pop |

- Use the View Transitions API (single document, Safari 18+) for day switches, card to detail, and stage to bubble. When it's missing, the change happens instantly.
- Animate only `transform` and `opacity`.
- Never move content the attendee is reading while Marquee speaks about it.
- With `prefers-reduced-motion: reduce`, every move becomes a fade of 150 ms or less. No bursts, pulses, orbits or confetti. State still shows through colour and text.

### Haptics

On Android Chrome only: `navigator.vibrate(12)` on a booking, a swap or a favorite, behind a feature check. iOS Safari has no vibration API, so iOS gets the visual only.

## Fun moments

| Moment | What happens | Trigger |
|---|---|---|
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
