/**
 * The 12 server tool handlers the proxy runs. Each returns {answer} for the
 * intellect's `responseTemplate: '{answer}'`. Rules: prompts/rules.md.
 * Contract: ARCHITECTURE.md § Tools, AWS-EVENTS-INTEGRATION.md.
 */
import {
  AwsError, withToken, getSchedule, getSession, reserveSessions, cancelReservation,
  associateFavorites, disassociateFavorite, createPersonalTime, updatePersonalTime, deletePersonalTime,
} from './aws.mjs';
import { dayToDate, localToUtcNaive, utcNaiveToLocal, utcNaiveSpanToLocal, speakTime, formatClock, minutesOf, dayIndex, EVENTS_API_OPENS } from './dates.mjs';
import { travelMinutes } from './catalog.mjs';

function label(catalog, id) {
  const s = catalog.get(id);
  return s ? `${s.title} (session ${id})` : `session ${id}`;
}

function pairingMessage(outcome) {
  return outcome.expired
    ? 'Your AWS connection expired. Sign in again to see your schedule.'
    : 'Connect your AWS Events account to do that.';
}

/**
 * One short sentence for an error from an AWS call: an AwsError, a network
 * error, or a failed token write. Shown in the page banner after "Signed in,
 * but" and spoken by the tools, so every AWS case starts with "AWS".
 */
export function awsProblem(e) {
  // fs errors (EACCES, EROFS) and tokens.mjs's unsafe_home carry a code; AwsError and fetch's network TypeError don't.
  if (!(e instanceof AwsError) && typeof e?.code === 'string') return "Nevada can't save your sign-in on this computer. See the terminal.";
  if (Date.now() < Date.parse(`${localToUtcNaive(EVENTS_API_OPENS, '00:00')}Z`)) return 'AWS opens your schedule to Nevada on 8 October.';
  if (!(e instanceof AwsError)) return "AWS can't be reached right now. Check your internet connection.";
  if (e.status === 403 && e.body && typeof e.body === 'object') return 'AWS says you are not registered for re:Invent.';
  if (e.status === 403) return 'AWS blocked that just now. Try again in a minute.';
  if (e.status === 429 || e.status >= 500) return 'AWS is busy. Try again in a minute.';
  return "AWS didn't answer as expected. Try again in a minute.";
}

function awsErrorMessage(e) {
  if (e.status === 409) return "That's not open right now. Try again later.";
  return awsProblem(e);
}

const BULK_SPEECH = {
  scheduleConflict: (f, catalog) => `clashes with ${(f.conflictsWith || []).map((id) => label(catalog, id)).join(', ') || 'another session'}`,
  sessionFull: () => 'is full',
  alreadyScheduled: () => 'was already reserved',
  alreadyFavorited: () => 'was already a favorite',
  notFavorited: () => "wasn't a favorite",
  sessionNotReservable: () => "can't be reserved",
  insufficientAccess: () => "isn't included in your pass",
  timePassed: () => 'already started',
  unknownSession: () => "isn't a session I recognize. Search first, then try again with its real ID",
};
function speakFailure(catalog, f) {
  const fn = BULK_SPEECH[f.code];
  return fn ? fn(f, catalog) : "couldn't be done";
}
function bulkSpeech(catalog, result, verb) {
  const { successful = [], failed = [] } = result ?? {};
  const parts = [];
  if (successful.length) parts.push(`${verb} ${successful.map((id) => label(catalog, id)).join(', ')}.`);
  for (const f of failed) parts.push(`${label(catalog, f.sessionId)} ${speakFailure(catalog, f)}.`);
  return parts.join(' ') || 'Nothing changed.';
}

function overlaps(catalog, otherId, s) {
  const o = catalog.get(otherId);
  if (!o?.sessionTime || !s?.sessionTime || o.sessionTime.date !== s.sessionTime.date) return false;
  const oStart = minutesOf(o.sessionTime.time);
  const sStart = minutesOf(s.sessionTime.time);
  const oEnd = oStart + (Number(o.sessionTime.length) || 60);
  const sEnd = sStart + (Number(s.sessionTime.length) || 60);
  return oStart < sEnd && sStart < oEnd;
}
function fits(catalog, sessionId, reservedIds) {
  const s = catalog.get(sessionId);
  if (!s?.sessionTime) return true;
  return !reservedIds.some((id) => overlaps(catalog, id, s));
}

/** Conflict speech: names the clash and the swap options. EXPERIENCE-UX.md § Conflict swap. */
function conflictSpeech(catalog, f, reservedIds) {
  const clashLabels = (f.conflictsWith || []).map((id) => label(catalog, id));
  const options = [];
  for (const rep of catalog.getRepeats(f.sessionId)) {
    if (rep === f.sessionId || !fits(catalog, rep, reservedIds)) continue;
    options.push(`take the repeat ${label(catalog, rep)}`);
  }
  options.push(`swap out ${clashLabels.join(', ') || 'the clashing session'} and keep ${label(catalog, f.sessionId)}`);
  return `${label(catalog, f.sessionId)} clashes with ${clashLabels.join(', ') || 'another reserved session'}. Options: ${options.join('; or ')}.`;
}

async function reconciled(ctx, checkFn) {
  const outcome = await ctx.withToken((token) => getSchedule(token));
  return outcome.paired ? checkFn(outcome.result ?? {}) : null;
}

function validatePersonalTime(title, description, start, end, checkDuration = true) {
  if (!title || title.length > 128) return 'Give it a short title, up to 128 characters.';
  if (!description || description.length > 250) return 'Give it a one-line description, up to 250 characters.';
  if (!start || !end) return 'I need a start and end time.';
  if (!checkDuration) return null;
  const dur = minutesOf(end) - minutesOf(start);
  const noRetry = " Nothing was blocked. Ask the attendee for new times; don't pick your own.";
  if (dur <= 0) return 'The end time must be after the start time.' + noRetry;
  if (dur % 5 !== 0) return 'Personal time blocks must land on a 5-minute step.' + noRetry;
  return null;
}

function toSlot(item) {
  if (item.startDateTime) {
    const { date, time, length } = utcNaiveSpanToLocal(item.startDateTime, item.endDateTime);
    return { date, time, length, venue: null, title: item.title, kind: 'personal', id: item.personalTimeId };
  }
  return {
    date: item.sessionTime?.date, time: item.sessionTime?.time,
    length: Number(item.sessionTime?.length) || 60, venue: item.venue, title: item.title, kind: item.kind,
  };
}

function scheduleSpeech(items, blocks, day) {
  const slots = [...items, ...blocks].map(toSlot).filter((s) => s.date && s.time)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  // Favorited sessions AWS hasn't scheduled yet (no sessionTime) never get a
  // date, so they'd otherwise vanish from every answer. day is only set when
  // the attendee asked about one day, where these never belong.
  const undated = day ? [] : items.filter((i) => i.kind === 'favorite' && !i.sessionTime).map((i) => i.title);
  if (!slots.length) {
    const none = day ? `Nothing scheduled ${day}.` : 'Nothing on your schedule yet.';
    return undated.length ? `${none} Also favorited, not yet scheduled: ${undated.join(', ')}.` : none;
  }
  const parts = [];
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i];
    const kindWord = s.kind === 'reserved' ? 'reserved' : s.kind === 'favorite' ? 'favorited' : 'blocked';
    // Personal time IDs have no session in the catalog to fall back on, so
    // update/delete_personal_time need the id spoken here or the model has
    // nothing real to pass them.
    const idPart = s.kind === 'personal' && s.id ? ` (personal time ${s.id})` : '';
    parts.push(`${speakTime(s.date, s.time)}: ${s.title}${idPart} (${kindWord})`);
    const next = slots[i + 1];
    if (next) {
      // Absolute minutes, not date-relative: a block ending past midnight is
      // dated on the day it started, so a same-date check would miss a real
      // overlap with (or tight connection to) the next day's early session.
      const gap = (dayIndex(next.date) - dayIndex(s.date)) * 1440 + minutesOf(next.time) - (minutesOf(s.time) + s.length);
      if (gap < 0) {
        parts.push(`clashes with ${next.title}`);
      } else {
        const need = travelMinutes(s.venue, next.venue);
        if (need > gap) parts.push(`tight: only ${gap} minutes from ${s.venue} to ${next.venue}, usually needs ${need}`);
      }
    }
  }
  if (undated.length) parts.push(`also favorited, not yet scheduled: ${undated.join(', ')}`);
  return `${parts.join('. ')}.`;
}

export const TOOL_HANDLERS = {
  async get_topics(args, ctx) {
    const tracks = ctx.catalog.topTracks(8);
    if (!tracks.length) return { answer: "I don't have the catalog loaded yet. Try again in a moment." };
    return { answer: `The most common topics right now: ${tracks.join(', ')}.` };
  },

  async search_sessions(args, ctx) {
    // Otherwise a failed sync sounds like "no match" and the model asks the attendee to rephrase.
    if (!ctx.catalog.size()) return { answer: "I don't have the catalog loaded yet. Try again in a minute." };
    const results = ctx.catalog.search(args);
    if (!results.length) {
      return { answer: args.mode === 'wildcard' ? "I couldn't find a wildcard pick right now." : 'No sessions matched that. Try different words or drop a filter.' };
    }
    const lines = results.map((s) => {
      const when = s.sessionTime ? speakTime(s.sessionTime.date, s.sessionTime.time) : 'time to be announced';
      return `${s.title} (session ${s.sessionId}), ${when}${s.venue ? `, ${s.venue}` : ''}${s.seatAvailability ? `, ${s.seatAvailability}` : ''}`;
    });
    return { answer: `Found: ${lines.join('; ')}.` };
  },

  async get_session({ sessionId }, ctx) {
    let s = ctx.catalog.get(sessionId);
    // AWS-EVENTS-INTEGRATION.md: seat availability changes fast during event
    // week, syncing hourly. A single session missed by (or gone stale since)
    // the last full sync gets a live GetSession instead of staying wrong or
    // permanently unreachable until the next sync. Needs the attendee's token,
    // so when signed out this keeps the cached copy.
    const stale = !s || !ctx.catalog.lastSync() || Date.now() - ctx.catalog.lastSync() > 60 * 60 * 1000;
    if (stale) {
      const outcome = await ctx.withToken((token) => getSession(token, sessionId)).catch(() => null);
      if (outcome?.paired && outcome.result) {
        ctx.catalog.upsert(outcome.result);
        s = ctx.catalog.get(sessionId);
      }
    }
    if (!s) return { answer: "I don't have that session. Search first, then ask again with its ID." };
    const parts = [`${s.title} (session ${s.sessionId})`];
    if (s.sessionTime) parts.push(speakTime(s.sessionTime.date, s.sessionTime.time));
    if (s.venue) parts.push(s.venue);
    if (s.level) parts.push(`level ${s.level}`);
    if (s.seatAvailability) parts.push(s.seatAvailability);
    if (s.isReservable === false) parts.push('not reservable');
    const repeats = ctx.catalog.getRepeats(sessionId).filter((id) => id !== sessionId).map((id) => label(ctx.catalog, id));
    if (repeats.length) parts.push(`repeats: ${repeats.join(', ')}`);
    return { answer: `${parts.join(', ')}.` };
  },

  async get_my_schedule({ day }, ctx) {
    try {
      const outcome = await ctx.withToken((token) => getSchedule(token));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      const { reserved = [], favorites = [], personalTime = [] } = outcome.result ?? {};
      const wantDate = day ? dayToDate(day) : null;
      const items = [
        ...ctx.catalog.getMany(reserved).map((s) => ({ ...s, kind: 'reserved' })),
        ...ctx.catalog.getMany(favorites).map((s) => ({ ...s, kind: 'favorite' })),
      ].filter((s) => !wantDate || s.sessionTime?.date === wantDate);
      const blocks = personalTime.filter((p) => !wantDate || utcNaiveToLocal(p.startDateTime).date === wantDate);
      return { answer: scheduleSpeech(items, blocks, day) };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
  },

  async favorite_sessions({ ids }, ctx) {
    if (!ids?.length) return { answer: 'Tell me which sessions to favorite.' };
    // A model that fabricates an ID instead of asking must hear it was wrong,
    // not a plausible-sounding AWS response for a session that never
    // existed. Same bug and fix as delete_personal_time.
    const known = ids.filter((id) => ctx.catalog.get(id));
    const unknown = ids.filter((id) => !ctx.catalog.get(id)).map((sessionId) => ({ sessionId, code: 'unknownSession' }));
    if (!known.length) return { answer: bulkSpeech(ctx.catalog, { failed: unknown }, 'Favorited') };
    try {
      const outcome = await ctx.withToken((token) => associateFavorites(token, known));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      const successful = outcome.result?.successful ?? [];
      const undated = successful.filter((id) => !ctx.catalog.get(id)?.sessionTime).map((id) => label(ctx.catalog, id));
      const note = undated.length ? ` ${undated.join(', ')} ${undated.length > 1 ? "don't" : "doesn't"} have a time yet, so I put ${undated.length > 1 ? 'them' : 'it'} under "not yet scheduled" instead of on a day.` : '';
      const result = { ...outcome.result, failed: [...(outcome.result?.failed ?? []), ...unknown] };
      return { answer: bulkSpeech(ctx.catalog, result, 'Favorited') + note };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
  },

  async unfavorite_session({ id }, ctx) {
    if (!id) return { answer: 'Which session should I unfavorite?' };
    let schedOutcome;
    try {
      schedOutcome = await ctx.withToken((token) => getSchedule(token));
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
    if (!schedOutcome.paired) return { answer: pairingMessage(schedOutcome) };
    // Without this check, a fabricated id 404s AWS, then reconciliation below
    // trivially finds it "gone", a false-positive "Removed" for a session
    // that was never favorited. Same bug and fix as delete_personal_time.
    if (!(schedOutcome.result?.favorites || []).includes(id)) {
      return { answer: "I can't find that in your favorites. Ask for your schedule to see current ones." };
    }
    try {
      const outcome = await ctx.withToken((token) => disassociateFavorite(token, id));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      return { answer: `Removed ${label(ctx.catalog, id)} from favorites.` };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      if (e.status === 500 || e.status === 503 || e.status === 404) {
        const gone = await reconciled(ctx, (r) => !(r.favorites || []).includes(id));
        return { answer: gone ? `Removed ${label(ctx.catalog, id)} from favorites.` : "I'm not sure that went through. Ask for your schedule to check." };
      }
      return { answer: awsErrorMessage(e) };
    }
  },

  async reserve_sessions({ ids }, ctx) {
    if (!ids?.length) return { answer: 'Tell me which session to reserve.' };
    // A model that fabricates an ID instead of asking must hear it was wrong,
    // not a plausible-sounding AWS response for a session that never
    // existed. Same bug and fix as delete_personal_time.
    const known = ids.filter((id) => ctx.catalog.get(id));
    const unknown = ids.filter((id) => !ctx.catalog.get(id)).map((sessionId) => ({ sessionId, code: 'unknownSession' }));
    if (!known.length) return { answer: `Nothing was reserved, because I don't recognize ${unknown.map((f) => label(ctx.catalog, f.sessionId)).join(', ')}. Tell the attendee nothing was reserved, then offer to search.` };
    try {
      const outcome = await ctx.withToken((token) => reserveSessions(token, known));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      const { successful = [], failed = [] } = outcome.result ?? {};
      const allFailed = [...failed, ...unknown];
      const parts = [];
      if (successful.length) parts.push(`Reserved ${successful.map((id) => label(ctx.catalog, id)).join(', ')}.`);
      if (allFailed.length) {
        // Only for swap options: an AWS error here must not hide the seats already reserved.
        const schedOutcome = await ctx.withToken((token) => getSchedule(token)).catch(() => null);
        const reservedIds = schedOutcome?.paired ? (schedOutcome.result?.reserved ?? []) : [];
        for (const f of allFailed) {
          parts.push(f.code === 'scheduleConflict' ? conflictSpeech(ctx.catalog, f, reservedIds) : `${label(ctx.catalog, f.sessionId)} ${speakFailure(ctx.catalog, f)}.`);
        }
      }
      return { answer: parts.join(' ') || 'Nothing was reserved.' };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      if (e.status === 409) {
        // EXPERIENCE-UX.md § Lifecycle promises "I'll keep this on your list";
        // make that true instead of just saying it.
        const favOutcome = await ctx.withToken((token) => associateFavorites(token, known)).catch(() => null);
        const kept = favOutcome?.paired ? (favOutcome.result?.successful ?? []) : [];
        if (!kept.length) return { answer: "Reserved seating isn't open yet." };
        // A favorite-fallback never goes through AWS's own reservation
        // conflict check (that only runs on a real ReserveSessions), so an
        // overlap with something already on the schedule would otherwise go
        // unmentioned. Check it here instead.
        const schedOutcome = await ctx.withToken((token) => getSchedule(token)).catch(() => null);
        const priorIds = schedOutcome?.paired
          ? [...(schedOutcome.result?.reserved ?? []), ...(schedOutcome.result?.favorites ?? [])].filter((id) => !kept.includes(id))
          : [];
        const clashes = kept
          .map((id) => ({ sessionId: id, conflictsWith: priorIds.filter((p) => overlaps(ctx.catalog, p, ctx.catalog.get(id))) }))
          .filter((f) => f.conflictsWith.length);
        const clashPart = clashes.length ? ` ${clashes.map((f) => conflictSpeech(ctx.catalog, f, priorIds)).join(' ')}` : '';
        return { answer: `Reserved seating isn't open yet. I favorited that instead so it's easy to book once it opens.${clashPart}` };
      }
      return { answer: awsErrorMessage(e) };
    }
  },

  async cancel_reservation({ id }, ctx) {
    if (!id) return { answer: 'Which reservation should I cancel?' };
    let schedOutcome;
    try {
      schedOutcome = await ctx.withToken((token) => getSchedule(token));
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
    if (!schedOutcome.paired) return { answer: pairingMessage(schedOutcome) };
    // Without this check, a fabricated id 404s AWS, then reconciliation below
    // trivially finds it "gone", a false-positive "Cancelled" for a session
    // that was never reserved. Same bug and fix as delete_personal_time.
    if (!(schedOutcome.result?.reserved || []).includes(id)) {
      return { answer: "I can't find that reservation. Ask for your schedule to see current ones." };
    }
    try {
      const outcome = await ctx.withToken((token) => cancelReservation(token, id));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      return { answer: `Cancelled ${label(ctx.catalog, id)}.` };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      if (e.status === 500 || e.status === 503 || e.status === 404) {
        const gone = await reconciled(ctx, (r) => !(r.reserved || []).includes(id));
        return { answer: gone ? `Cancelled ${label(ctx.catalog, id)}.` : "I'm not sure that cancelled. Ask for your schedule to check." };
      }
      return { answer: awsErrorMessage(e) };
    }
  },

  async swap_reservation({ dropId, addId }, ctx) {
    if (!dropId || !addId) return { answer: 'Tell me which session to drop and which to add.' };
    const dropOutcome = await ctx.withToken((token) => cancelReservation(token, dropId)).catch((e) => { if (e instanceof AwsError) return { paired: true, error: e }; throw e; });
    if (!dropOutcome.paired) return { answer: pairingMessage(dropOutcome) };
    if (dropOutcome.error) return { answer: `Couldn't drop ${label(ctx.catalog, dropId)}. ${awsErrorMessage(dropOutcome.error)}` };
    try {
      const addOutcome = await ctx.withToken((token) => reserveSessions(token, [addId]));
      const failed = addOutcome.result?.failed ?? [];
      if (failed.length) {
        const restore = await ctx.withToken((token) => reserveSessions(token, [dropId])).catch(() => null);
        const gotBack = restore?.result?.successful?.includes(dropId);
        return {
          answer: `${label(ctx.catalog, addId)} ${speakFailure(ctx.catalog, failed[0])}. ${gotBack ? `Kept your seat at ${label(ctx.catalog, dropId)}.` : `I couldn't get your seat back at ${label(ctx.catalog, dropId)} either. Ask for your schedule to check.`}`,
        };
      }
      return { answer: `Swapped. Reserved ${label(ctx.catalog, addId)}, dropped ${label(ctx.catalog, dropId)}.` };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      const restore = await ctx.withToken((token) => reserveSessions(token, [dropId])).catch(() => null);
      const gotBack = restore?.result?.successful?.includes(dropId);
      return {
        answer: `Reserving ${label(ctx.catalog, addId)} failed. ${awsErrorMessage(e)} ${gotBack ? `Kept your seat at ${label(ctx.catalog, dropId)}.` : `I couldn't get your seat back at ${label(ctx.catalog, dropId)} either. Ask for your schedule to check.`}`,
      };
    }
  },

  async add_personal_time({ title, description, day, start, end }, ctx) {
    const err = validatePersonalTime(title, description, start, end);
    if (err) return { answer: err };
    const date = dayToDate(day);
    if (!date) return { answer: 'I need a valid event day, like Tuesday.' };
    const startDateTime = localToUtcNaive(date, start);
    const endDateTime = localToUtcNaive(date, end);
    try {
      const outcome = await ctx.withToken((token) => createPersonalTime(token, { title, description, startDateTime, endDateTime }));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      // CreatePersonalTime returns no ID (AWS-EVENTS-INTEGRATION.md § Personal
      // time), so read it back so later update/delete calls have a real id
      // instead of the model guessing one.
      const schedOutcome = await ctx.withToken((token) => getSchedule(token)).catch(() => null);
      const created = schedOutcome?.paired
        ? (schedOutcome.result?.personalTime || []).find((p) => p.startDateTime === startDateTime && p.endDateTime === endDateTime && p.title === title)
        : null;
      const idPart = created ? ` (personal time ${created.personalTimeId})` : '';
      return { answer: `Blocked ${title}${idPart}, ${speakTime(date, start)} to ${formatClock(end)}.` };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
  },

  async update_personal_time({ id, title, description, day, start, end }, ctx) {
    if (!id) return { answer: 'Which personal time block?' };
    let schedOutcome;
    try {
      schedOutcome = await ctx.withToken((token) => getSchedule(token));
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
    if (!schedOutcome.paired) return { answer: pairingMessage(schedOutcome) };
    const existing = (schedOutcome.result?.personalTime || []).find((p) => p.personalTimeId === id);
    if (!existing) return { answer: "I can't find that personal time block. Ask for your schedule to see current ones." };
    const existingStart = utcNaiveToLocal(existing.startDateTime);
    const existingEnd = utcNaiveToLocal(existing.endDateTime);
    const date = dayToDate(day) ?? existingStart.date;
    const startTime = start ?? existingStart.time;
    const endTime = end ?? existingEnd.time;
    const finalTitle = title ?? existing.title;
    const finalDescription = description ?? existing.description;
    // Only re-check duration when start or end actually changed. An edit that
    // only touches title/description on a block that already spans midnight
    // would otherwise be rejected forever, since its raw HH:MM duration looks negative.
    const timesChanged = start !== undefined || end !== undefined;
    const err = validatePersonalTime(finalTitle, finalDescription, startTime, endTime, timesChanged);
    if (err) return { answer: err };
    try {
      const outcome = await ctx.withToken((token) => updatePersonalTime(token, id, {
        title: finalTitle, description: finalDescription,
        startDateTime: localToUtcNaive(date, startTime), endDateTime: localToUtcNaive(date, endTime),
      }));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      return { answer: `Updated ${finalTitle}, now ${speakTime(date, startTime)} to ${formatClock(endTime)}.` };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
  },

  async delete_personal_time({ id }, ctx) {
    if (!id) return { answer: 'Which personal time block should I remove?' };
    let schedOutcome;
    try {
      schedOutcome = await ctx.withToken((token) => getSchedule(token));
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      return { answer: awsErrorMessage(e) };
    }
    if (!schedOutcome.paired) return { answer: pairingMessage(schedOutcome) };
    // Without this check, a fabricated id (the model guessing instead of using
    // a real one) 404s AWS, then reconciliation below trivially finds it
    // "gone", a false-positive "Removed that block" for a block that never existed.
    const existing = (schedOutcome.result?.personalTime || []).some((p) => p.personalTimeId === id);
    if (!existing) return { answer: "I can't find that personal time block. Ask for your schedule to see current ones." };
    try {
      const outcome = await ctx.withToken((token) => deletePersonalTime(token, id));
      if (!outcome.paired) return { answer: pairingMessage(outcome) };
      return { answer: 'Removed that block.' };
    } catch (e) {
      if (!(e instanceof AwsError)) throw e;
      if (e.status === 500 || e.status === 503 || e.status === 404) {
        const gone = await reconciled(ctx, (r) => !(r.personalTime || []).some((p) => p.personalTimeId === id));
        return { answer: gone ? 'Removed that block.' : "I'm not sure that went through. Ask for your schedule to check." };
      }
      return { answer: awsErrorMessage(e) };
    }
  },
};

/** Build a per-call ctx with withToken already bound to the token store. */
export function makeToolCtx(catalog, tokenStore) {
  return { catalog, withToken: (fn) => withToken(tokenStore, fn) };
}
