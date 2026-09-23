[← Back to README](README.md)

# AWS Events API integration

The contract this project depends on. `eventId` throughout is `reinvent2026`. Full reference: `https://docs.aws.amazon.com/events/latest/devguide/` and the OpenAPI description at `https://api.awsevents.com/v1/openapi.json`.

## Authentication

Confirmed by reading AWS's own docs and by a live, read-only probe against the public authorize endpoint (a benign GET with a foreign `redirect_uri`, which returned `302` to `error?error=redirect_mismatch` from a Cognito-backed authorizer, before any user interaction):

- OAuth 2.0 Authorization Code + PKCE, via AWS Builder ID.
- The redirect URI must be one of a fixed loopback allow-list (`http://127.0.0.1:PORT` / `http://[::1]:PORT` style, exact match). There is no hosted-redirect option and no self-service way to register one. AWS's own docs state it plainly: "You sign in on your own machine. There is no hosted option."
- Access token lifetime: 60 minutes. Refresh token lifetime: 30 days.
- Refreshing needs no further user interaction until the refresh token itself expires (30 days of inactivity).

Implication for this project: the one-time local pairing step (see [README.md § The scoping decision](README.md#the-scoping-decision-built-for-every-attendee-not-just-one-login)) is unavoidable, but it happens once per attendee, not once per session. After pairing, a small background job on our backend uses the refresh token to mint a fresh access token roughly every 50 minutes and pushes it into the Kaltura intellect's secret store (`mgmt.intellects.secrets.set`) so the agent's tools always call AWS Events with a live token. If the refresh token itself goes 30 days idle, the attendee has to re-run the local pairing step — acceptable, since the event itself runs one week.

## Endpoints this project uses

| Operation | Method + path | Auth | Purpose here |
|---|---|---|---|
| `ListSessions` | `GET /v1/events/{eventId}/sessions` | Optional* | Catalog sync (see below) |
| `GetSession` | `GET /v1/events/{eventId}/sessions/{id}` | Optional* | Refresh a single session's detail on demand |
| `GetSchedule` | `GET /v1/events/{eventId}/schedule` | Required | Source of truth for the attendee's own reservations, favorites, personal time |
| `ReserveSessions` | `POST /v1/events/{eventId}/reservations` | Required | Reserve 1–10 sessions |
| `CancelReservation` | (single removal) | Required | Cancel one reservation |
| `AssociateFavorites` | `POST /v1/events/{eventId}/favorites` | Required | Favorite 1–10 sessions (interest only, not a reservation) |
| `DisassociateFavorite` | (single removal) | Required | Unfavorite one session |
| `CreatePersonalTime` / `UpdatePersonalTime` / `DeletePersonalTime` | `POST /v1/events/{eventId}/personal-time` (+ update/delete) | Required | Travel, meetings, breaks — non-session blocks on the schedule |

\* re:Invent requires registration, so `ListSessions`/`GetSession` return `401`/`403` to a caller with no valid token or no event registration, even though the operations are "public" in the API's own terms.

## Session data shape (from `ListSessions`/`GetSession`, verified against the live OpenAPI spec)

Only `sessionId` and `title` are required. Everything else is optional and genuinely absent (not empty-string) when the catalog doesn't have it yet — every reader here must handle a missing `abstract`, `room`, `sessionTime`, or `speakers` as a normal case, not an edge case.

| Field | Shape | Notes |
|---|---|---|
| `abbreviation` | string | Public session code, e.g. `"AIM3315"` |
| `type`, `level` | **free text, not an enum** | e.g. `"Chalk talk"`, `"300 - Advanced"` — the spec gives examples, not a closed value set |
| `tracks`, `topics`, `industries`, `areasOfInterest`, `roles`, `services`, `segments`, `features`, `customerPersonas`, `experiences`, `additionalActivities`, `focusAreas` | arrays of **free-text strings**, ≤100 items each | None are closed enums. The real value set for re:Invent 2026 only exists once the live catalog is populated — a fixed filter dropdown can't be hardcoded, it has to be derived by paging the catalog once and collecting distinct values |
| `sessionTime` | `{date, time, length, timezone}` | `length` is minutes **as a string** |
| `speakers` | array of `{name}`, ≤100 | **No speaker ID, bio, or photo — just a bare name string.** "More from speakers you've favorited" means exact-string matching, which will misfire on name collisions/typos in the catalog |
| `seatAvailability` | true enum: `available \| limited \| veryLimited \| unavailable \| walkUp` | Present only on reservable sessions — the one genuinely closed enum on the object |
| `isAllDaySession`, `isReservable` | boolean | |

**No cross-session relationship data exists anywhere in the schema** — no series ID, no "similar sessions," no room-capacity number (only the banded `seatAvailability` enum). Any "recommend similar sessions" or "more like this" feature has to be built entirely on our side by scoring overlap between sessions' own tag arrays (topics/services/tracks/roles/etc.) — there is no server-side recommendation primitive to lean on. This is exactly what the [session-discovery service](ARCHITECTURE.md#session-discovery-search-not-pagination) already assumes; it's confirmed here as a hard requirement, not a design choice.

`includeAbstracts=false` drops only the `abstract` field (the largest one) — use it for the lightweight "just enough to list" pass, and fetch the full session (with abstract) for detail views or knowledge ingestion.

**`GetSchedule`'s `reserved`/`favorites` arrays are just lists of `sessionId` strings**, not full session objects — rendering the schedule canvas always needs a follow-up `GetSession`/`ListSessions`-backed lookup to get titles, times, and rooms for what's on it.

**No sandbox or non-reinvent test event exists.** `ListEvents` is the only way to discover what's available; any event whose `authenticationRequired` flag is false has a fully public, unauthenticated catalog usable for building/testing the browse-and-render UI before re:Invent's own catalog is usable end-to-end.

## Pagination

Page size is server-set; follow `nextToken` until absent. **A short page does not mean the last page** — stopping early silently drops sessions. `totalCount` is on every page, so the sync job can size its walk up front and detect drift (if `totalCount` changes between two sync passes, the catalog changed mid-walk).

## Catalog sync strategy

The catalog (likely 1,500+ sessions at re:Invent scale) cannot be walked live inside a conversation turn — that's a tool-call-spiral risk on the SDK side (see [ARCHITECTURE.md § Session discovery](ARCHITECTURE.md#session-discovery-search-not-pagination)) and a poor experience regardless. Instead, run a scheduled sync job, outside any conversation:

- **Cadence:** daily while the catalog is stabilizing (through late October), hourly during re:Invent week itself (room/time changes happen).
- **Each run:** walk `ListSessions` fully via `nextToken`, `includeAbstracts=true` (need the full text for search), diff against the last snapshot (added / changed / removed sessions), and feed the diff into whichever session-discovery backend is chosen (see ARCHITECTURE.md).
- **Rate budget:** `ListSessions` is capped at 120 requests/minute per credential. A full catalog walk at realistic page sizes comfortably fits in one minute; no special throttling logic needed for the sync job itself.
- **Quota is per-attendee, not global.** Every quota table entry in `Quotas and throttling` is scoped to the calling attendee's token. The sync job should run under a dedicated service credential (its own AWS Builder ID / registration), separate from any individual attendee's token, so catalog sync traffic never competes with an attendee's own live `GetSchedule`/`ReserveSessions` calls for the same per-minute budget.

## Quotas (requests/minute, per attendee)

| Operation | Quota |
|---|---|
| `GetSession` / `ListSessions` | 120 |
| `GetSchedule` | 60 |
| `ReserveSessions` / `AssociateFavorites` | 30 **sessions** (a batch of 10 costs 10, not 1) |
| `CancelReservation` / `DisassociateFavorite` / `CreatePersonalTime` / `UpdatePersonalTime` / `DeletePersonalTime` | 30 |

A `429` carries `Retry-After` (seconds left in the current minute). None of this project's live per-attendee call patterns (a few schedule reads and small batch reserves per conversation) come close to these limits; the sync job is the only high-volume caller, and it runs under its own credential.

## Error handling this project must implement

| Status | Meaning here | Handling |
|---|---|---|
| `400` | Bad request (bad field, or a `nextToken` we didn't issue) | Don't retry; surface the specific field error to the agent/logs |
| `401` | No valid token, or event requires registration and caller is anonymous | Refresh the access token once and retry; if that fails, the pairing token is dead — prompt re-pairing |
| `403` with JSON body | Signed in but not registered for re:Invent | Don't retry; tell the attendee they need to register for the event first |
| `403` with no body | Edge-level refusal (rate/abuse), not the API | Back off and retry later |
| `404` | Entity gone (session, personal-time entry) | Treat as already-done for a removal; don't retry for a read |
| `409` | Operation currently closed (e.g. reservations before reserved seating opens) | Don't retry immediately; surface "not open yet" to the attendee, don't loop |
| `429` | Quota exhausted for this operation this minute | Wait `Retry-After`, then retry once |
| `500` / `503` | Server error / unavailable | Retry reads with backoff; for writes, see below |

**Writes have no idempotency key.** If a write's outcome is unknown (timeout, dropped connection, `500`, `503`), never blindly re-send it — re-sending `CreatePersonalTime` duplicates the entry; re-sending a batch reserve/favorite reports already-succeeded items as failures on the retry, which is misleading if trusted alone. The safe pattern: after any uncertain write, call `GetSchedule` and reconcile — send only what's actually still missing. Single removals (`CancelReservation`, `DisassociateFavorite`) are the exception: a `404` on retry means it's already gone, which is a safe, final outcome.

**`ReserveSessions` and `AssociateFavorites` report per-session results, not one pass/fail.** A `200` does not mean every session in the batch succeeded — each session in the request gets its own success/failure, and failures carry a reason code (full, clashing with an existing reservation and naming what it clashes with, or already reserved/favorited). Un-recognized reason codes must be treated as an unactionable refusal, since AWS states codes are added over time. This maps directly onto how the concierge should talk about a failed reservation: name the specific session and the specific reason, never a generic "something went wrong."

## Personal time fields (for `CreatePersonalTime`/`UpdatePersonalTime`)

| Field | Required | Constraint |
|---|---|---|
| `title` | Yes | 1–128 chars |
| `description` | Yes | 1–250 chars |
| `startDateTime` / `endDateTime` | Yes | UTC, `YYYY-MM-DDTHH:mm:ss`, no offset/`Z`, to the minute; duration must be a whole number of 5-minute increments |
| `location` | No | ≤255 chars |

`CreatePersonalTime` returns no body — read the new entry's ID back from `GetSchedule`, same reconciliation pattern as any other write.

## Event lifecycle dates that shape the UX

| Date | What changes |
|---|---|
| Now (Sept 2026) | Catalog building, no reserved seating yet |
| ~Oct 6, 2026 | Reserved seating opens on the public re:Invent site |
| ~Oct 8, 2026 | Reserved seating opens via the API — `ReserveSessions` starts returning something other than `409` |
| Dec 1–5, 2026 | Event week |

See [EXPERIENCE-UX.md § Lifecycle-aware personality](EXPERIENCE-UX.md#lifecycle-aware-personality) for how the concierge's own tone and available actions should track this table.

## What the API deliberately does not do

Worth stating so the concierge never promises otherwise: no event registration (attendees register elsewhere), no visibility into other attendees' schedules or favorites, no reservation guarantee (a successful `ReserveSessions` call can still be walked back by the room filling before you arrive — the API surfaces intent, not a physical seat guarantee beyond what AWS's own systems enforce), and no built-in search or filter — `ListSessions` returns the raw catalog only. Search/recommendation is entirely on us; see [ARCHITECTURE.md](ARCHITECTURE.md).
