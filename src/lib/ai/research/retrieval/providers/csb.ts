import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { parseTurkishLongDate } from "../turkishDate";
import { hasAnyWordBoundaryMatch, REAL_ESTATE_RELEVANCE_KEYWORDS } from "../relevance";

// LIVE, real provider — the Ministry of Environment, Urbanization and
// Climate Change (Çevre, Şehircilik ve İklim Değişikliği Bakanlığı)'s own
// public news listing page. No TLS blocker here (unlike Resmî Gazete):
// plain fetch() against www.csb.gov.tr succeeds — live-verified during
// this task. The page SERVER-RENDERS its most recent ~12 news cards
// directly in the HTML (title, date, link) — verified via live fetch, not
// assumed. Unlike TKGM (whose entire remit is title-deed/cadastral by
// definition, so no relevance filter is applied there), this ministry's
// news covers environment/climate/water/forestry alongside zoning/
// construction/urban-transformation — the SAME "mixed official source"
// shape as Resmî Gazete, so it reuses that adapter's relevance.ts filter.
//
// No pagination link is server-rendered (older items load via a "load
// more" JS action) — this adapter is deliberately scoped to the current
// snapshot only, same convention as resmiGazete.ts's own "today's issue
// only" scoping: a bounded, reliable single fetch rather than crawling
// deeper pages that may not be server-rendered at all.
const ORIGIN = "https://www.csb.gov.tr";
const NEWS_URL = `${ORIGIN}/haberler`;
const PUBLISHER = "T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı";

const FETCH_TIMEOUT_MS = 10_000;
// The real listing page observed during investigation was ~380KB; this is
// a generous safety cap, not a tuned expectation.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

async function fetchNewsHtml(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(NEWS_URL, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text/i.test(contentType)) {
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

// Minimal, bounded extraction of the real, live-verified card markup:
// <div class="haberler-card-wrapper">...<span class="date">DD Ay
// YYYY</span>...<a href="URL" target="_self">TITLE</a>. Untrusted input:
// every extracted value is treated as plain text data, never executed.
// The lazy [\s\S]*? between the date span and the title <a> deliberately
// skips the card's own leading image-wrapper <a> (which has no text
// content) and lands on the real title link that follows the date.
function extractNewsItems(html: string): { title: string; url: string; dateText: string }[] {
  const pattern =
    /<div class="haberler-card-wrapper">[\s\S]*?<span class="date">([^<]+)<\/span>[\s\S]*?<a href="([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/g;
  const items: { title: string; url: string; dateText: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const dateText = match[1].trim();
    const url = match[2].trim();
    const title = match[3].trim();
    if (title && url) {
      items.push({ title, url, dateText });
    }
  }

  return items;
}

export async function fetchCsbAnnouncements(): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();

  let html: string;
  try {
    html = await fetchNewsHtml();
  } catch (error) {
    console.error("ÇŞİDB news retrieval failed:", error instanceof Error ? error.message : String(error));
    return [];
  }

  const items = extractNewsItems(html);
  const relevant = items.filter((item) => hasAnyWordBoundaryMatch(item.title, REAL_ESTATE_RELEVANCE_KEYWORDS));

  return relevant.map((item) => ({
    title: item.title,
    publisher: PUBLISHER,
    url: item.url,
    // Empty string, never a guessed date, when the card's own date text
    // didn't parse — same explicit-unknown convention as every other
    // adapter in this pipeline.
    publishedAt: parseTurkishLongDate(item.dateText) ?? "",
    tier: classifySourceTier(item.url),
    snippet: item.title,
    retrievedAt,
  }));
}
