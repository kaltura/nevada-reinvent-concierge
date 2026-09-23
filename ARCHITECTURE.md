[← Back to README](README.md)

# Architecture

## Components

```
Attendee's browser                 Our hosted backend                  Kaltura platform            AWS Events API
──────────────────                 ──────────────────                  ────────────────            ──────────────
Concierge web app  ───WebRTC/HTTP──▶ Kaltura Management (Node)
 (voice + chat UI,                    - provisions/updates the intellect
  schedule canvas,                    - runs the catalog sync job   ─────────────────────ListSessions──▶
  session cards)                      - runs the token-refresh job  ─────────────────────refresh grant──▶
       ▲                              - runs the session-search service
       │ client-command                     │
       │ tool segments                      │ tool_ids / secrets
       │ (silent, over the                  ▼
       │ live socket)              Kaltura agent (avatar/chat)  ──api tool calls──▶ AWS Events API
       │                                (voice or text transport)   (bearer = attendee's live token)
       └────────────────────────────────────┘

One-time local pairing (per attendee, once):
  attendee's machine ──PKCE──▶ oauth.awsevents.com ──code──▶ attendee's machine
        │
        └── refresh token ──pairing code──▶ our hosted backend (stored per attendee)
```

Three planes, matching the SDK's own model (see the SDK's `docs/ARCHITECTURE.md`): **Management** (Node, server-side — provisions the intellect, owns secrets, runs the sync/refresh jobs), **Conversation/text** and **Runtime/video** (the attendee-facing agent, voice or chat).

## The auth bridge

1. **Local pairing helper** — a small, single-purpose script (distributed as `npx reinvent-concierge-login` or a downloadable one-file executable). It does exactly one thing: run the PKCE exchange against `oauth.awsevents.com` on a loopback redirect, get a refresh token, hand it to our backend via a short-lived pairing code (e.g. a 6-character code the attendee also sees on the web app, so the two sides correlate without needing a login on the CLI side), then exit. It never talks to Kaltura and never sees anything beyond the AWS token exchange.
2. **Backend stores the refresh token** per attendee, encrypted at rest, keyed to whatever identity the concierge web app uses for that attendee (a lightweight session/account, separate from AWS Builder ID).
3. **Token-refresh job** — per paired attendee, roughly every 50 minutes: exchange the refresh token for a fresh 60-minute access token, push it into that attendee's Kaltura intellect config secret via `mgmt.intellects.secrets.set(configId, {AWS_EVENTS_TOKEN: accessToken}, adminKs)`. This means every attendee needs their **own intellect/agent configuration** (so their own token secret doesn't collide with anyone else's) — see [Per-attendee provisioning](#per-attendee-provisioning) below.
4. If a refresh itself fails (30-day idle expiry, or the attendee revoked consent), mark that attendee as needing to re-run the pairing helper, and have the agent say so plainly rather than silently failing tool calls.

## Per-attendee provisioning

Rather than one shared intellect for every attendee (which would mean one shared secret slot — a real collision risk the SDK's own tools docs flag explicitly as a hazard for globally-named tools/secrets), provision one Kaltura intellect config per attendee, cloned from a single template at signup time:

- Template holds the fixed parts: prompts, capabilities, the client-command tool set (identical for everyone), voice/persona config.
- Per-attendee parts: the `AWS_EVENTS_TOKEN` secret, and the `api` tools that reference it (also provisioned per attendee, or built once with the secret name parameterized — needs a build-time check against the SDK's actual tool-cloning primitives before locking this down; flagged as an open item in [ROADMAP.md](ROADMAP.md)).
- Capabilities are set once, at creation, per the SDK's own hard rule (~24h partner-config cache) — never create-then-update.

## Tool inventory

### Server-side `api` tools (secret-authenticated, call AWS Events directly — no proxy layer needed)

| Tool | AWS operation | Notes |
|---|---|---|
| `get_my_schedule` | `GetSchedule` | Called before the agent states anything about the attendee's current plan — never trust conversation memory over a fresh read |
| `search_sessions` | *(ours, not AWS)* | See [Session discovery](#session-discovery-search-not-pagination) below — this is the one tool that does NOT call AWS Events directly |
| `favorite_sessions` / `unfavorite_session` | `AssociateFavorites` / `DisassociateFavorite` | Batches of 1–10; surface per-session failures individually, per [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md#endpoints-this-project-uses) |
| `reserve_sessions` / `cancel_reservation` | `ReserveSessions` / `CancelReservation` | Gated off (agent explains "not open yet") before reserved seating opens — see lifecycle table |
| `add_personal_time` / `update_personal_time` / `delete_personal_time` | `CreatePersonalTime` etc. | For travel, meetings, breaks |

Every write tool's `responseMapping` should return a short structured result (succeeded IDs, failed IDs + reason) — never the raw AWS response — so the model has exactly what it needs to speak the outcome accurately without over-fetching.

### Client-command tools (`tools.client()`, drive our own page UI — no server call at all)

| Tool | Fires | Rendered by |
|---|---|---|
| `show_sessions` | After a search or recommendation | A session-card panel (title, time, room, level, one-line abstract, favorite/reserve buttons) |
| `render_schedule` | After any schedule change, or on request | The weekly schedule canvas, re-drawn from the latest `GetSchedule` read |
| `highlight_conflict` | When a reservation attempt clashes | Visually flags the two clashing blocks on the canvas |
| `celebrate_action` | On a successful favorite/reserve | A small, deliberately restrained UI acknowledgment — see [EXPERIENCE-UX.md](EXPERIENCE-UX.md) for why "restrained" is a real design choice here, not an afterthought |

`kaltura_genie_experiences` must be `off` at creation for this intellect — it's a command-driven agent, and the SDK's own docs are explicit that leaving the master GenUI switch on injects a competing instruction that out-competes custom tools. RAG (`use_knowledge_base`) can stay on independently of this switch if the RAG experiment below is adopted — the SDK's own docs confirm knowledge retrieval and command tools coexist fine with experiences off.

Per the SDK's tool-spiral guidance, the system prompt carries an explicit tool-call budget (one `show_sessions`/`render_schedule` call per turn, always followed by 1–3 spoken sentences) and each fire-and-forget client tool's own `description` repeats the "call once, then speak, never retry" instruction — the documented mitigation for exactly this failure mode.

## Session discovery: search, not pagination

The catalog is too large to walk live inside a conversation turn (a `ListSessions` pagination loop inside a tool call is exactly the tool-call-spiral pattern the SDK's docs warn against, and it would blow well past any reasonable per-turn budget). Two candidate designs, evaluated:

**A. Kaltura's own knowledge base / RAG** (`opts.knowledge` in `provision.js`, `use_knowledge_base` capability). Confirmed as real scaffolding: `createCategory` → `addRecord` → `addSource({type:'internal', categoryIds:[...]})` → `intellectConfig.setKnowledgeIds` (capped at one record) → `setEnabled`. What's **not yet confirmed** from reading the SDK alone is the exact per-document ingestion path — how ~1,500+ individual session records actually become indexed, retrievable content under that one knowledge record. This needs a hands-on spike before it can be relied on for the launch date.

**B. A small retrieval service we own**, exposed to the agent as a single `search_sessions(query, filters?)` `api` tool pointed at our own backend (not AWS Events directly): the sync job (see [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md#catalog-sync-strategy)) keeps a local index (embeddings + structured filters — track, level, day, room) up to date, the tool does a top-K semantic + filtered lookup, and returns a short list of `sessionId`s plus enough fields for `show_sessions` to render cards. The model never sees the full catalog; it sees 5–10 relevant results per query.

**Recommendation: build B as the primary path.** It's fully within our control, has no unconfirmed SDK behavior on the critical path, and lets us tune ranking (recency, personalization weights from onboarding, explicit filters) directly. Spend a short, bounded spike on A in parallel — if Kaltura's native RAG turns out to ingest structured records cleanly, it's a strong candidate to *replace* B later with zero attendee-facing change (same `search_sessions` tool, same `show_sessions` output). Don't block the plan on A resolving first.

## Two agent surfaces, one thread

Voice (`KalturaAvatarSession`) and chat (`KalturaChatSession`) share one conversation via `KalturaAgentSession.switchMode()` — same thread, same `request_vars`, same `onToolCall` handlers, carried across transports automatically. This is why the client-command tools above work identically whichever surface the attendee is on; only the GenUI widget path (chat-only, per [EXPERIENCE-UX.md](EXPERIENCE-UX.md#two-surfaces-voice--client-commands-vs-chat--genui)) differs between the two.

## Related docs

| Doc | Covers |
|---|---|
| [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md) | The API contract these tools call |
| [EXPERIENCE-UX.md](EXPERIENCE-UX.md) | What the attendee actually sees/hears |
| [ROADMAP.md](ROADMAP.md) | Build phases and the open items flagged above |
