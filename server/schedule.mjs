/**
 * Turns AWS schedule data (session IDs plus personal time) into what the
 * screen shows: session cards and the day's ordered timeline blocks.
 * EXPERIENCE-UX.md § Schedule canvas.
 */
import { dayToDate, dateToDay, dayIndex, utcNaiveSpanToLocal, minutesOf, formatClock, EVENT_DAYS } from './dates.mjs';
import { travelMinutes } from './catalog.mjs';

export function sessionCard(s) {
  return {
    sessionId: s.sessionId, title: s.title, abbreviation: s.abbreviation, type: s.type, level: s.level,
    venue: s.venue, room: s.room, sessionTime: s.sessionTime, speakers: s.speakers,
    seatAvailability: s.seatAvailability, isReservable: s.isReservable, isAllDaySession: s.isAllDaySession,
    day: s.sessionTime ? dateToDay(s.sessionTime.date) : null,
    clock: s.sessionTime ? formatClock(s.sessionTime.time) : null,
  };
}

function minutesToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeSlot(kind, item) {
  if (kind === 'personal') {
    const { date, time, length } = utcNaiveSpanToLocal(item.startDateTime, item.endDateTime);
    const start = minutesOf(time);
    return { date, start, end: start + length, kind, id: item.personalTimeId, title: item.title, venue: null };
  }
  if (!item.sessionTime) return null;
  const start = minutesOf(item.sessionTime.time);
  return {
    date: item.sessionTime.date, start, end: start + (Number(item.sessionTime.length) || 60), kind,
    sessionId: item.sessionId, title: item.title, venue: item.venue, seatAvailability: item.seatAvailability,
    level: item.level, abbreviation: item.abbreviation,
  };
}

/** Merge reserved, favorite and personal-time cards into one day's ordered
 * blocks, with clashes flagged and gaps turned into travel tags or a
 * fill-the-gap prompt. Clashes are detected across every day, so the day
 * strip's dot works even when that day isn't the one on screen. */
export function buildTimeline(day, reservedCards, favoriteCards, personalTime) {
  const all = [
    ...reservedCards.map((s) => timeSlot('reserved', s)),
    ...favoriteCards.map((s) => timeSlot('favorite', s)),
    ...personalTime.map((p) => timeSlot('personal', p)),
  ].filter(Boolean);

  // Absolute minutes, not date-relative: a block that runs past midnight (a
  // personal time span, or a late session) is dated on the day it started,
  // so comparing by date alone misses a real overlap with the next day's
  // early session.
  for (const x of all) { const idx = dayIndex(x.date); x.absStart = idx * 1440 + x.start; x.absEnd = idx * 1440 + x.end; }

  const clashDays = new Set();
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i]; const b = all[j];
      if (a.absStart < b.absEnd && b.absStart < a.absEnd) {
        clashDays.add(a.date); clashDays.add(b.date); a.clash = true; b.clash = true;
      }
    }
  }

  const date = dayToDate(day) ?? [...all.map((x) => x.date)].sort()[0] ?? EVENT_DAYS.monday;
  const slots = all.filter((x) => x.date === date).sort((a, b) => a.start - b.start);

  const blocks = [];
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i];
    blocks.push({
      kind: s.kind, sessionId: s.sessionId, id: s.id, title: s.title, venue: s.venue,
      clock: formatClock(minutesToTime(s.start)), length: s.end - s.start, clash: Boolean(s.clash),
      seatAvailability: s.seatAvailability, level: s.level, abbreviation: s.abbreviation,
    });
    const next = slots[i + 1];
    if (next) {
      // Absolute minutes, not s.end/next.start directly: a block crossing
      // midnight (see absStart/absEnd above) can have `end` past 1440, and a
      // negative result here means a real overlap, already flagged as a
      // clash above, and a travel/gap tile between two overlapping blocks
      // would be meaningless, so skip it instead of showing a bogus "tight" tag.
      const gap = next.absStart - s.absEnd;
      if (gap >= 0) {
        const need = travelMinutes(s.venue, next.venue);
        // Different venues always get a travel tag, even with no time to spare.
        // Same venue (or no venue, as with personal time) gets a fill-the-gap prompt instead.
        if (need > 0) blocks.push({ kind: 'gap', travel: true, minutes: gap, toVenue: next.venue, tight: need > gap });
        else if (gap > 0) blocks.push({ kind: 'gap', travel: false, minutes: gap, toVenue: next.venue, tight: false });
      }
    }
  }
  return { date, day: dateToDay(date), blocks, clashDays: [...clashDays].map(dateToDay).filter(Boolean) };
}
