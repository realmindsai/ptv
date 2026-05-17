/**
 * Parse "HH:MM" as today's Melbourne local time, returning the equivalent UTC Date.
 *
 * Melbourne observes AEST (UTC+10) and AEDT (UTC+11). The offset for "today
 * HH:MM Melbourne" depends on whether DST is active. We use a 2-step probe:
 * 1. Format "today" in Melbourne to get the calendar date there.
 * 2. Construct a probe Date assuming AEST (+10:00), then ask Intl whether
 *    that Date falls inside AEDT in Melbourne; if so, re-construct with +11:00.
 *
 * Caveat: at the ambiguous hour of DST transition (02:00 local, twice a year)
 * the chosen offset may be off by one hour. The user can pass an ISO8601
 * timezone-aware string to disambiguate.
 */
function parseMelbourneHHMM(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // en-CA gives "YYYY-MM-DD" cleanly.
  const ymd = dateFmt.format(now);
  const local = `${ymd}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const probe = new Date(`${local}+10:00`);
  const tzFmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', timeZoneName: 'short',
  });
  const tzName = tzFmt.formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const offset = tzName === 'AEDT' ? '+11:00' : '+10:00';
  return new Date(`${local}${offset}`);
}

export function parseTime(s: string | undefined): Date | undefined {
  if (s === undefined) return undefined;
  if (/^\d{2}:\d{2}$/.test(s)) {
    return parseMelbourneHHMM(s);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${s}`);
  return d;
}
