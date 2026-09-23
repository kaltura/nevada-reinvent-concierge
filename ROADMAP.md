[← Back to README](README.md)

# Roadmap

Phased build plan. Each phase has a concrete check before moving to the next.

## Phase 0 — Spikes (de-risk before committing to the architecture)

| Spike | Question it answers | Check |
|---|---|---|
| Local pairing helper, minimal version | Does the PKCE loopback flow work end-to-end from a bare script, and does the pairing-code handoff to a backend actually work | One real AWS Builder ID login completes, refresh token lands in our backend |
| `search_sessions` retrieval service, tiny version | Is our own embeddings + filter index (Option B in [ARCHITECTURE.md](ARCHITECTURE.md#session-discovery-search-not-pagination)) good enough on a sample catalog | A handful of realistic queries return sensible top-5 results |
| Kaltura native knowledge-base ingestion | Can individual session records actually be ingested as separate retrievable documents under `opts.knowledge`, or does it only support one coarse record | A test ingestion of 20+ sample sessions either works cleanly or is ruled out — decides whether Option A ever replaces Option B |
| Client-command round-trip | Does `show_sessions`/`render_schedule` fire reliably on a live open-mic session without the GenUI master switch interfering | A live test conversation triggers the tool and the page updates, confirmed via the `type:"tool"` segment |

## Phase 1 — Personal-use MVP

Goal: the concierge works end-to-end for one paired attendee (the builder, first).

- Local pairing helper (hardened from the spike).
- Token-refresh job against one stored refresh token.
- One provisioned intellect, all client-command tools wired, `kaltura_genie_experiences: off` at creation.
- `get_my_schedule`, `favorite_sessions`, `reserve_sessions` (gated by lifecycle phase), personal-time tools.
- `search_sessions` on the chosen retrieval backend, fed by a first catalog sync run.
- Voice surface: schedule canvas, session cards, conflict highlighting.
- "Wildcard pick" and morning-briefing/evening-digest — both low-effort, high-wow per [FEATURES.md](FEATURES.md), pulled into the MVP rather than left for later.

**Check:** a real, unscripted planning conversation — "what should I do Tuesday if I care about agentic AI" → cards appear → "reserve the second one" → canvas updates and reflects a real `GetSchedule` read.

## Phase 2 — Multi-attendee

Goal: any attendee can pair and use it, per the scoping decision in [README.md](README.md#the-scoping-decision-built-for-every-attendee-not-just-one-login).

- Per-attendee intellect provisioning from a template (resolve the open question below first).
- Pairing-code UX on the web app (generate, display, correlate with the CLI helper).
- Per-attendee token-refresh job, scaled from one to many.
- Basic account/session layer on the web app (attendee identity independent of AWS Builder ID).

**Check:** two attendees paired at once, each sees only their own schedule, neither's secret/tool config leaks into the other's.

## Phase 3 — Chat/GenUI surface + personalization

- `KalturaChatSession` surface with real GenUI widgets (`content-gallery`, `sources`, `followups`).
- `switchMode()` wired between voice and chat.
- Personalization onboarding (spoken, revisitable).
- Lifecycle-aware tone shifts.
- Persona presets (builder track / exec track / first-timer) and the first-timer "survival mode" onboarding framing — cheap, canned system-prompt variants over the existing tools, per [FEATURES.md](FEATURES.md).
- Post-session voice recap capture (dictate personal notes per session).

**Check:** start a conversation by voice, switch to chat, confirm `threadContinuity:true` and the schedule state is unchanged across the switch.

## Phase 4 — Polish and launch

- Countdown/anticipation framing pre-Oct-6, event-week morning briefings live.
- Accessibility pass against the checklist in [EXPERIENCE-UX.md](EXPERIENCE-UX.md#accessibility).
- Public landing page explaining the project and the pairing step, since this is also an SDK showcase artifact.
- Load-test the sync job and token-refresh job at realistic attendee counts.

## Explicitly not v1 (and why)

Per [FEATURES.md](FEATURES.md), these are real ideas, deliberately deferred for a concrete reason rather than just deprioritized:

| Feature | Why it's out |
|---|---|
| Team/coworker schedule coordination | Each teammate needs their own local-pairing run — a real multi-person onboarding cost, not just more code |
| Room-walk / venue navigation | The AWS API has no venue-map data at all; would need a separately-sourced map |
| Session "FOMO"/popularity scoring | The API only exposes the banded `seatAvailability` enum, not real numbers — an honest popularity score isn't buildable from this data alone |

## Open questions to resolve before Phase 2

- **Per-attendee tool/secret cloning mechanics.** Confirm the actual SDK primitive for cloning an intellect config + its tool set per attendee (vs. hand-rolling it against the raw Management API) before designing the provisioning pipeline in detail.
- **Kaltura knowledge-base ingestion granularity.** Resolved by the Phase 0 spike — decides whether Option A ever becomes viable, per [ARCHITECTURE.md](ARCHITECTURE.md#session-discovery-search-not-pagination).
- **Pairing-code correlation UX.** Exact mechanism for the web app and the CLI helper to agree on the same attendee without either side needing a shared login first — needs a concrete design, not just the one-paragraph sketch in ARCHITECTURE.md.

## Risks

| Risk | Mitigation |
|---|---|
| Refresh token idles out mid-event (30-day window, unlikely but possible if pairing happens far in advance) | Re-pairing is a one-time, low-friction script re-run; surface it plainly in the agent's own speech rather than a silent tool failure |
| Catalog sync job's own credential hits AWS-side abuse detection at scale | Sync runs under a dedicated service registration, paced well under the 120 req/min `ListSessions` quota, with backoff on `429`/`503` |
| Per-attendee secret/tool cloning turns out to be awkward on the current SDK primitives | Falls out of the Phase 0 spike list above; worst case, a thin custom layer over the raw `/v1/tool/*` and intellect-config APIs |
| Reservation writes reported as failed when they actually succeeded (network drop before the response arrives) | Never blind-retry a write; always reconcile against a fresh `GetSchedule` first, per [AWS-EVENTS-INTEGRATION.md](AWS-EVENTS-INTEGRATION.md#error-handling-this-project-must-implement) |
