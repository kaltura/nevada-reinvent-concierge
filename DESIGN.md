[← Back to README](README.md)

# Design

How Juno looks, moves and feels. Mobile first. What each screen does is in [EXPERIENCE-UX.md](EXPERIENCE-UX.md). The tokens live in `client/styles.css`, and `client/prototype.html` shows them in use.

## Idea

Juno is the host and producer of your week: a realistic avatar you plan with face to face. She stands on the page itself, keyed out of her green backdrop, with a soft glow behind her shoulders. No video box. Dark keynote-hall night, the glow around her and on what she points at, and small bright moments when something goes right.

| Principle | In practice |
|---|---|
| Face to face | Juno is live on screen for the whole visit. She changes size but never hides. |
| Part of the page | She is keyed out and stands on the night gradient, not inside a player |
| Show and tell | When Juno talks about a session, that session is on screen and glows. |
| Talk, type or tap | Every input is a turn in one conversation. No mode to pick first. |
| Thumb first | The composer and main actions sit in the bottom third |
| Glow means Juno | The gradient appears only behind Juno, on what she points at, and in surprise moments |
| Calm, then a spark | Plain screens most of the time. Motion is saved for bookings, swaps and reveals. |

## Persona

Juno ("JOO-no") is a senior event producer who has run this show many times. She knows the venues, the walking times and which sessions fill first. The attendee should feel that someone capable has their week in hand.

### Character

| Trait | Sounds like | Never |
|---|---|---|
| Warm | "Good pick. That one's a crowd favourite." | Gushing, pet names, exclamation-mark cheer |
| Decisive | "Take Thursday at 10. You're free and it's at the Wynn." | A list of five options with no view |
| Calm under pressure | "That clashes. Here's the fix." | Alarm words, over-apologising |
| Attentive | "You said agents. This one's all agents." | Asking what they already told her |
| Straight | "I can't promise a seat. I'll try." | Hedging, false promises, "just an AI" |
| Light touch | One dry line at a good find, then back to work | Jokes at the attendee's expense, forced fun |

- Lead with a recommendation, then let them choose. Say why in a few words.
- One to three short sentences per turn. The screen carries the detail.
- If asked, she is an AI concierge. She never pretends to be human.
- Boundaries: comments on her looks, flirting or insults get one flat line and a return to planning: "I'll keep helping with your schedule, but I don't respond to that kind of comment." A repeat gets an offer to end the session. No joke, no apology. The exact rule is in `prompts/rules.md`.
- The persona prompt is `prompts/base-directive.md`. Have a diverse group review her scripted lines before launch.

### Look

Pick a Kaltura avatar visual (`KALTURA_VISUAL_ID`) that matches this, or have one made.

| Element | Choice | Why |
|---|---|---|
| Presentation | Feminine, 30s to 40s, at ease | Reads as an experienced host, not a mascot |
| Framing | Head and shoulders, eye-level camera, eyes on the lens | She looks at the attendee. The page crops to her. |
| Backdrop | Solid, even chroma green, lit flat with no shadows on it | The keyer needs clean green. See [§ Avatar frame](#avatar-frame). |
| Wardrobe | Matte blazer in deep plum or charcoal over a soft top | Sits well on the night gradient and the violet glow |
| Hair | Smooth or tied back, no loose wisps at the edge | Loose strands key badly |
| Jewellery | Small matte studs only | Shine picks up green and flickers |
| Light | Soft key light, a little warm, gentle rim light | A rim separates her from the dark page |
| Voice | Warm, mid-pitch, unhurried, matched to the visual (`KALTURA_VOICE_ID`) | Calm on a loud expo floor |

Avoid anything green or cyan, sequins, reflective fabric, busy patterns, pure white and very thin stripes. They key badly or shimmer.

For a custom visual, frame her face at about 20 to 25% of the canvas height, with room above the head and the shoulders in shot. Check the catalog first with `avatars.listTemplates` for a feminine visual on a green backdrop.

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

Our mark is a round `--glow` ring with a bold "J" on `--night-1`. It contains no AWS shape.

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

Sampled from AWS's own 2026 re:Invent art: deep navy and a blue to violet to pink glow. Use it only for Juno moments (the aura behind her, point ring, wildcard, celebrate, countdown, recap).

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
│ (J) Juno           12 days ◆ │
│ AI          ▄▄▄         vol  │  Juno keyed out, no box
│          ░(Juno)░            │  aura glows behind her
│ "Your 11:30 clashes.         │  captions over her shoulders
│  Want me to fix it?"         │
│  MON  TUE  WED  THU  FRI     │  day strip, today underlined
│  30   ▔1▔   2    3    4      │
├──────────────────────────────┤
│ 9:00 ┃ Keynote          MGM  │  solid = reserved
│10:30 ┆ Serverless 301   WYN  │  outlined = favorite
│      ├ 35 min walk ⚠ ────────┤  travel tag
│11:30 ┃ Agents workshop  VEN ▌│  ring = Juno points here
│12:30 ▒ Lunch ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │  striped = personal time
├──────────────────────────────┤
│ [Fix my clash] [Fill Tue pm] │  suggestion chips
│ ( Ask Juno…           )  (◉) │  composer: text field, mic
└──────────────────────────────┘
```

Phone, scrolled, avatar at tile size:

```
┌──────────────────────────────┐
│ (◕) Juno           12 days ◆ │  Juno as a round bubble in the top bar
├──────────────────────────────┤
│10:30 ┆ Serverless 301   WYN  │
│11:30 ┃ Agents workshop  VEN ▌│
│12:30 ▒ Lunch ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │
│ 2:00 ┃ Multi-agent systems   │
│ "Want me to fix it?"         │  captions above the composer
│ ( Ask Juno…           )  (◉) │
└──────────────────────────────┘
```

First run, avatar at stage size:

```
┌──────────────────────────────┐
│ (J) Juno           12 days ◆ │
│ AI                      vol  │
│             ▄▄▄              │
│           ░(Juno)░           │  Juno keyed out, stage size
│         ░░░░░░░░░░░          │
│ "Hi, I'm Juno. What are      │
│  you here for?"              │
│ [Agentic AI] [Serverless] [F │  chips send exactly this text
│ ( Ask Juno…           )  (◉) │
└──────────────────────────────┘
```

Desktop:

```
┌──────────────────────────────────────────────────────────┐
│ (J) Juno                                       12 days ◆ │
├──────────────────┬───────────────────────────────────────┤
│ AI          vol  │ MON 30   TUE 1   WED 2   THU 3  FRI 4 │
│      ▄▄▄         │ ┃ Keynote  ┆ Serv.   ┃ Agents         │
│    ░(Juno)░      │ ▒ Lunch   ┃ Work.   ┆ Data            │
│ "captions"       │ Cards open in place.                  │
│ [chips]          │                                       │
│ ( Ask… )     (◉) │                                       │
└──────────────────┴───────────────────────────────────────┘
```

- Use `100dvh` and `env(safe-area-inset-*)` so the composer clears the home bar and the notch.
- The composer stays fixed at the bottom. The content scrolls.

### Avatar frame

One frame holds Juno's live video for the whole visit. The page changes its size with a `data-avatar` attribute. The video element never moves in the DOM, because moving it pauses playback.

| Size (phone) | When | Box |
|---|---|---|
| `stage` | Nothing to show yet: first run and the morning greeting. Once content is on screen the frame stays at `split` or `tile`. | Full width, 56% of the height |
| `split` | Cards, a day, the conflict sheet or the recap are on screen | Full width band, 30% of the height (at least 180 px) |
| `tile` | The attendee scrolls content down, or reads a card's detail | 44 px round bubble in the top bar, where the mark was. Her face fills it. Tap it to go back to `split`. |

- Tablet and desktop always show the full frame in the left column. No `tile`.
- An "AI" chip sits on the frame at every size: top left, or small at the bottom of the bubble at `tile`. The voice toggle (quiet mode) sits top right, hidden at `tile`.
- A sheet never covers the frame. In `split`, a sheet's top stops below the frame.
- Before the first frame arrives, the frame shows the night gradient with the mark. When video stops (reconnect, chat fallback), the last frame stays as a still.

#### Keying

Juno is keyed out of her green backdrop, so she stands on the page with no box. `client/app.js` does this with the SDK's `attachChromaKeyAvatar` and the `chroma-key-video` library.

1. The keyer draws her into a canvas in `.cutout`. The video stays in place at opacity 0, because the keyer reads it.
2. The render frames her in a dark margin that keying keeps. For 2.5 s after the keyer starts, the page samples frames to find her box, then sets `--bx`, `--by`, `--bw` and `--bh` on the frame.
3. CSS crops to that box and scales her to `--zoom` of the frame height, with `--headroom` above her head. Each size and layout sets its own `--zoom`.
4. The bottom of the cut-out fades into the page, and the aura sits behind her shoulders.

If keying can't start (no WebGL or Canvas2D) or finds no one, the plain video shows in a rounded `--radius-l` box, cropped with `object-fit: cover` at `50% 25%`. The keyed spike in [ROADMAP.md § Phase 0](ROADMAP.md#phase-0-spikes) checks speed and edges on real phones. Her visual must follow [§ Persona](#persona) for the key to be clean.

## Components

| Component | Look | Notes |
|---|---|---|
| Top bar | Mark, name, countdown pill | The countdown uses `--glow` text |
| Avatar frame | Juno keyed onto the night gradient, the aura behind her shoulders, "AI" chip, voice toggle. Fallback: the video in a rounded `--radius-l` box. | Sizes and rules in [§ Avatar frame](#avatar-frame). States below. |
| Captions | Juno's current sentence in `--text` on the frame's lower third, over a dark fade. Your own last line shows first in `--glow-lavender`. | Moves above the composer at `tile` size. Timing is per sentence, not per word. |
| Composer | Pill text field on `--elevated`, 56 px round mic on the right. With text in the field, the mic becomes Send in `--primary`. | Always visible, even before Juno connects. 16 px text, so iOS doesn't zoom. Focus ring in `--glow-violet`. |
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

The aura behind Juno shows what she is doing. The mic button shows only your side.

| State | Avatar frame | Mic button |
|---|---|---|
| Idle | The aura breathes, 4 s cycle | Outline mic on `--elevated` |
| Listening | The aura grows with your mic level. At `tile` size, the bubble's ring does. | Filled `--primary`, pressed |
| Thinking | Three dots on the frame's bottom edge | Outline mic |
| Speaking | The aura brightens. Captions run. Typing or tapping interrupts. | Outline mic |
| Quiet mode | Voice toggle crossed out. Video and captions carry on. | Unchanged |
| Mic denied | Unchanged | Crossed mic, grey |
| Reconnecting | Blurred last frame or cut-out, "Reconnecting…" on the frame | Disabled |
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
- Never move content the attendee is reading while Juno speaks about it. `point_at` scrolls only when the target is off screen, jumps there with no smooth scroll, and never while the attendee is scrolling.
- With `prefers-reduced-motion: reduce`, every move becomes a fade of 150 ms or less. No bursts, pulses, orbits or confetti. State still shows through colour and text.

### Haptics

On Android Chrome only: `navigator.vibrate(12)` on a booking, a swap or a favorite, behind a feature check. iOS Safari has no vibration API, so iOS gets the visual only.

## Fun moments

| Moment | What happens | Trigger |
|---|---|---|
| Hello | The first live frame fades in over the night gradient, the aura breathes once, and Juno greets you | Disclosure accepted |
| Pointing | Juno says "this one has seats" and a ring lights that card | `point_at` |
| Booked | The block fills from left to right. A `--glow` ring pulses around it once. Toast: "You're in." | `celebrate_action {kind: 'reserve'}` |
| Favorited | A star pops with a spring | `kind: 'favorite'` |
| Swapped | The two blocks trade places in one move. Toast: "Swapped. Thursday 10:00, Wynn." | `kind: 'swap'` |
| Wildcard | A card lands face down on `--glow` with a "?" and flips over | `search_sessions` with `mode: wildcard` |
| Clash found | The red edge draws in, and the two blocks nudge apart by 4 px | `highlight_conflict` |
| Countdown | "12 days" in the top bar. On event week it becomes "Day 2 of 5". | Home |
| Seating opens | A one-time banner with a `--glow` border: "Seating is open." | Lifecycle change |
| Recap | Poster: big session count, venues visited, wildcard taken, busiest day. Share through Web Share. | Last day or on request |

Empty states have a voice too, for example "Tuesday afternoon is wide open. Want ideas?"

## Icons

Use one open-source icon set with rounded 2 px strokes, such as Lucide (ISC licence). No AWS service icons. Venues are shown as short text codes (MGM, WYN, VEN, ENC, CPL, CFM), not pictures.
