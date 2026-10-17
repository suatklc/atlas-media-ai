// Shared by providers/resmiGazete.ts and providers/tkgm.ts (Phase 3) —
// both render dates as "DD <Turkish month name> YYYY" (e.g.
// "25 Ağustos 2026"), unlike TCMB's feed, which uses three-letter month
// abbreviations and keeps its own local map (see providers/tcmb.ts,
// unchanged). Genuinely reused by two adapters now, so pulled out here
// rather than duplicated a second time.
const TURKISH_MONTHS: Record<string, string> = {
  Ocak: "01",
  Şubat: "02",
  Mart: "03",
  Nisan: "04",
  Mayıs: "05",
  Haziran: "06",
  Temmuz: "07",
  Ağustos: "08",
  Eylül: "09",
  Ekim: "10",
  Kasım: "11",
  Aralık: "12",
};

// Returns an ISO timestamp (midnight, Turkey time — these sources only
// ever give day precision) or null (never a guessed date) when the text
// doesn't contain a recognizable "DD <Ay> YYYY" — the caller then marks
// publishedAt as explicitly unknown rather than inventing one.
export function parseTurkishLongDate(raw: string): string | null {
  const match = raw.trim().match(/(\d{1,2})\s+(\p{L}+)\s+(\d{4})/u);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const month = TURKISH_MONTHS[monthName];
  if (!month) return null;
  const iso = `${year}-${month}-${day.padStart(2, "0")}T00:00:00+03:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// The inverse of parseTurkishLongDate: these sources' publishedAt values
// are Turkey-midnight instants stored in UTC (e.g. "29 Eylül 2026" ->
// "2026-09-28T21:00:00.000Z"), so reading the UTC date prefix — or
// formatting with a UTC server's default timezone, as on Vercel — is one
// calendar day early. A real, live-observed defect: Job 2 was handed the
// raw UTC string and wrote "28 Eylül 2026" for a TKGM card dated 29
// Eylül. Turkey has kept a fixed UTC+3 offset year-round since 2016 — the
// same offset parseTurkishLongDate already assumes.
const TURKEY_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

export type CalendarDate = { year: string; month: string; day: string };

export function toTurkeyCalendarDate(isoTimestamp: string): CalendarDate | null {
  // A bare "YYYY-MM-DD" (no time component) is already a calendar date,
  // never shifted.
  const plain = isoTimestamp.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (plain) return { year: plain[1], month: plain[2], day: plain[3] };

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  const shifted = new Date(parsed.getTime() + TURKEY_UTC_OFFSET_MS).toISOString();
  return { year: shifted.slice(0, 4), month: shifted.slice(5, 7), day: shifted.slice(8, 10) };
}

// "29.09.2026" — the plain DD.MM.YYYY form Turkish official sources and
// Atlas's own date-token checks already use. null when unparsable.
export function formatTurkeyDateDMY(isoTimestamp: string): string | null {
  const date = toTurkeyCalendarDate(isoTimestamp);
  return date ? `${date.day}.${date.month}.${date.year}` : null;
}

// "29 Eylül 2026" — long-form, for user-facing labels.
export function formatTurkeyDateLong(isoTimestamp: string): string | null {
  const date = toTurkeyCalendarDate(isoTimestamp);
  if (!date) return null;
  const monthName = Object.keys(TURKISH_MONTHS).find((name) => TURKISH_MONTHS[name] === date.month);
  return monthName ? `${Number(date.day)} ${monthName} ${date.year}` : null;
}

export const TURKISH_MONTH_NAMES = Object.keys(TURKISH_MONTHS);

export function turkishMonthNumber(monthName: string): string | undefined {
  const key = Object.keys(TURKISH_MONTHS).find(
    (name) => name.toLocaleLowerCase("tr-TR") === monthName.toLocaleLowerCase("tr-TR"),
  );
  return key ? TURKISH_MONTHS[key] : undefined;
}
