[← Back to README](README.md)

# AWS Events API integration

The API contract Nevada depends on. `eventId` is `reinvent2026` everywhere. Sources: the [devguide](https://docs.aws.amazon.com/events/latest/devguide/) and the live spec at `https://api.awsevents.com/v1/openapi.json`. Every fact below was checked against both on 2026-09-23.

Only our proxy calls this API. The Kaltura agent never does (see [ARCHITECTURE.md § Why a proxy](ARCHITECTURE.md#why-a-proxy)).

## Authentication

| Item | Value |
|---|---|
| Flow | OAuth 2.0 Authorization Code + PKCE, via AWS Builder ID |
| Client | Shared public client, `client_id` `7vmom55m1qstvq8i71ph127bfq`, no secret. AWS publishes it. |
| Redirect | Exactly `http://localhost:{port}/callback` or `http://127.0.0.1:{port}/callback`, port 8484 to 8489. No wildcards. Any other value gets `redirect_mismatch` (confirmed with a live probe). |
| Hosted redirect | None. The devguide says sign-in "has to run locally". |
| Authorize | `https://oauth.awsevents.com/oauth2/authorize`, with `scope=openid email events/access`, `identity_provider=AWSBuilderID`, `code_challenge_method=S256` |
| Token | `https://oauth.awsevents.com/oauth2/token`, for both the code exchange and `grant_type=refresh_token` |
| Revoke | `https://oauth.awsevents.com/oauth2/revoke`, takes the refresh token |
| Access token | 60 minutes. The only token the API accepts. The ID token is not a substitute. |
| Refresh token | 30 days. A refresh doesn't extend the Builder ID sign-in session, which has its own lifetime the devguide doesn't state. A re-pair can come sooner than 30 days. |

Rules for our backend:

- Schedule each refresh from the `expires_in` the token response returns. Don't hardcode a lifetime.
- If a refresh response carries a new refresh token, store it and drop the old one. The old one may stop working.
- Refresh on demand when the proxy needs a token, not on a timer for every attendee.
- A failed refresh means the attendee must pair again. Say so in speech, never fail silently.
- The devguide asks that server-side tokens stay server-side. Tokens never reach the browser or Kaltura.

The pairing flow that gets the first token is in [ARCHITECTURE.md § Pairing](ARCHITECTURE.md#pairing).

## Endpoints

| Operation | Method and path | Auth | Use |
|---|---|---|---|
| `ListEvents` | `GET /v1/events` | None | Find public test events |
| `GetEvent` | `GET /v1/events/{eventId}` | None | Event details |
| `ListSessions` | `GET /v1/events/{eventId}/sessions` | See note | Catalog sync |
| `GetSession` | `GET /v1/events/{eventId}/sessions/{sessionId}` | See note | Refresh one session |
| `GetSchedule` | `GET /v1/events/{eventId}/schedule` | Required | Source of truth for the attendee's plan |
| `ReserveSessions` | `POST /v1/events/{eventId}/reservations` | Required | Reserve a batch |
| `CancelReservation` | `DELETE /v1/events/{eventId}/reservations/{sessionId}` | Required | Cancel one |
| `AssociateFavorites` | `POST /v1/events/{eventId}/favorites` | Required | Favorite a batch |
| `DisassociateFavorite` | `DELETE /v1/events/{eventId}/favorites/{sessionId}` | Required | Unfavorite one |
| `CreatePersonalTime` | `POST /v1/events/{eventId}/personal-time` | Required | Add a block. Returns `204`, no body. |
| `UpdatePersonalTime` | `PUT /v1/events/{eventId}/personal-time/{personalTimeId}` | Required | Edit a block |
| `DeletePersonalTime` | `DELETE /v1/events/{eventId}/personal-time/{personalTimeId}` | Required | Remove a block |

Note: `ListSessions` and `GetSession` need no auth in the API's own terms. re:Invent sets `authenticationRequired: true`, so they return `401` or `403` without a registered attendee's token. The sync job uses its own service registration.

`ListSessions` takes `locale`, `includeAbstracts` and `nextToken`. `includeAbstracts=false` drops only `abstract`.

## Session shape

Only `sessionId` and `title` are required. Every other field can be absent. Treat a missing field as normal.

| Field | Shape | Notes |
|---|---|---|
| `abbreviation` | string | Public code, e.g. `AIM3315` |
| `type`, `level` | free text | Examples only, no enum |
| `venue` | string | One of the six venues, as free text. Map it to our venue table. |
| `room` | string | Free text |
| `tracks`, `topics`, `industries`, `areasOfInterest`, `roles`, `services`, `segments`, `features`, `customerPersonas`, `experiences`, `additionalActivities`, `focusAreas` | arrays of free-text strings, up to 100 each | No enums. Build filter lists from the synced catalog. |
| `sessionTime` | `{date, time, length, timezone}` | Local date and time. `length` is minutes as a string. |
| `speakers` | array of `{name}` | Name only. No ID, bio or photo. |
| `seatAvailability` | enum: `available`, `limited`, `veryLimited`, `unavailable`, `walkUp` | Only on reservable sessions |
| `isAllDaySession`, `isReservable` | boolean | |

The schema has no series ID, no "similar sessions" and no room capacity. Search, recommendations and repeat detection are ours.

Repeat sessions: in the 2025 catalog, repeats carried a `[REPEAT]` title suffix and a `-R`, `-R1` or `-R2` code suffix. That comes from an unofficial 2025 sample, not a contract. Match on it first, and fall back to matching the normalised title plus the speaker set.

`GetSchedule` returns `reserved` and `favorites` as `sessionId` lists, plus full `personalTime` objects. Rendering needs a lookup in our synced index.

## Pagination

- Follow `nextToken` until it is absent. It is the only end signal.
- Pages hold up to 250 items and can come back short before the end.
- `totalCount` is on every page. If it changes mid-walk, the catalog changed. Walk again.
- Confirmed against a live call: `ListSessions` holds the page's sessions under `items`, not `sessions`.

## Quotas

Per attendee token, per minute. A `429` carries `Retry-After`.

| Operation | Quota |
|---|---|
| `ListSessions`, `GetSession` | 120 requests |
| `GetSchedule` | 60 requests |
| `ReserveSessions`, `AssociateFavorites` | 30 sessions (a batch of 10 costs 10) |
| All single-item writes | 30 requests |

Live attendee traffic is far below these limits. The sync job is the only heavy caller, and it runs on its own credential.

## Errors

| Status | Meaning | Handling |
|---|---|---|
| `400` | Bad field or foreign `nextToken` | Don't retry. Log the field. |
| `401` | No valid token | Refresh once and retry. A second `401` means the refresh token is dead: ask to pair again, don't loop. |
| `403` with JSON body | Signed in but not registered | Don't retry. Tell the attendee to register. Pairing again won't help. |
| `403` with no body | Edge refusal (rate or abuse) | Back off, retry later |
| `404` | Session or personal-time entry gone | See the retry note below |
| `409` | Operation closed, e.g. before reserved seating opens | Don't retry. Say "not open yet". |
| `429` | Quota used up | Wait `Retry-After`, retry once |
| `500`, `503` | Server error | Retry reads with backoff. Reconcile writes. |

Writes have no idempotency key. After any write with an unknown outcome, call `GetSchedule` and send only what is still missing. Never re-send blind. A blind `CreatePersonalTime` retry makes a duplicate.

AWS's two sources disagree on retrying `404`s. The devguide errors page says a `404` on `CancelReservation` or `DisassociateFavorite` means "already done" and is safe. The OpenAPI descriptions say those two are not safe blind retries, and say `DeletePersonalTime` is. We don't pick a side: every uncertain removal is reconciled through `GetSchedule`.

## Bulk results

`ReserveSessions` and `AssociateFavorites` return `{successful, failed}`. A `200` can still hold failures. Each failure has a `sessionId`, a `code` and, for time clashes only, `conflictsWith` (the attendee's overlapping session IDs). `conflictsWith` powers the [conflict swap](EXPERIENCE-UX.md#conflict-swap).

The spec gives no meaning per code, so the draft speech below is inferred from the code names. Check it against live responses.

| `code` | Draft speech |
|---|---|
| `scheduleConflict` | Names the clashing session from `conflictsWith` and offers a swap |
| `sessionFull` | Full. Offers a repeat or walk-up guidance. |
| `alreadyScheduled` / `alreadyFavorited` | Already done, no action |
| `notFavorited` | Nothing to remove |
| `sessionNotReservable` | This one can't be reserved. Offers walk-up guidance. |
| `insufficientAccess` | Your pass may not include it |
| `timePassed` | It already started |
| `other` or any unknown value | Couldn't book it, no reason given |

The enum is open. AWS says to treat unknown values as a generic refusal and not to switch on the list exhaustively.

## Personal time

| Field | Required | Rule |
|---|---|---|
| `title` | Yes | 1 to 128 chars |
| `description` | Yes | 1 to 250 chars |
| `startDateTime`, `endDateTime` | Yes | UTC, `YYYY-MM-DDTHH:mm:ss`, no offset or `Z`. Duration in whole 5-minute steps. |
| `location` | No | Up to 255 chars |

Personal time is UTC, but `sessionTime` is local Las Vegas time (PST, UTC-8 in December). Convert in one place in the proxy. `CreatePersonalTime` returns no ID, so read it back from `GetSchedule`.

## Event facts

From the official re:Invent FAQ and site, checked 2026-09-23.

| Fact | Value |
|---|---|
| Dates | Mon Nov 30 to Fri Dec 4, 2026, Las Vegas |
| Venues | Caesars Forum, Caesars Palace, Encore, MGM Grand, The Venetian, Wynn. Mandalay Bay is gone, and the campus moves north. |
| Scale | 60,000+ attendees, 450+ partners. 47% of 2025 attendees were first-timers. |
| Catalog | Live and growing. AWS quotes different counts on different pages, so never state a number. Read `totalCount`. |
| Security content | Folded in. Security day is Thu Dec 3 at the Wynn. |
| Keynotes | Several across the week. CEO Matt Garman's keynote is Tue Dec 1, morning. |
| Transport | 2026 details come "in the fall". 2025 guidance was 30 to 45 minutes between venues, but Caesars Palace is new, so the 2025 table can't be reused as-is. |

## Lifecycle

| Phase | Dates | API effect |
|---|---|---|
| Catalog live | Until reserved seating opens | Browse and favorite. `ReserveSessions` and `CancelReservation` return `409`. |
| Reserved seating open | Oct 6, 2026 on AWS's own site. Oct 8, 2026 through the API. | `ReserveSessions` and `CancelReservation` start working |
| Event week | Nov 30 to Dec 4 | Seat availability changes fast. Sync hourly. |

Detect the phase from API behaviour (a `409` vs a result), not from a hardcoded date. Dates can move. For two days, attendees can reserve on AWS's site but not through us. Say so: "Seating opened on the AWS site. I can book for you from October 8." The concierge's matching behaviour is in [EXPERIENCE-UX.md § Lifecycle](EXPERIENCE-UX.md#lifecycle).

## Catalog sync

- Runs outside any conversation, on its own service registration.
- Cadence: daily until reserved seating opens, then every 6 hours, then hourly in event week.
- Each run walks `ListSessions` with `includeAbstracts=true`, diffs against the last snapshot, and updates the search index.
- A full walk is about 10 pages, well inside 120 requests a minute.

## Out of scope for the API

No registration, no view of other attendees, no seat guarantee, no search, no venue maps, no shuttle data. The concierge never promises any of these.
