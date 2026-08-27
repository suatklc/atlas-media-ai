import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";

// LIVE, real provider — the Turkish Central Bank (TCMB)'s own public Atom
// feeds. No API key, no external search provider: TCMB publishes these
// feeds openly at a discoverable, stable URL (linked from tcmb.gov.tr's
// own footer "RSS" page), and native fetch is sufficient — no HTTP client
// dependency was added. Retrieved content is UNTRUSTED INPUT: every value
// pulled out of the feed is treated as plain data (title/link/date text),
// never executed, never used to alter this function's own control flow.
//
// Two feeds, same Atom format: general press releases (broad current
// TCMB news) and PPK Kararları (Monetary Policy Committee interest-rate
// decisions specifically — Topic Family B, "Credit/Interest," from the
// architecture review this follows). A rate-decision announcement is
// conceptually also a general press release, so the two feeds COULD
// overlap by URL (a live test run against both feeds found zero overlap
// at the time it ran, but that is not a guarantee for every moment — see
// discover.ts). This adapter does not deduplicate itself; that is
// discover.ts's job (by URL), applied across every adapter's combined
// output, not per-adapter.
const TCMB_FEEDS: { url: string; label: string }[] = [
  {
    url: "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Bottom+Menu/Diger/RSS/Basin+Duyurulari",
    label: "TCMB Basın Duyuruları",
  },
  {
    url: "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Bottom+Menu/Diger/RSS/PPK+Kararlari",
    label: "TCMB PPK Kararları (Faiz Oranları)",
  },
];

const FETCH_TIMEOUT_MS = 10_000;
// Safety cap — these feeds are normally tens of KB; this only guards
// against an unexpectedly huge/misbehaving response, never a real feed.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function fetchFeedText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/atom+xml, application/xml, text/xml" },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    // Content-type check: this endpoint is documented/observed to serve
    // the Atom feed as text/html — a known quirk of TCMB's Liferay/WCM
    // portal, not a bug in this adapter — so this only rejects something
    // that is neither XML NOR text (e.g. a binary/image error page),
    // never a false rejection of the real feed itself.
    const contentType = response.headers.get("content-type") ?? "";
    if (!/xml|text/i.test(contentType)) {
      throw new Error(`unexpected content-type "${contentType}"`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("response exceeded the size limit");
    }

    return Buffer.from(buffer).toString("utf-8");
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// Turkish month abbreviations as used in TCMB's <published> field, e.g.
// "11 Ara 2025 14:00:00".
const TURKISH_MONTHS: Record<string, string> = {
  Oca: "01", Şub: "02", Mar: "03", Nis: "04", May: "05", Haz: "06",
  Tem: "07", Ağu: "08", Eyl: "09", Eki: "10", Kas: "11", Ara: "12",
};

// Returns null (never a guessed/fabricated date) when the field doesn't
// match the expected shape — the caller then marks publishedAt as
// explicitly unknown (see the empty-string convention documented on
// NormalizedResearchResult's publishedAt usage in discover.ts) rather than
// inventing one.
function parseTcmbDate(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\s+(\p{L}{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/u);
  if (!match) return null;
  const [, day, monthAbbr, year, hh, mm, ss] = match;
  const month = TURKISH_MONTHS[monthAbbr];
  if (!month) return null;
  // TCMB publishes in Turkey local time (UTC+3), not UTC.
  const iso = `${year}-${month}-${day.padStart(2, "0")}T${hh}:${mm}:${ss}+03:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type RawEntry = { title: string; link: string; published: string | null };

// Minimal, bounded Atom <entry> extraction — deliberately not a general
// XML parser (no new dependency added): TCMB's feed format is simple and
// stable (one <title>/<link href>/<published> per <entry>), and this only
// ever reads plain text content out of it. Untrusted input handling: the
// extracted text is decoded as plain data (decodeXmlEntities) and never
// interpreted as markup, code, or an instruction of any kind.
function extractEntries(xml: string): RawEntry[] {
  const entries: RawEntry[] = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryPattern.exec(xml))) {
    const block = entryMatch[1];
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/);
    const publishedMatch = block.match(/<published>([\s\S]*?)<\/published>/);

    if (!titleMatch || !linkMatch) continue;

    const title = decodeXmlEntities(titleMatch[1].trim());
    const link = decodeXmlEntities(linkMatch[1].trim());
    const published = publishedMatch ? parseTcmbDate(decodeXmlEntities(publishedMatch[1])) : null;

    if (!title || !link) continue;

    entries.push({ title, link, published });
  }

  return entries;
}

// Fetches both TCMB feeds and returns their combined, normalized entries.
// One feed failing (network error, unexpected shape) is logged and
// skipped — it never fails the other feed or the caller's overall
// retrieval (see retrieval/router.ts, which already treats every adapter
// this way too; this per-feed isolation is an extra, adapter-internal
// layer of the same principle).
export async function fetchTcmbAnnouncements(): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const results: NormalizedResearchResult[] = [];

  for (const feed of TCMB_FEEDS) {
    let xml: string;
    try {
      xml = await fetchFeedText(feed.url);
    } catch (error) {
      console.error(
        `TCMB feed retrieval failed (${feed.label}):`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    for (const entry of extractEntries(xml)) {
      results.push({
        title: entry.title,
        publisher: "Türkiye Cumhuriyet Merkez Bankası (TCMB)",
        url: entry.link,
        // Empty string, never a guessed date, when TCMB's own field didn't
        // parse — see the freshness-classification convention in
        // discover.ts, which treats "" as explicitly unknown, not
        // "evergreen because it's old".
        publishedAt: entry.published ?? "",
        tier: classifySourceTier(entry.link),
        snippet: entry.title,
        retrievedAt,
      });
    }
  }

  return results;
}
