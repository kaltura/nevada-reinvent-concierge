[← Back to README](README.md)

# Architecture

One Kaltura agent, plus a small local server. The attendee runs the server on their own machine with `npx nevada-reinvent`. It holds their AWS tokens and does all AWS work. The agent only talks, calls our tools and drives the page.

## Components

```
Attendee's machine (127.0.0.1, first free port of 8484 to 8489)       Outside
───────────────────────────────────────────────────────────────       ───────
Browser tab ──HTTP──▶ Local server (Node)
 Nevada web app        Web API: sign-in, agent init, page data
 (schedule canvas,     Proxy: tool endpoints ────────────────────▶ AWS Events API
  live avatar,         Token store ~/.nevada/tokens.json ─refresh─▶ oauth.awsevents.com
  composer)            Catalog cache ~/.nevada/catalog.json ──────▶ ListSessions (the attendee's token)
   │    ▲              /api/agent/init ─public widget id─────────▶ Kaltura (session, appInit)
   │    │ client tools
   ▼    │ (same-origin fetch to the proxy, or page-only)
Kaltura agent (avatar or chat) ◀── session KS, browser connects directly

Sign-in (once, then silent refresh):
Browser ─▶ /auth/start ─▶ AWS Builder ID (PKCE) ─▶ 127.0.0.1:848x/callback ─▶ server stores tokens
```

| Part | Job | Lives in |
|---|---|---|
| Launcher | `npx nevada-reinvent`: checks the Node version (20.6 or later), picks the port, starts the server, opens the browser (not with `--no-open`). If Nevada already runs, it opens that one. | `server/index.mjs` |
| Web app | Desktop UI, SDK sessions, renders from our Web API | `client/` |
| Web API | Sign-in (`/auth/start`, `/callback`), sign-out, agent sessions (`/api/agent/init`), page data (`/api/schedule`, `/api/sessions`), a health check (`/api/health`) | `server/app.mjs` |
| Proxy | One endpoint per agent tool. Calls AWS, shapes a short answer. | `server/` |
| Token store | The attendee's tokens in one private file | `server/tokens.mjs` |
| Catalog | Snapshot, search, repeats, venue mapping. Cached on disk. | `server/catalog.mjs` |
| Kaltura session | Widget session plus `appInit`, no secret | `server/kaltura.mjs` |
| Provisioning | Creates the agent, tools and prompts once. Maintainers only. | `scripts/provision.mjs` |
| Prompt updates | Pushes edited `prompts/*.md` (except `base-directive.md`) to the already-live intellect | `scripts/update-prompts.mjs` |
| Catalog tags | Rebuilds `prompts/catalog-tags.md`, the tag list the agent picks search words from (see [Search](#search)) | `scripts/catalog-tags.mjs` |
| Public config | On `npm pack`, writes the public widget ID into `server/public.json` | `scripts/write-public.mjs` |

## Why a proxy

The agent talks and calls tools. All AWS work runs in the local server, which holds the attendee's tokens. Each AWS action is several requests with our own logic between them:

- `GetSchedule` returns IDs only, so the proxy joins them with the index.
- After an uncertain write, the proxy reconciles through `GetSchedule` (see [AWS-EVENTS-INTEGRATION.md § Errors](AWS-EVENTS-INTEGRATION.md#errors)).
- A swap is a cancel then a reserve, with rollback.

Other reasons:

- AWS redirects only to loopback, so the sign-in finishes on the attendee's own machine.
- One agent serves everyone. No per-attendee provisioning, and AWS tokens live only on the attendee's machine.
- Every tool is `tools.client`: the model's call surfaces on the page itself, and the page reaches the proxy same-origin. The local app needs no public URL.
- The proxy is plain code we can unit test.

## Identity

The attendee's machine holds no Kaltura secret. The package ships a public Kaltura widget ID, like any web widget:

1. The ID comes from `NEVADA_WIDGET_ID`, else `server/public.json` (written by `prepack`), else `server/agent.json` (a source checkout). With none of them the launcher exits.
2. `POST /api/agent/init` (signed-in attendees only) mints a widget session from that ID, then calls `appInit` with it. It returns only the session KS and the avatar URLs. If Kaltura answers 401, it mints a new widget session once and retries.
3. The session has no per-attendee Kaltura user. Kaltura never sees the AWS id or email. "Welcome back" and the opening's top topic come from the page and the AWS schedule.

Every proxy call is same-origin: the page's own `fetch('/tools/${name}')`. Kaltura's cloud never calls our server, so tools need no separate identity chain.

Rules:

- Never forward `sys__ks`. Never put an AWS token in a request variable, prompt or tool config.
- Signed out, tools that need AWS answer "Sign in with your AWS Events account to do that." Search still works from the cached catalog (see [Catalog sync](AWS-EVENTS-INTEGRATION.md#catalog-sync)).

The widget ID and partner ID are public by design, and Kaltura applies its own usage controls. See [SECURITY.md](SECURITY.md#public-widget-id).

## Sign-in

The app shows nothing but a sign-in gate until AWS sign-in succeeds: no avatar, since there's no schedule to work on. The server runs on the attendee's machine, so the browser can finish the sign-in on loopback:

1. The launcher binds the first free port from 8484 to 8489 (AWS accepts only those redirect ports) and opens the browser. It tries the next port when one is busy or blocked (`EADDRINUSE`, `EACCES`). If `GET /api/health` on one of those ports already answers `{ok: true, app: 'nevada-reinvent'}`, Nevada is running, so the launcher opens that one and exits. If the browser doesn't open, it prints "Open the link above in your browser."
2. The gate's "Sign in with AWS" is a plain link to `/auth/start`. The server makes a PKCE S256 verifier and a random single-use `state` (in memory, 10-minute TTL) and redirects to AWS Builder ID.
3. AWS redirects to `http://127.0.0.1:<port>/callback`. The server accepts only a `state` it minted, once, so a forged callback can't sign the attendee in to someone else's account. The callback always ends in a redirect to `/`, with one `signin` value on failure:

   | Value | Cause |
   |---|---|
   | `failed` | AWS returned an error other than `access_denied`, sent no code, or the code exchange failed |
   | `cancelled` | The attendee cancelled at AWS (`access_denied`) |
   | `expired` | The `state` is unknown or older than 10 minutes |
   | `storage` | The tokens couldn't be saved, for example `unsafe_home`, `EACCES`, `EPERM` or `EROFS`. The terminal says why. |

   Each value shows its own toast on the gate (see [EXPERIENCE-UX.md § Sign-in problems](EXPERIENCE-UX.md#sign-in-problems)). `/auth/start` refuses cross-site requests and keeps at most 20 pending sign-ins.
4. The server swaps the code for tokens, saves them, starts a catalog sync and redirects to `/`.
5. The page asks `/api/schedule`. On `signedIn: true` it starts the avatar experience. The header pill ("Signed in") then opens an account dialog with "Sign out of AWS Events".

Token rules:

- Tokens live in `tokens.json` under `~/.nevada`. `NEVADA_HOME` overrides the folder and must be an absolute path, or the launcher exits. The folder is `0700` (an existing folder is tightened, and one owned by another user is refused), the file `0600`, written to a temp file and renamed. Sign-out clears the file before it revokes at AWS, so a refresh in flight can't write it back.
- On a `401` from AWS the server refreshes once (concurrent calls share one refresh), stores the new tokens and retries. If AWS rejects the refresh (`400` or `401`), the server deletes the tokens. The next `/api/schedule` answers `{signedIn: false, expired: true}`. The page ends the avatar session and mic first, resets the header pill to "Sign in", then shows the gate and the "sign-in expired" toast. This includes a lapse mid-session.
- Sign-out revokes the refresh token at AWS, then deletes the file. An access token already issued dies within 60 minutes.
- Sign-out doesn't end the attendee's Builder ID browser session. Point them to `https://profile.aws.amazon.com` if they want that.

`POST /api/schedule` never answers with a 500 for an AWS problem. The page reads the shape:

| Answer | Meaning | Page does |
|---|---|---|
| `{signedIn: false}` | No tokens | Shows the gate |
| `{signedIn: false, expired: true}` | The refresh failed or expired | Ends the avatar session and mic, resets the pill to "Sign in", shows the gate and the "sign-in expired" toast |
| `{signedIn: true, ...schedule}` | Signed in | Starts the experience |
| `{signedIn: true, error}` | Signed in, but AWS or the network failed (`403`, `404`, `429`, `5xx`, offline). `error` is a short message for the attendee. | Starts the experience anyway, so Nevada can answer catalog questions, and shows a lasting "Signed in, but ..." banner with `error` |

Before 8 October 2026 the `error` says the AWS schedule opens on 8 October. After that it says what went wrong plainly, for example "AWS says you are not registered", "AWS is busy, try again in a minute" or "Couldn't reach AWS".

`GET /api/health` answers `{ok: true, app: 'nevada-reinvent'}` with no auth. The launcher uses it to find a running Nevada.

`POST /api/agent/init` answers `401` when signed out and `502` when Kaltura fails. On a failure the page shows a toast and a "Nevada is offline. Reload to try again." banner. The schedule stays usable without the avatar.

## Security model

What's protected:

- The server binds to `127.0.0.1` only.
- Every request checks the `Host` header against `localhost`, `127.0.0.1` or `[::1]` on the real port, else `421`. A DNS-rebinding page can't retarget the app.
- Every non-GET request, and `GET /auth/start`, checks `Sec-Fetch-Site` (falling back to `Origin` only when a browser sends neither), so a cross-site page can't trigger a tool call, a sign-out or a sign-in.
- The app sets no cookies. Access control is the loopback bind plus the two checks above.
- AWS tokens stay on disk in the private file and in the server's memory. They never reach the browser or Kaltura.
- Logs never contain tokens, codes or upstream response bodies.
- Responses carry `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` and `Permissions-Policy: microphone=(self), camera=()`.

Out of scope:

- Anyone who can read the attendee's home folder or run code as them can use the tokens. The app assumes a single-user machine.
- Capacity. Each person runs their own server, so there is no shared load to manage.

Windows: the `0700` and `0600` modes and the owner check don't apply. `~/.nevada` relies on the ACL of the user profile, which is private to the account by default. If you set `NEVADA_HOME`, keep it inside your profile.

## Agent configuration

One intellect for English with an open mic. A second one is added only if a Phase 0 spike justifies it (see [ROADMAP.md](ROADMAP.md)).

| Setting | Value | Why |
|---|---|---|
| `kaltura_genie_experiences` | `off` | Our own tools and prompts own the experience |
| `use_content_search`, `use_get_entry_content`, `use_related_files` | `disabled` | They default on and compete with `search_sessions` |
| `generate_followup_questions` | `on` | Capabilities are per intellect, and the avatar session always requests this one. The chat fallback shows the SDK's chips. In avatar mode the page shows its own chips, picked from what's on screen. |
| `include_sources` | `off` | Answers come from tools, not documents |
| `use_knowledge_base` | `off` unless option A wins (see [Search](#search)) | |
| `avatar` | `on` | |
| `avatar_filler` | `off` | The page shows its own thinking state instead |
| `use_web_search`, `video_gallery`, `external_video`, `show_link`, `avatar_show_content`, `screen_share_analysis`, `think_process` | `disabled` | Our client tools draw the screen instead |
| Voice input | Open mic; the mic button mutes. Noise handled client-side by `createNoiseSuppressor` (see [Runtime](#runtime)), not by an agent setting. | Simpler than push-to-talk |
| Opening | Jinja: greeting if `sys__is_new_thread` (naming the attendee's top topic from past favorites/reservations if `topInterest` is set), "Welcome back" if the page set `returning`, else `SILENT_OPENING` | The opening replays on every avatar join, including `switchMode`. The page sets `returning` only when it comes back from the background, and clears it by sending an empty string. `topInterest` comes from `catalog.topTopic()` over the attendee's own reserved/favorited sessions, read once before `connect()` so it's ready for the first opening. |
| Screen context | A `screen` prompt holding `{{ page_context }}`, filled by the page through `setDynamicPrompt` | Lets "book this one" resolve. Needs `allow_client_variables: true`. |
| `requireDisclosureAck` | `true` | EU AI Act Art. 50. The page calls `acknowledgeDisclosure()` before kickoff. |
| Avatar | Chosen from `avatars.listTemplates`, plus our background | Her look follows [DESIGN.md § Persona](DESIGN.md#persona) |

Set every capability in `intellects.create()`, not in a later update. `npm run provision` does this once.

Prompt text has no such cache. After editing a `prompts/*.md` file, run `npm run update-prompts` (`kaltura.intellects.setPrompts`, a read-merge-write) to push it to the live intellect. No re-provisioning needed. The exception is `base-directive.md`: only `npm run provision` sets it.

## Tools

All 18 tools are `tools.client`: the model's call surfaces as a `type:"tool"` stream segment the page's already-open socket parses, dispatched to `session.onToolCall(name, handler)` (`client/app.js`). None of them are server-side webhooks, so the local app needs no public URL (see [Why a proxy](#why-a-proxy)).

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
| `show_sessions` | `sessionIds`, `title` | Dashed blocks in the day/week grid, in each session's real day and time. A session with no scheduled time is silently dropped; `rules.md` tells the agent to filter those out and say so instead of calling this tool with them. A single ID that is already on screen is pointed at, like `point_at`, instead of redrawing the grid. |
| `render_schedule` | `day?`, `focusIds?` | Redraws the canvas from `/api/schedule` |
| `highlight_conflict` | `sessionId`, `conflictsWith`, `options` | Conflict sheet with swap choices |
| `celebrate_action` | `kind` | Small success moment (see [DESIGN.md § Motion](DESIGN.md#motion)) |
| `show_recap` | none | Recap card (Phase 4) |
| `point_at` | `sessionId` | Point ring on the block with that `data-session`. Jumps it into view only if it's off screen. |

The system prompt caps each turn at one client-tool call followed by one to three spoken sentences. Each client tool's description repeats "call once, then speak, never retry". This keeps turns short and stops repeated tool calls.

## Search

The catalog is too big to page through inside a turn. Search runs on our index, fed by the [catalog sync](AWS-EVENTS-INTEGRATION.md#catalog-sync).

| Option | What | Status |
|---|---|---|
| B (primary) | Our index: word overlap plus structured filters (day, time, venue, level). Top 5 through `search_sessions`. | Built |
| A (spike) | Kaltura knowledge base: one record, `buildIndexerObjects(['document'])`, one `uploadMarkdown` per session, poll indexing, then set `knowledge_ids` and `use_knowledge_base: 'on'` in one write | Proven pattern in the SDK's docs site. The spike compares its ranking with option B. |

Option B stays the default because ranking and filters stay in our code. A can replace it later without changing the tool or the UI.

Search ranks by how many query words a session matches, so the agent needs the catalog's own words. The `catalogTags` prompt carries every tag in the catalog, shortened, as one line (`prompts/catalog-tags.md`, about 1,100 tokens).

- `npm run catalog-tags` rebuilds it (`scripts/catalog-tags.mjs`). It fails if the line goes over its budget.
- Tags change rarely, so the file is built once and not per session. If the catalog gains new tags, rerun `npm run catalog-tags` (you must be signed in through `npm start`), then `npm run update-prompts`.
- Shortening (`catalogTags()` in `server/catalog.mjs`): drop "Amazon" and "AWS", keep an abbreviation over the full name, group variants under their parent ("EC2 (Graviton, Spot)") and drop tags on a third of the catalog or more.

Derived data in the index:

- Repeats: see the matching rule in [AWS-EVENTS-INTEGRATION.md § Session shape](AWS-EVENTS-INTEGRATION.md#session-shape).
- Venue: map the free-text `venue` to the six known venues.
- Travel: a static venue-to-venue minutes table. It stays provisional until AWS publishes 2026 transport details.

## Evals

`npm run eval` drives the same shared intellect real attendees use, over a real `KalturaChatSession`, with no browser and no mock. Rules first, then an LLM judge for what rules can't check.

| Part | Job | Lives in |
|---|---|---|
| `expectations.mjs` | Rule-check primitives: did the right tool fire, with what args, does the reply contain or exclude given text. | `server/evals/` |
| `judge.mjs` | Shells out to the `claude` CLI (`-p --model haiku --output-format json --tools '' --bare`, no permissions) for one-line PASS/FAIL judgments on tone, helpfulness and correctness. `--bare` skips OAuth logins, so the CLI needs `ANTHROPIC_API_KEY` or Bedrock credentials. No new npm dependency. | `server/evals/` |
| `cases.mjs` | About 55 cases: one per tool, `rules.md` compliance, restricted topics, multi-turn flows, edge cases. | `server/evals/` |
| `runner.mjs` | Starts the app in-process twice: once with the tokens in `NEVADA_HOME` (required, so evals never use your real `~/.nevada`), once signed out with an empty temp home. Builds one `KalturaChatSession` per case, wires all 18 tools the same way `client/app.js` does, runs each case's turns, checks rules then judge rubrics, and undoes any real AWS change a case made, both new and removed items, by diffing `/api/schedule` before and after. | `server/evals/` |

Write-tool cases (reserve, favorite, cancel, personal time) run for real against whatever AWS account the tokens in `NEVADA_HOME` belong to. To sign in, run `NEVADA_HOME=<folder> npm start` once with the test account, then run the evals with the same `NEVADA_HOME`. `runner.mjs` refuses to run them against an account that already has reservations, favorites or personal time: evals need a dedicated, empty AWS test account, never a real attendee's week. Cleanup is generic, not per-case: `runner.mjs` snapshots the schedule before and after each case and cancels/unfavorites/deletes exactly what's new, since the live catalog's session IDs aren't known ahead of time. It also puts back anything the case removed. A recreated personal-time block keeps its title, day and times but not its description.

Evals run only locally, with Claude Code as the judge, never in CI: sign-in needs a human, and the catalog loads only after sign-in. CI still runs `server/test/evals.test.mjs`, which checks every case definition and rule check without any live call.

## Runtime

- Load the SDK as ESM from jsDelivr pinned to the tag: `https://cdn.jsdelivr.net/gh/kaltura/intelligent-agents-sdk@v1.26.0/src/experience/index.js`. Never `@latest`. Node code uses the GitHub tarball of the commit that tag points to.
- Add an import map with SRI. Run `node tools/sri-map.mjs --entry <path> --tag v1.26.0` in the SDK repo once per subpath used (today `experience/index.js`, `experience/chroma-key.js` and `experience/noise-suppressor.js`), then merge the integrity blocks. Browsers enforce it from Chrome 127 and Firefox 138. Others skip the check.
- Load socket.io-client 4.7.5 from a CDN with SRI and pass it as `avatar.socketFactory`. Its hash was taken from the CDN file, so check it against the npm tarball once.
- Token: the page posts to `/api/agent/init` and gets the session KS and the avatar URLs (see [§ Identity](#identity)). No secret touches the browser.
- `requireDisclosureAck` and `micStartMode` are avatar config keys. `acknowledgeDisclosure()`, `startMic()` and `startPlayback()` live on `session.transport`, not on the session. The transport is `null` until `connect()`, so wire its events in the `transportChanged` listener. It fires on the first connect and on every `switchMode`.
- Expo-floor noise: `micConstraints: false` plus `noiseProcessor: createNoiseSuppressor({ thresholdDb: -50 })` from `@kaltura/intelligent-agents/experience/noise-suppressor`, both avatar config keys. Raw audio in, so the browser-native Tier-1 suppressor doesn't double-process the signal ahead of the SDK's own AudioWorklet gate.
- Media: `<video autoplay playsinline muted>` plus a separate `<audio autoplay>`. With a separate audio element the video stream has no audio track, so `muted` costs nothing and helps iOS autoplay. Leave `preferredVideoCodec` unset.
- The video element sits in one fixed frame and never moves in the DOM, because moving it pauses playback. Frame sizes change with CSS only (see [DESIGN.md § Avatar frame](DESIGN.md#avatar-frame)). When video stops, keep the last frame as a still.
- Typed and tapped turns use `session.sendText(text)` in avatar mode. The avatar speaks the answer, so there is no mode switch. It interrupts Nevada mid-sentence, except during an uninterruptible line such as the opening, where the SDK holds it. It throws before the disclosure is accepted, so the page holds turns until then. Taps send a label plus the session ID.
- Screen context: one `syncScreen()` call site sends `setDynamicPrompt({view, day, visible, focused})` with session IDs only. Each call replaces the whole value, and it needs a connected session.
- Mic level: the `localMicLevel` event lives on the transport, so wire it in `transportChanged`.
- Start: `micStartMode: 'deferred'`, then `startMic()` from a tap. On a `playback_blocked` warning, the next tap anywhere calls `startPlayback()`.
- Background: `hiddenGraceMs` stays at 30 s. On return to the foreground, reconnect quietly (see [EXPERIENCE-UX.md § Network and backgrounding](EXPERIENCE-UX.md#network-and-backgrounding)). If the OS kills the tab first, the backend's idle timeout cleans up. We accept that gap.
- `setAudioOutput` returns `false` without `setSinkId`, as on iOS. Don't show a speaker picker there.
- Bad networks: TURN over TCP 443 (`turns:HOST:443?transport=tcp`) first, then `switchMode('chat')` as a fallback only. `setAsrBandwidth` caps the mic uplink.
- The chat fallback shares the thread through `KalturaAgentSession.switchMode()`, which buffers up to 8 `sendText` calls. Call `switchMode('avatar')` only from a real tap, because the browser needs a gesture for audio and the mic.

All styling is ours (see [DESIGN.md](DESIGN.md)).
