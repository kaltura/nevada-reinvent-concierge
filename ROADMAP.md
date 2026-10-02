[← Back to README](README.md)

# Roadmap

Each phase ends with a check. Don't start the next phase until it passes.

Deadline: event week starts Mon Nov 30, 2026. Reserved seating opens Oct 6, 2026, and through the API on Oct 8. Favorites work before that, so Phase 1 can launch favorites-first and switch on reservations when the API allows them.

## Phase 0: spikes

Each spike answers one question that could change the architecture.

| Spike | Question | Pass |
|---|---|---|
| Tool reach | Can the tool executor reach our proxy within 10 s? | **Failed**: on localhost, Kaltura's cloud can never reach an `api` tool's webhook URL. Fixed by making every tool `tools.client`. The model's call surfaces on the page, which reaches the proxy same-origin instead (ARCHITECTURE.md § Why a proxy). |
| Client tools | Do `show_sessions` and `highlight_conflict` fire once, with `waitForResponse: false`, and let the agent keep talking? | The page updates and speech continues in 10 of 10 test turns |
| Sign-in | Does a local server complete PKCE on 8484 to 8489 and store the tokens? | **Changed**: built into the local app ([ARCHITECTURE.md § Sign-in](ARCHITECTURE.md#sign-in)), and the separate `nevada-pair` helper package is retired. The check with the local app still needs one real Builder ID sign-in. |
| Live bulk codes | What do real `BulkFailure` codes look like once seating opens? | Record each code seen. Update the [draft speech](AWS-EVENTS-INTEGRATION.md#bulk-results). |
| Search option A | Can the Kaltura knowledge base hold the whole catalog, keep up with hourly changes and rank well? | 20 test queries rank as well as option B, or A is dropped |
| Screen context | Does `{{ page_context }}` from `setDynamicPrompt` reach the prompt on the avatar socket? | "Book this one" with a card open picks the right session in 10 of 10 turns |
| Typed and tapped turns | Does `sendText` in avatar mode interrupt Nevada, and wait during the opening line? | 10 of 10 turns answered, none lost |
| `point_at` | Does the agent call `point_at` alongside speech without breaking the one-tool-per-turn cap? | The ring lands on the right card in 8 of 10 turns, or drop the tool |
| Avatar resize | Does the video keep playing through `stage`, `split` and `tile` size changes? | 20 size changes with no freeze. If not, a fixed `split` with no `tile`. |
| Keyed avatar | Does `attachChromaKeyAvatar` with `chroma-key-video` key Nevada out at 30 fps, and does the page crop the dark margin the render leaves after keying? Needs a Nevada visual with a solid green backdrop (see [DESIGN.md § Persona](DESIGN.md#persona)). | Smooth on a mid-range laptop with no visible margin or green edge. If not, ship the framed video (see [DESIGN.md § Avatar frame](DESIGN.md#avatar-frame)). |
| Expo noise | Does `createNoiseSuppressor` help ASR on a loud floor? | Fewer misheard turns in a recorded crowd-noise test |
| Real browsers | Avatar video, voice, typing, captions and reconnect in Chrome, Safari and Firefox on a laptop, on a slow network | A full planning conversation in each. Phones are not supported in the local app. |

## Phase 1: one attendee, end to end

- Local server: Web API, proxy, token file, AWS sign-in, catalog sync and disk cache, search option B.
- `npx nevada-reinvent` launcher.
- One agent, provisioned by `scripts/provision.mjs`, with every [capability](ARCHITECTURE.md#agent-configuration) set at create time.
- All server tools and client tools.
- Web app: disclosure, first run, keyed avatar frame in all sizes with the framed fallback, composer with open mic and text, chips and taps as turns, screen context and `point_at`, quiet mode, schedule canvas, session cards, conflict sheet, quiet reconnect with "Welcome back" after the background grace.
- Fill my gaps, see all times, wildcard.
- Done: `client/prototype.html` is removed. `client/index.html` is the only page.

Check: one real, unscripted conversation. "What should I do Tuesday if I care about agentic AI?" → cards appear → "favorite the second one" → the canvas updates from a real `GetSchedule`. Then type "what else is on then?" with a card open, and tap Reserve on a card. After seating opens, repeat it with a reservation and a conflict swap.

## Phase 2: wider release

Each attendee runs their own copy, so there is nothing to scale on our side. Hosting and multi-user backends are not planned. The widget ID and partner ID are public by design, and Kaltura applies its own usage controls.

- Single-binary download for attendees without Node.
- Travel check, once AWS publishes 2026 transport details.
- In-app morning briefing, while the tab is open.

Check: a fresh machine goes from install to a first schedule read with no help.

## Phase 3: chat fallback, personas and lifecycle

- Chat fallback for weak signal: `switchMode` both ways, last frame as a still, the SDK's follow-up chips.
- Personas as prompt variants.
- Lifecycle detection and the matching speech.

Check: start with the avatar, drop to the chat fallback, go back. `threadContinuity` is `true`, the schedule is unchanged, and no second greeting plays.

## Phase 4: polish and launch

- Recap card with Web Share.
- Accessibility pass against [EXPERIENCE-UX.md § Accessibility](EXPERIENCE-UX.md#accessibility).
- Public landing page with the non-affiliation line.

Check: the accessibility pass is clean, and a full catalog sync finishes with no `429`s from AWS.

## Not in v1

See [FEATURES.md § Not in v1](FEATURES.md#not-in-v1).
