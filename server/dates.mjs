/**
 * Event-week day names and Las Vegas local time conversions.
 * Event facts: AWS-EVENTS-INTEGRATION.md § Event facts. Personal time is UTC,
 * naive (no offset or "Z"); sessionTime is local. AWS-EVENTS-INTEGRATION.md § Personal time.
 */
const TZ = 'America/Los_Angeles';

export const EVENT_DAYS = {
  monday: '2026-11-30',
  tuesday: '2026-12-01',
  wednesday: '2026-12-02',
  thursday: '2026-12-03',
  friday: '2026-12-04',
};

export function dayToDate(day) {
  if (!day) return null;
  const key = String(day).toLowerCase();
  if (EVENT_DAYS[key]) return EVENT_DAYS[key];
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export function dateToDay(date) {
  const found = Object.entries(EVENT_DAYS).find(([, d]) => d === date);
  return found ? found[0] : null;
}

function tzOffsetMinutes(utcGuess) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(utcGuess).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - utcGuess.getTime()) / 60000;
}

/** Local Las Vegas "YYYY-MM-DD" + "HH:MM" → UTC naive "YYYY-MM-DDTHH:mm:ss" (no offset). */
export function localToUtcNaive(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  const offsetMin = tzOffsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60000).toISOString().slice(0, 19);
}

/** UTC naive "YYYY-MM-DDTHH:mm:ss" → Las Vegas local {date, time}. */
export function utcNaiveToLocal(utcNaive) {
  const d = new Date(`${utcNaive}Z`);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** UTC naive start/end → Las Vegas local {date, time, length}, carrying a day
 * crossing (e.g. 11pm-1am) into length so it's never negative. */
export function utcNaiveSpanToLocal(startNaive, endNaive) {
  const { date, time } = utcNaiveToLocal(startNaive);
  const { date: endDate, time: endTime } = utcNaiveToLocal(endNaive);
  const dayDiff = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return { date, time, length: minutesOf(endTime) + dayDiff * 1440 - minutesOf(time) };
}

/** Days since the Unix epoch for a "YYYY-MM-DD" date, so callers can compare
 * two local times across a midnight boundary as one absolute minute value
 * instead of only within a single calendar date. */
export function dayIndex(date) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86400000);
}

/** Minutes since midnight for a "HH:MM" string. */
export function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** "2" or "2:15" plus am/pm, from a "HH:MM" string. */
export function formatClock(time) {
  const mins = minutesOf(time);
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const h12 = h24 % 12 || 12;
  const ampm = h24 < 12 ? 'am' : 'pm';
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${ampm}`;
}

/** Human "Tuesday at 2" from a local date+time, for speech (never UTC). */
export function speakTime(date, time) {
  const day = dateToDay(date);
  const label = day ? day[0].toUpperCase() + day.slice(1) : date;
  return `${label} at ${formatClock(time)}`;
}
