[← Back to README](README.md)

# Roadmap

Each phase ends with a check. Don't start the next phase until it passes.

Deadline: event week starts Mon Nov 30, 2026. Reserved seating opens Oct 6, 2026, and through the API on Oct 8. Favorites work before that, so Phase 1 can launch favorites-first and switch on reservations when the API allows them.

## Phase 0: spikes

Each spike answers one question that could change the architecture.

| Spike | Question | Pass |
|---|---|---|
| Request variables on voice | Does `{{ session_ref }}` resolve in an `api` tool header on the avatar socket, with `allow_client_variables: true`? | The proxy logs the right ref for a voice turn. If not, use the [fallback](ARCHITECTURE.md#identity). |
| System variables | Does `{{ sys__thread_id }}` resolve in a header, and does the backend refuse a client-sent `sys__*` value? | Real thread ID in the header. A spoofed value is dropped. |
| Tool reach | Can the tool executor reach our proxy within 10 s? | 20 calls from a live session, all under 10 s |
| Client tools | Do `show_sessions` and `highlight_conflict` fire once, with `waitForResponse: false`, and let the agent keep talking? | The page updates and speech continues in 10 of 10 test turns |
| Pairing | Does `npx juno-pair` complete PKCE on 8484 to 8489 and hand tokens to the backend? | One real Builder ID sign-in ends with a stored refresh token |
| Live bulk codes | What do real `BulkFailure` codes look like once seating opens? | Record each code seen. Update the [draft speech](AWS-EVENTS-INTEGRATION.md#bulk-results). |
| Search option A | Can the Kaltura knowledge base hold the whole catalog, keep up with hourly changes and rank well? | 20 test queries rank as well as option B, or A is dropped |
| Push-to-talk | Can our agent get `isTapToTalk: true`? The SDK's management API has no setting for it, so ask Kaltura. | `session.transport.capabilities.tapToTalk` is true on a live session. If not, ship open mic, with the mic button as mute. |
| Screen context | Does `{{ page_context }}` from `setDynamicPrompt` reach the prompt on the avatar socket? | "Book this one" with a card open picks the right session in 10 of 10 turns |
| Typed and tapped turns | Does `sendText` in avatar mode interrupt Juno, and wait during the opening line? Does push-to-talk interrupt too? | 10 of 10 turns answered, none lost |
| `point_at` | Does the agent call `point_at` alongside speech without breaking the one-tool-per-turn cap? | The ring lands on the right card in 8 of 10 turns, or drop the tool |
| Avatar resize on iPhone | Does the video keep playing through `stage`, `split` and `tile` size changes? | 20 size changes with no freeze. If not, a fixed `split` with no `tile`. |
| Keyed avatar | Does `attachChromaKeyAvatar` with `chroma-key-video` key Juno out at 30 fps, and does the page crop the dark margin the render leaves after keying? Needs a Juno visual with a solid green backdrop (see [DESIGN.md § Persona](DESIGN.md#persona)). | Smooth on an iPhone and a mid-range Android with no visible margin or green edge. If not, ship the framed video (see [DESIGN.md § Avatar frame](DESIGN.md#avatar-frame)). |
| Expo noise | Does `createNoiseSuppressor` help ASR on a loud floor? | Fewer misheard turns in a recorded crowd-noise test |
| Real iPhone | Avatar video, voice, typing, captions and reconnect on a real iPhone in Safari, on a slow network | A full planning conversation on the device. Automated browsers can't test iOS Safari. |

## Phase 1: one attendee, end to end

- Backend: Web API, proxy, encrypted token store, pairing codes, first catalog sync, search option B.
- Pairing helper, from the spike.
- One agent, provisioned by `scripts/provision.mjs`, with every [capability](ARCHITECTURE.md#agent-configuration) set at create time.
- All server tools and client tools.
- Web app: disclosure, first run, keyed avatar frame in all sizes with the framed fallback, composer with toggle mic and text, chips and taps as turns, screen context and `point_at`, quiet mode, schedule canvas, session cards, conflict sheet, quiet reconnect with "Welcome back" after the background grace.
- Fill my gaps, see all times, wildcard.

Check: one real, unscripted conversation. "What should I do Tuesday if I care about agentic AI?" → cards appear → "favorite the second one" → the canvas updates from a real `GetSchedule`. Then type "what else is on then?" with a card open, and tap Reserve on a card. After seating opens, repeat it with a reservation and a conflict swap.

## Phase 2: many attendees

- Many paired attendees at once, each pinned to their own `session_ref`.
- Token refresh on demand for every attendee. Disconnect and the 7-day purge.
- Travel check, once AWS publishes 2026 transport details.
- In-app morning briefing.
- Rate limits on our Web API and pairing endpoints.

Check: two attendees paired at once. Each sees only their own schedule, and a ref from one thread is refused on another.

## Phase 3: chat fallback, personas and lifecycle

- Chat fallback for weak signal: `switchMode` both ways, last frame as a still, the SDK's follow-up chips.
- Personas as prompt variants.
- Lifecycle detection and the matching speech.

Check: start with the avatar, drop to the chat fallback, go back. `threadContinuity` is `true`, the schedule is unchanged, and no second greeting plays.

## Phase 4: polish and launch

- Recap card with Web Share.
- Optional morning push notification, behind a real-device test. On iOS it needs Home Screen install.
- Accessibility pass against [EXPERIENCE-UX.md § Accessibility](EXPERIENCE-UX.md#accessibility).
- Load test the sync job and the proxy at expected attendee counts.
- Public landing page with the non-affiliation line.

Check: the accessibility pass is clean, and the load test holds at the target count with no `429`s from AWS.

## Not in v1

See [FEATURES.md § Not in v1](FEATURES.md#not-in-v1).

## Open questions

| Question | Who answers |
|---|---|
| Is there a terms-of-use page for the AWS Events API? Does it allow a hosted service that holds many attendees' tokens? | Ask AWS before a public launch |
| Is "Juno" free to use as a name? | Trademark search |
| Can we show catalog data to visitors who haven't paired? The catalog is gated to registered attendees. | Ask AWS. Until then, see the risk below. |

## Risks

| Risk | Plan |
|---|---|
| No terms of use for the API | Ask AWS early. Keep the pairing helper open source and the data use narrow. |
| Our backend holds many attendees' tokens | Encrypt at rest, keep the key in an environment secret, delete on Disconnect and 7 days after the event |
| Pre-pair browse shows gated catalog data from our service credential | If AWS says no, make pairing the first step and drop try-before-pair |
| The name "Juno" is taken | Clear it before any public use. The name lives in one place in the code. |
| Travel times change in 2026 | Keep the table provisional and update it when AWS publishes transport details |
| Seating opens before Phase 1 is ready (API date Oct 8) | Ship Phase 1 favorites-first. Detect seating from the API, not the date. |
| The Builder ID session ends before the 30-day refresh token does | A dead refresh means pair again. Say so in speech and show the pairing button. Measure the real lifetime in the pairing spike. |
| AWS's edge refuses our backend's traffic (`403` with no body) | Back off. Keep attendee calls on each attendee's own token. Ask AWS if it persists. |
| A swap loses the old seat | Warn before swapping when the new session isn't `available`. Try to re-reserve the old seat and report the result truthfully. |
| A write fails with an unknown outcome | Never blind-retry. Reconcile through `GetSchedule` (see [AWS-EVENTS-INTEGRATION.md § Errors](AWS-EVENTS-INTEGRATION.md#errors)). |
| The refresh token expires (30 days) | Tell the attendee in speech and show the pairing button |
| Avatar video stalls on iOS when the frame resizes | Resize spike. Fallback: a fixed `split` frame and no `tile`. |
| Juno talks out loud in a quiet session room | Quiet mode mutes the voice. Captions and typing carry on. |
