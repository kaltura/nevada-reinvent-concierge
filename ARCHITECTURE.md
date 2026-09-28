[← Back to README](README.md)

# Architecture

One shared Kaltura agent, plus our own backend. The backend holds every attendee's AWS tokens and does all AWS work. The agent only talks, calls our tools and drives the page.

## Components

```
Phone or laptop browser            Our backend (Node)                 AWS Events API
───────────────────────            ──────────────────                 ──────────────
Nevada web app ──HTTPS──────────▶ Web API: session, pairing,
 (schedule canvas,                  catalog reads for the page,
  live avatar, composer)            proxy: tool endpoints ───────────▶ GetSchedule, Reserve…
       │    ▲                       Token store (encrypted) ─refresh─▶ oauth.awsevents.com
       │    │ client tools          Sync job + search index ─────────▶ ListSessions (first attendee's token)
       ▼    │ (same-origin fetch
Kaltura agent (avatar or chat)       to the proxy, or page-only)

Pairing (once per attendee, on whatever device is at hand):
Pairing helper ──PKCE on 127.0.0.1:848x──▶ AWS ──code──▶ helper ──tokens + pairing code──▶ backend

Phone handoff (optional, after pairing):
Paired device ──scan/tap QR or link──▶ phone loads /?handoff=TOKEN, confirms──▶ backend copies tokens to a new visitor cookie
```

| Part | Job | Lives in |
|---|---|---|
| Web app | Mobile-first UI, SDK sessions, renders from our Web API | `client/` |
| Web API | Visitor sessions, pairing codes, page data (`/api/schedule`, `/api/sessions`) | `server/` |
| Proxy | One endpoint per agent tool. Resolves the attendee, calls AWS, shapes a short answer. | `server/` |
| Token store | Refresh and access tokens per attendee, encrypted at rest | `server/` |
| Sync job and index | Catalog snapshot, search, repeats, venue mapping | `server/` |
| Pairing helper | Single-purpose CLI. Runs PKCE and hands tokens to the backend. | `pair/` |
| Provisioning | Creates the agent, tools and prompts once | `scripts/provision.mjs` |
| Prompt updates | Pushes edited `prompts/*.md` to the already-live intellect | `scripts/update-prompts.mjs` |

## Why a proxy

An SDK `api` tool is one HTTP request. It has a timeout of 1 to 120 s (default 10) and exactly one of `responseMapping`, `responseTemplate` or `responseChapters`. It can't fan out, retry or reconcile. Our AWS logic needs all three:

- `GetSchedule` returns IDs only, so the proxy joins them with the index.
- After an uncertain write, the proxy reconciles through `GetSchedule` (see [AWS-EVENTS-INTEGRATION.md § Errors](AWS-EVENTS-INTEGRATION.md#errors)).
- A swap is a cancel then a reserve, with rollback.

Other reasons:

- The SDK's OAuth2 tool auth can't do this. AWS redirects only to loopback, so no hosted callback can finish the sign-in.
- One agent serves everyone. No per-attendee provisioning, and no live AWS tokens in Kaltura's secret store.
- `secrets.set` is a read-merge-write with unknown propagation delay, so a token-push design would race.
- A server-side tool can't reach our proxy without a public URL (the Phase 0 spike confirmed this). So every tool is `tools.client`: the model's call surfaces on the page itself, and the page reaches the proxy same-origin, which always works, on localhost or in production.
- The proxy is plain code we can unit test and deploy.

## Identity

The voice path starts from an anonymous widget KS, so `sys__user_id` is not bound there. Every proxy call is same-origin: the page's own `fetch('/tools/${name}')` carries the same HttpOnly visitor cookie every other Web API route already trusts (`/api/schedule`, `/api/pair/*`). There is no separate identity chain for tools, because Kaltura's cloud never calls our backend directly. There's no third party to authenticate.

Rules:

- Never forward `sys__ks`. Never put an AWS token in a request variable, prompt or tool config.
- An unpaired visitor's cookie still resolves. Tools that need AWS then answer "pair to connect your schedule", and search still works.

## Pairing

The app shows nothing but a connect gate until AWS pairing succeeds: no avatar, no QR, since there's nothing to hand off to yet. Pairing needs a terminal, so it runs on whatever device the attendee is already on:

1. The gate shows a 6-character code, valid 10 minutes, and a command to run.
2. The attendee runs `npx nevada-pair CODE` on that device. Until that package is published, the pairing screen shows the interim command to copy instead: a local absolute path, so it only works on the machine already running the app.
3. The helper binds the first free port from 8484 to 8489 and opens the AWS sign-in page with PKCE.
4. It swaps the code for tokens and posts them with the pairing code to our backend over HTTPS. The backend replies with two single-use handoff URLs, and the helper's success page shows a button for one ("Open Nevada", for continuing on this device) and a QR code for the other (for a phone). Either lands that device already paired even if it never shared a cookie with whoever started pairing (`npm run pair` starts pairing from a script, not a browser, so this is the case that matters most), and using one doesn't invalidate the other.
5. Meanwhile the gate polls the pairing status. The first poll to see "paired" rotates the visitor cookie to a freshly minted id and moves the tokens onto it, so a cookie planted on that device before pairing started (session fixation) never ends up holding real tokens. The gate then starts the avatar experience for whichever device actually holds that cookie.

The helper talks only to AWS and our backend. It stores nothing on disk, prints nothing secret, and exits. We publish its source.

### Phone handoff

Pairing happens on whatever device is at hand, often a laptop, since that's what can run a terminal. The live avatar conversation is nicer on a phone, so the success screen offers a handoff to one, and the header's "Connected" pill reopens the same dialog any time after, not just right after pairing:

1. `POST /api/pair/handoff` mints a single-use token (2-minute TTL) tied to the paired visitor, and returns a URL carrying it. `/api/pair/complete` mints two independent tokens up front the same way, for the helper's "Open Nevada" button and its QR.
2. The dialog renders that URL as a QR code and a tap-to-copy link. "Continue here" closes it and starts (or, from the header pill, just resumes) the avatar experience on the current device.
3. Loading `/?handoff=TOKEN` (typically a phone scanning the QR) shows a confirm page; only a same-origin POST from that page consumes the token. This blocks a bare GET, such as a link preview fetch or a shared screenshot's URL, from silently burning a single-use token before the real attendee taps it. Consuming copies the paired visitor's AWS tokens onto a fresh visitor cookie for that device and redirects to `/`. A token that's already used, expired, or invalid redirects to `/?handoff_failed=1` instead, so the gate can say the link is dead rather than just looking unpaired.

The token store's encryption key is global, not derived per-visitor, so copying a token record to a new visitor id needs no token-store changes, just a new map entry and a cookie. Every visitor id from the same pairing (the original device plus any handoff copies) shares one `pairingId`, so Disconnect can find and remove all of them at once.

Token rules:

- Encrypt tokens at rest with a key held in an environment secret.
- Refresh on demand, using `expires_in` to decide when a token is stale.
- On "Disconnect": revoke the refresh token at AWS, then delete every copy sharing that pairing's `pairingId`. Revoking doesn't kill an access token already issued, so delete that too. It dies within 60 minutes.
- `/api/pair/complete` also sweeps any record idle for more than 7 days before checking the token-store capacity cap, so an attendee who never disconnects doesn't hold a slot forever. This is a check tied to new pairings, not a standalone scheduled job.
- Disconnect doesn't end the attendee's Builder ID browser session on their laptop. Point them to `https://profile.aws.amazon.com` if they want that.

## Security model

What's protected:

- The visitor cookie (`__Host-mq_v`) is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` and carries no `Domain` attribute (the `__Host-` prefix, enforced by the browser). No script on the page, ours or a browser extension, can read it, no other site can ride along with it, and no subdomain can plant one that overrides it.
- Every state-changing request checks `Sec-Fetch-Site` (falling back to `Origin` only when a browser sends neither) so a cross-site page can't ride the cookie into a real request, and every request checks the `Host` header against `PUBLIC_ORIGIN` (or the bound socket's own host and port) so DNS rebinding can't retarget it either.
- AWS tokens live only in our backend's process, encrypted with a key from an environment secret. They never reach the browser or Kaltura's cloud.
- Disconnecting revokes the refresh token at AWS and deletes every copy sharing that pairing's `pairingId` (see [§ Phone handoff](#phone-handoff)).
- The Web API and pairing endpoints are rate-limited per client IP and route (`rateLimited()` in `server/index.mjs`).

Out of scope for Phase 1:

- The encryption key lives in the same process as the data it protects. "At rest" here means in that process's memory, not on disk, so this guards against, for example, a stray log line or a memory dump landing somewhere it shouldn't. It doesn't guard against a fully compromised server.
- All state (tokens, pairings, the catalog) lives in memory. A restart clears everything; nothing survives on disk.
- Each pairing trusts whichever browser holds its cookie. Two browsers on the same laptop are two different attendees, by design.

## Agent configuration

One intellect for English with an open mic. A second one is added only if a Phase 0 spike justifies it (see [ROADMAP.md](ROADMAP.md)).

| Setting | Value | Why |
|---|---|---|
| `kaltura_genie_experiences` | `off` | Its injected instructions beat custom tools. The SDK's create-time check expects exactly `off`. |
| `use_content_search`, `use_get_entry_content`, `use_related_files` | `disabled` | They default on and compete with `search_sessions` |
| `generate_followup_questions` | `on` | Capabilities are per intellect, and the avatar session always requests this one. The chat fallback shows the SDK's chips. In avatar mode the page shows its own chips, picked from what's on screen. |
| `include_sources` | `off` | Answers come from tools, not documents |
| `use_knowledge_base` | `off` unless option A wins (see [Search](#search)) | |
| `avatar` | `on` | |
| `avatar_filler` | `off` | Its canned "looking that up" lines can't be steered by prompt. The page shows a thinking state instead. |
| `use_web_search`, `video_gallery`, `external_video`, `show_link`, `avatar_show_content`, `screen_share_analysis`, `think_process` | `disabled` | The avatar connection forces avatar-only output, so rich widgets never reach the page. Our client tools draw the screen instead. |
| Voice input | Open mic; the mic button mutes. Noise handled client-side by `createNoiseSuppressor` (see [Runtime](#runtime)), not by an agent setting. | Simpler than push-to-talk, with no per-agent capability to request from Kaltura. |
| Opening | Jinja: greeting if `sys__is_new_thread` (naming the attendee's top topic from past favorites/reservations if `topInterest` is set), "Welcome back" if the page set `returning`, else `SILENT_OPENING` | The opening replays on every avatar join, including `switchMode`. The page sets `returning` only when it comes back from the background, and clears it by sending an empty string. `topInterest` comes from `catalog.topTopic()` over the attendee's own reserved/favorited sessions, read once before `connect()` so it's ready for the first opening. |
| Screen context | A `screen` prompt holding `{{ page_context }}`, filled by the page through `setDynamicPrompt` | Lets "book this one" resolve. Needs `allow_client_variables: true`. |
| `requireDisclosureAck` | `true` | EU AI Act Art. 50. The page calls `acknowledgeDisclosure()` before kickoff. |
| Avatar | Chosen from `avatars.listTemplates`, plus our background | There is no emotion API, so don't promise expressions |

Capabilities are cached for about 24 hours, so set them all in `intellects.create()`. Never create and then update.

Prompt text has no such cache. After editing any `prompts/*.md` file, run `npm run update-prompts` (`kaltura.intellects.setPrompts`, a read-merge-write) to push it to the live intellect. No re-provisioning needed.

## Tools

All 18 tools are `tools.client`: the model's call surfaces as a `type:"tool"` stream segment the page's already-open socket parses, dispatched to `session.onToolCall(name, handler)` (`client/app.js`). None of them are server-side webhooks, which is why they work with no public reachability (see [Why a proxy](#why-a-proxy)).

### Proxy tools (`waitForResponse: true`, fetch `/tools/${name}`)

The handler POSTs same-origin to our own proxy, then ACKs the model's turn with `session.respondToTool(call.toolMetadata.id, result)`. The wire default for an absent `waitForResponse` is `true` (blocking), so this is set explicitly. The proxy answers with a short, pre-shaped `{answer}` string. Keep every answer under 15 s (the tool's `timeout`); the proxy owns its own AWS timeouts.

| Tool | Proxy does | AWS calls |
|---|---|---|
| `get_topics()` | Top 8 most common topics/tracks in our index, by real frequency. | None |
| `search_sessions(query, day?, from?, to?, venue?, level?, mode?)` | Top 5 from our index. `mode: wildcard` inverts tag overlap. | None |
| `get_session(sessionId)` | Details, repeats, seat band, walk-up note | `GetSession` only if the snapshot is stale |
| `get_my_schedule(day?)` | Joins IDs with the index. Adds gaps and travel warnings. | `GetSchedule` |
| `favorite_sessions(ids)` / `unfavorite_session(id)` | Batch of up to 10, per-session results. A favorite with no scheduled time gets a spoken note that it's under "not yet scheduled", since it can't go on the grid. | `AssociateFavorites` / `DisassociateFavorite` |
| `reserve_sessions(ids)` / `cancel_reservation(id)` | Per-session results. On a clash, returns `conflictsWith` and swap options. | `ReserveSessions` / `CancelReservation` |
| `swap_reservation(dropId, addId)` | Checks the seat band, cancels `dropId`, reserves `addId`. If that fails, tries to re-reserve `dropId` and reports the outcome truthfully. | Cancel, Reserve, `GetSchedule` |
| `add_personal_time` / `update_personal_time` / `delete_personal_time` | Local to UTC conversion, reconcile | Personal-time endpoints |

A swap gives up the old seat first, because AWS refuses to reserve a clashing session. The agent must say that before it swaps, whenever the new session isn't `available`.

### Page tools (`waitForResponse: false`, draw our page)

Nothing to ACK, so the turn never waits on a UI update. The arguments carry IDs only. The page fetches what it shows from our Web API, so the screen always matches real data and not the model's memory.

| Tool | Args | Page does |
|---|---|---|
| `show_sessions` | `sessionIds`, `title` | Dashed blocks in the day/week grid, in each session's real day and time. A session with no scheduled time is silently dropped; `rules.md` tells the agent to filter those out and say so instead of calling this tool with them. |
| `render_schedule` | `day?`, `focusIds?` | Redraws the canvas from `/api/schedule` |
| `highlight_conflict` | `sessionId`, `conflictsWith`, `options` | Conflict sheet with swap choices |
| `celebrate_action` | `kind` | Small success moment (see [DESIGN.md § Motion](DESIGN.md#motion)) |
| `show_recap` | none | Recap card (Phase 4) |
| `point_at` | `sessionId` | Point ring on the block with that `data-session`. Jumps it into view only if it's off screen. |

The system prompt caps each turn at one client-tool call followed by one to three spoken sentences. Each client tool's description repeats "call once, then speak, never retry". This is the SDK's fix for tool spirals.

## Search

The catalog is too big to page through inside a turn. Search runs on our index, fed by the [catalog sync](AWS-EVENTS-INTEGRATION.md#catalog-sync).

| Option | What | Status |
|---|---|---|
| B (primary) | Our index: embeddings plus structured filters (day, time, venue, level, tags). Top 5 through `search_sessions`. | Build it |
| A (spike) | Kaltura knowledge base: one record, `buildIndexerObjects(['document'])`, one `uploadMarkdown` per session, poll indexing, then set `knowledge_ids` and `use_knowledge_base: 'on'` in one write | Proven pattern in the SDK's docs site. The spike tests scale, hourly churn and ranking. |

Option B stays the default because ranking and filters stay in our code. A can replace it later without changing the tool or the UI.

Derived data in the index:

- Repeats: see the matching rule in [AWS-EVENTS-INTEGRATION.md § Session shape](AWS-EVENTS-INTEGRATION.md#session-shape).
- Venue: map the free-text `venue` to the six known venues.
- Travel: a static venue-to-venue minutes table. It stays provisional until AWS publishes 2026 transport details.

## Evals

`npm run eval` drives the same shared intellect real attendees use (`server/agent.json`'s `configId`), over a real `KalturaChatSession`, with no browser and no mock. Rules first, then an LLM judge for what rules can't check.

| Part | Job | Lives in |
|---|---|---|
| `session.mjs` | Gets a paired cookie by reusing `/api/pair/start` and `/api/pair/status`, caching it. Pairing needs a real AWS Builder ID sign-in, so this prints the pairing command and waits for a human to run it; an eval never signs in itself. Also mints a fresh unpaired cookie for the connect-gate case. | `server/evals/` |
| `expectations.mjs` | Rule-check primitives: did the right tool fire, with what args, does the reply contain or exclude given text. | `server/evals/` |
| `judge.mjs` | Shells out to the `claude` CLI (`--bare --print --output-format json --tools ''`) for one-line PASS/FAIL judgments on tone, helpfulness and correctness. No new dependency, no new API key. | `server/evals/` |
| `cases.mjs` | About 55 cases: one per tool, `rules.md` compliance, restricted topics, multi-turn flows, edge cases. | `server/evals/` |
| `runner.mjs` | Builds one `KalturaChatSession` per case, wires all 18 tools the same way `client/app.js` does, runs each case's turns, checks rules then judge rubrics, and reverts any real AWS write a case made by diffing `/api/schedule` before and after. | `server/evals/` |

Write-tool cases (reserve, favorite, cancel, personal time) run for real against whatever AWS test account is paired. `runner.mjs` refuses to run them against an account that already has reservations, favorites or personal time: evals need a dedicated, empty AWS test account, never a real attendee's week. Cleanup is generic, not per-case: `runner.mjs` snapshots the schedule before and after each case and cancels/unfavorites/deletes exactly what's new, since the live catalog's session IDs aren't known ahead of time.

Set `EVAL_NONINTERACTIVE=1` (used in CI, [.github/workflows/evals.yml](.github/workflows/evals.yml)) to skip every case that needs a paired account instead of printing a pairing command and waiting for a human; a skipped case is reported as skipped, never as passed. Outside CI, `session.mjs` caches the paired cookie at `server/evals/.cache/paired-cookie.json` (gitignored, owner-only permissions) so a human only has to pair once per machine.

## Runtime

- Load the SDK as ESM from jsDelivr pinned to the tag: `https://cdn.jsdelivr.net/gh/kaltura/intelligent-agents-sdk@v1.23.2/src/experience/index.js`. Never `@latest`. The SDK isn't on npm, so Node code uses a git dependency on the same tag.
- Add an import map with SRI. Run `node tools/sri-map.mjs --entry <path> --tag v1.23.2` in the SDK repo once per subpath used (today `experience/index.js` and `management/index.js`), then merge the integrity blocks. Browsers enforce it from Chrome 127 and Firefox 138. Others skip the check.
- Load socket.io-client 4.7.5 from a CDN with SRI and pass it as `avatar.socketFactory`. Its hash was taken from the CDN file, so check it against the npm tarball once.
- Token: the page reads `partnerId` and `widgetId` from `/api/config`, then calls `sessions.createWidgetToken({widgetId})` and `application.appInit(ks)`. `appInit` returns the session KS and the avatar URLs. No secret touches the browser.
- `requireDisclosureAck` and `micStartMode` are avatar config keys. `acknowledgeDisclosure()`, `startMic()` and `startPlayback()` live on `session.transport`, not on the session. The transport is `null` until `connect()`, so wire its events in the `transportChanged` listener. It fires on the first connect and on every `switchMode`.
- Expo-floor noise: `micConstraints: false` plus `noiseProcessor: createNoiseSuppressor({ thresholdDb: -50 })` from `@kaltura/intelligent-agents/experience/noise-suppressor`, both avatar config keys. Raw audio in, so the browser-native Tier-1 suppressor doesn't double-process the signal ahead of the SDK's own AudioWorklet gate.
- Media: `<video autoplay playsinline muted>` plus a separate `<audio autoplay>`. With a separate audio element the video stream has no audio track, so `muted` costs nothing and helps iOS autoplay. Video is H264 only, so leave `preferredVideoCodec` unset.
- The video element sits in one fixed frame and never moves in the DOM, because moving it pauses playback. Frame sizes change with CSS only (see [DESIGN.md § Avatar frame](DESIGN.md#avatar-frame)). When video stops, keep the last frame as a still.
- Typed and tapped turns use `session.sendText(text)` in avatar mode. The avatar speaks the answer, so there is no mode switch. It interrupts Nevada mid-sentence, except during an uninterruptible line such as the opening, where the SDK holds it. It throws before the disclosure is accepted, so the page holds turns until then. Taps send a label plus the session ID.
- Screen context: one `syncScreen()` call site sends `setDynamicPrompt({view, day, visible, focused})` with session IDs only. Each call replaces the whole value, and it needs a connected session.
- Mic level: the `localMicLevel` event lives on the transport, so wire it in `transportChanged`.
- Start: `micStartMode: 'deferred'`, then `startMic()` from a tap. On a `playback_blocked` warning, the next tap anywhere calls `startPlayback()`.
- Background: `hiddenGraceMs` stays at 30 s. On return to the foreground, reconnect quietly (see [EXPERIENCE-UX.md § Network and backgrounding](EXPERIENCE-UX.md#network-and-backgrounding)). If the OS kills the tab first, the backend's idle timeout cleans up. We accept that gap.
- `setAudioOutput` returns `false` without `setSinkId`, as on iOS. Don't show a speaker picker there.
- Bad networks: TURN over TCP 443 (`turns:HOST:443?transport=tcp`) first, then `switchMode('chat')` as a fallback only. The app can't cap avatar downlink. `setAsrBandwidth` caps only the uplink.
- The chat fallback shares the thread through `KalturaAgentSession.switchMode()`, which buffers up to 8 `sendText` calls. Call `switchMode('avatar')` only from a real tap, because the browser needs a gesture for audio and the mic.

The SDK ships no CSS. All styling is ours (see [DESIGN.md](DESIGN.md)).
