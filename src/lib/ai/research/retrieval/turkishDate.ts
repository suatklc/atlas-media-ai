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
