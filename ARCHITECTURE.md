[← Back to README](README.md)

# Architecture

One shared Kaltura agent, plus our own backend. The backend holds every attendee's AWS tokens and does all AWS work. The agent only talks, calls our tools and drives the page.

## Components

```
Phone or laptop browser            Our backend (Node)                 AWS Events API
───────────────────────            ──────────────────                 ──────────────
Marquee web app ──HTTPS──────────▶ Web API: session, pairing,
 (schedule canvas, cards,           catalog reads for the page
  voice and chat UI)                Proxy: tool endpoints ───────────▶ GetSchedule, Reserve…
       │    ▲                       Token store (encrypted) ─refresh─▶ oauth.awsevents.com
       │    │ client tools          Sync job + search index ─────────▶ ListSessions (service login)
       │    │ (IDs only)                   ▲
       ▼    │                              │ api tools: X-Proxy-Key + session_ref
Kaltura agent (avatar or chat) ────────────┘

Pairing (once per attendee, on a laptop):
Pairing helper ──PKCE on 127.0.0.1:848x──▶ AWS ──code──▶ helper ──tokens + pairing code──▶ backend
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

## Why a proxy

An SDK `api` tool is one HTTP request. It has a timeout of 1 to 120 s (default 10) and exactly one of `responseMapping`, `responseTemplate` or `responseChapters`. It can't fan out, retry or reconcile. Our AWS logic needs all three:

- `GetSchedule` returns IDs only, so the proxy joins them with the index.
- After an uncertain write, the proxy reconciles through `GetSchedule` (see [AWS-EVENTS-INTEGRATION.md § Errors](AWS-EVENTS-INTEGRATION.md#errors)).
- A swap is a cancel then a reserve, with rollback.

Other reasons:

- The SDK's OAuth2 tool auth can't do this. AWS redirects only to loopback, so no hosted callback can finish the sign-in.
- One agent serves everyone. No per-attendee provisioning, and no live AWS tokens in Kaltura's secret store.
- `secrets.set` is a read-merge-write with unknown propagation delay, so a token-push design would race.
- The tool executor's egress is restricted (it can't reach kaltura.com). Reach to AWS is unverified. Reach to our proxy is a Phase 0 spike.
- The proxy is plain code we can unit test and deploy.

## Identity

The voice path starts from an anonymous widget KS, so `sys__user_id` is not bound there. Identity comes from our own reference:

1. The web app holds an HttpOnly visitor cookie from our backend.
2. Before each conversation, the page asks `/api/session-ref` for an opaque, random, short-lived `session_ref`.
3. The page passes it as a request variable. The agent is created with `allow_client_variables: true`, because request variables fail silently without it.
4. Every `api` tool sends `X-Proxy-Key: {{secrets.PROXY_KEY}}`, `X-Session-Ref: {{ session_ref }}` and `X-Thread: {{ sys__thread_id }}`.
5. The proxy checks the key, looks up the ref and pins the ref to the first thread ID it sees. A ref from another thread is refused.

Rules:

- Never forward `sys__ks`. Never put an AWS token in a request variable, prompt or tool config.
- `{{secrets.NAME}}` is the only form that resolves. `{{variables.secrets.NAME}}` renders empty with no error. Run `mgmt.intellects.secrets.validate` after provisioning.
- Fallback if request variables don't interpolate on the avatar socket: `createConversationToken({configId, userId})` gives a bound `sys__user_id`, but only on chat. That would make voice read-only for personal data.

An unpaired visitor still gets a `session_ref`. Tools that need AWS then answer "pair to connect your schedule", and search still works.

## Pairing

A phone can't run a CLI or bind a loopback port, so pairing needs a laptop. The flow starts on the phone:

1. The phone shows a 6-character code and a QR code, valid 10 minutes.
2. On a laptop, the attendee runs `npx marquee-pair CODE`. The QR code opens a page with this command ready to copy.
3. The helper binds the first free port from 8484 to 8489 and opens the AWS sign-in page with PKCE.
4. It swaps the code for tokens and posts them with the pairing code to our backend over HTTPS.
5. The phone polls the pairing status, sees "paired", and syncs any shortlist made before pairing (see [EXPERIENCE-UX.md § First run](EXPERIENCE-UX.md#first-run)).

The helper talks only to AWS and our backend. It stores nothing on disk, prints nothing secret, and exits. We publish its source.

Token rules:

- Encrypt tokens at rest with a key held in an environment secret.
- Refresh on demand, using `expires_in` to decide when a token is stale.
- On "Disconnect", and for everyone 7 days after the event: revoke the refresh token at AWS, then delete our copy. Revoking doesn't kill an access token already issued, so delete that too. It dies within 60 minutes.
- Disconnect doesn't end the attendee's Builder ID browser session on their laptop. Point them to `https://profile.aws.amazon.com` if they want that.

## Agent configuration

One intellect for English with toggle push-to-talk. A second one is added only if a Phase 0 spike justifies it (see [ROADMAP.md](ROADMAP.md)).

| Setting | Value | Why |
|---|---|---|
| `kaltura_genie_experiences` | `off` | Its injected instructions beat custom tools. The SDK's create-time check expects exactly `off`. |
| `use_content_search`, `use_get_entry_content`, `use_related_files` | `disabled` | They default on and compete with `search_sessions` |
| `generate_followup_questions` | `on` | Capabilities are per intellect, and the avatar session always requests this one. Chat shows the chips. The voice view doesn't render them. |
| `include_sources` | `off` | Answers come from tools, not documents |
| `use_knowledge_base` | `off` unless option A wins (see [Search](#search)) | |
| `avatar` | `on` | |
| `avatar_filler` | `off` | Its canned "looking that up" lines can't be steered by prompt. The page shows a thinking state instead. |
| `use_web_search`, `video_gallery`, `external_video`, `show_link`, `avatar_show_content`, `screen_share_analysis`, `think_process` | `disabled` | We mount no GenUI renderer, and none of these fit |
| Voice input | Toggle push-to-talk (`isTapToTalk`), a per-agent backend setting with no SDK setter (see [ROADMAP.md § Phase 0](ROADMAP.md#phase-0-spikes)) | SDK advice for noisy, multi-speaker places. Toggle beats hold for TalkBack. |
| Opening | Jinja: greeting if `sys__is_new_thread`, "Welcome back" if the page set `returning`, else `SILENT_OPENING` | The opening replays on every avatar join, including `switchMode`. The page sets `returning` only when it comes back from the background, and clears it by sending an empty string. |
| `requireDisclosureAck` | `true` | EU AI Act Art. 50. The page calls `acknowledgeDisclosure()` before kickoff. |
| Avatar | Chosen from `avatars.listTemplates`, plus our background | There is no emotion API, so don't promise expressions |

Capabilities are cached for about 24 hours, so set them all in `intellects.create()`. Never create and then update.

## Tools

### Server tools (`api`, all pointed at the proxy)

The proxy answers with pre-shaped text through `responseTemplate`. Keep every answer under 10 s. The proxy owns its own AWS timeouts.

| Tool | Proxy does | AWS calls |
|---|---|---|
| `search_sessions(query, day?, from?, to?, venue?, level?, mode?)` | Top 5 from our index. `mode: wildcard` inverts tag overlap. | None |
| `get_session(sessionId)` | Details, repeats, seat band, walk-up note | `GetSession` only if the snapshot is stale |
| `get_my_schedule(day?)` | Joins IDs with the index. Adds gaps and travel warnings. | `GetSchedule` |
| `favorite_sessions(ids)` / `unfavorite_session(id)` | Batch of up to 10, per-session results | `AssociateFavorites` / `DisassociateFavorite` |
| `reserve_sessions(ids)` / `cancel_reservation(id)` | Per-session results. On a clash, returns `conflictsWith` and swap options. | `ReserveSessions` / `CancelReservation` |
| `swap_reservation(dropId, addId)` | Checks the seat band, cancels `dropId`, reserves `addId`. If that fails, tries to re-reserve `dropId` and reports the outcome truthfully. | Cancel, Reserve, `GetSchedule` |
| `add_personal_time` / `update_personal_time` / `delete_personal_time` | Local to UTC conversion, reconcile | Personal-time endpoints |

A swap gives up the old seat first, because AWS refuses to reserve a clashing session. The agent must say that before it swaps, whenever the new session isn't `available`.

### Client tools (`tools.client`, drive our page)

Every client tool sets `waitForResponse: false`, because the wire default blocks the turn. The arguments carry IDs only. The page fetches what it shows from our Web API, so the screen always matches real data and not the model's memory.

| Tool | Args | Page does |
|---|---|---|
| `show_sessions` | `sessionIds`, `title` | Card stack |
| `render_schedule` | `day?`, `focusIds?` | Redraws the canvas from `/api/schedule` |
| `highlight_conflict` | `sessionId`, `conflictsWith`, `options` | Conflict sheet with swap choices |
| `celebrate_action` | `kind` | Small success moment (see [DESIGN.md § Motion](DESIGN.md#motion)) |
| `show_recap` | none | Recap card (Phase 4) |

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

## Runtime

- Load the SDK as ESM from jsDelivr pinned to the tag: `https://cdn.jsdelivr.net/gh/kaltura/intelligent-agents-sdk@v1.23.2/src/experience/index.js`. Never `@latest`. The SDK isn't on npm, so Node code uses a git dependency on the same tag.
- Add an import map with SRI. Run `node tools/sri-map.mjs --entry <path> --tag v1.23.2` in the SDK repo once per subpath used (today `experience/index.js` and `management/index.js`), then merge the integrity blocks. Browsers enforce it from Chrome 127 and Firefox 138. Others skip the check.
- Load socket.io-client 4.7.5 from a CDN with SRI and pass it as `avatar.socketFactory`. Its hash was taken from the CDN file, so check it against the npm tarball once.
- Token: the page reads `partnerId` and `widgetId` from `/api/config`, then calls `sessions.createWidgetToken({widgetId})` and `application.appInit(ks)`. `appInit` returns the session KS and the avatar URLs. No secret touches the browser.
- `requireDisclosureAck` and `micStartMode` are avatar config keys. `acknowledgeDisclosure()`, `startMic()`, `startPlayback()`, `startTapToTalk()` and `capabilities` live on `session.transport`, not on the session. The transport is `null` until `connect()`, so wire its events in the `transportChanged` listener. It fires on the first connect and on every `switchMode`.
- Media: `<video autoplay playsinline>` plus a separate `<audio autoplay>`. Video is H264 only, so leave `preferredVideoCodec` unset.
- Start: `micStartMode: 'deferred'`, then `startMic()` from a tap. On a `playback_blocked` warning, show a tap control that calls `startPlayback()`.
- Background: `hiddenGraceMs` stays at 30 s. On return to the foreground, reconnect quietly (see [EXPERIENCE-UX.md § Network and backgrounding](EXPERIENCE-UX.md#network-and-backgrounding)). If the OS kills the tab first, the backend's idle timeout cleans up. We accept that gap.
- `setAudioOutput` returns `false` without `setSinkId`, as on iOS. Don't show a speaker picker there.
- Bad networks: TURN over TCP 443 (`turns:HOST:443?transport=tcp`) first, then `switchMode('chat')`. The app can't cap avatar downlink. `setAsrBandwidth` caps only the uplink.
- Voice and chat share one thread through `KalturaAgentSession.switchMode()`. `switchMode` buffers up to 8 `sendText` calls. Call `switchMode('avatar')` only from a real tap, because the browser needs a gesture to grant the mic.

The SDK ships no CSS. All styling is ours (see [DESIGN.md](DESIGN.md)).
