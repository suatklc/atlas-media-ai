import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { parseTurkishLongDate } from "../turkishDate";
import { hasAnyWordBoundaryMatch, REAL_ESTATE_RELEVANCE_KEYWORDS } from "../relevance";
import { errorKind, radarDiag, type AdapterReport } from "../diagnostics";
import { oldestDate, reachesWindow, type RetrievalWindow } from "../coverage";
import { toEvidenceTextOrUndefined } from "../evidenceExtraction";

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
// Pagination (re-checked live 2026-11-17): the listing now server-renders a
// real pager, /haberler/2, /haberler/3, … (12 cards each, ~0.4–0.5 s). Page 1
// alone covered ~1 day, so with a target window the adapter reads further
// pages until a page reaches the window start — bounded by MAX_PAGES and
// read sequentially so it stops as soon as the window is covered. Coverage
// is reported either way; a window the page cap could not reach is a
// reported gap, never silently treated as "nothing there".
const ORIGIN = "https://www.csb.gov.tr";
const NEWS_URL = `${ORIGIN}/haberler`;
export const MAX_PAGES = 12;

export function listingPageUrl(page: number): string {
  return page <= 1 ? NEWS_URL : `${NEWS_URL}/${page}`;
}
const PUBLISHER = "T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı";

const FETCH_TIMEOUT_MS = 10_000;
// The real listing page observed during investigation was ~380KB; this is
// a generous safety cap, not a tuned expectation.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// Reused for both the listing page and each item's own detail page —
// same fetch safety (timeout, size cap, content-type check), just a
// different URL.
async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
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

// Source-Grounding Minimal Fix: best-effort, bounded-parallel fetch of
// each (already relevance-filtered) item's own detail page. A failure on
// any one item — network error, non-HTML response, or too little
// extractable text — simply leaves that item's evidenceText absent; it
// is NEVER substituted with the title. Capped at MAX_DETAIL_FETCHES so a
// future listing-page change can't turn one discovery run into an
// unbounded number of requests.
const MAX_DETAIL_FETCHES = 12;

async function attachDetailPageEvidence(results: NormalizedResearchResult[]): Promise<void> {
  await Promise.allSettled(
    results.slice(0, MAX_DETAIL_FETCHES).map(async (result) => {
      try {
        const detailHtml = await fetchHtml(result.url);
        result.evidenceText = toEvidenceTextOrUndefined(detailHtml);
      } catch {
        // Safe failure — evidenceText stays absent, never faked.
      }
    }),
  );
}

export async function fetchCsbAnnouncements(report?: AdapterReport, window?: RetrievalWindow): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();

  // Without a window: page 1 only (previous behavior). With one: page after
  // page until the oldest card on a page reaches the window start.
  const maxPages = window?.notBefore ? MAX_PAGES : 1;
  const items: { title: string; url: string; dateText: string }[] = [];
  let pagesRead = 0;
  let reached = false;
  let failed: string | null = null;
  for (let page = 1; page <= maxPages; page++) {
    let pageItems: { title: string; url: string; dateText: string }[];
    try {
      pageItems = extractNewsItems(await fetchHtml(listingPageUrl(page)));
    } catch (error) {
      console.error("ÇŞİDB news retrieval failed:", error instanceof Error ? error.message : String(error));
      failed = `page ${page}: ${errorKind(error)}`;
      break;
    }
    pagesRead = page;
    items.push(...pageItems);
    if (pageItems.length === 0) {
      // Past the last page — nothing older exists to miss.
      reached = true;
      break;
    }
    if (reachesWindow(oldestDate(pageItems.map((item) => parseTurkishLongDate(item.dateText) ?? undefined)), window)) {
      reached = true;
      break;
    }
  }

  if (failed) report?.fail(failed);
  const dates = items.map((item) => parseTurkishLongDate(item.dateText) ?? undefined);
  report?.coverage?.({ since: pagesRead > 0 ? oldestDate(dates) : null, complete: reached });
  if (pagesRead === 0) {
    radarDiag("csb-listing", { status: "error", error: failed });
    return [];
  }

  const relevant = items.filter((item) => hasAnyWordBoundaryMatch(item.title, REAL_ESTATE_RELEVANCE_KEYWORDS));
  radarDiag("csb-listing", {
    status: failed ? "partial" : "ok",
    pagesRead,
    windowReached: reached,
    extracted: items.length,
    relevant: relevant.length,
  });

  const results: NormalizedResearchResult[] = relevant.map((item) => ({
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

  await attachDetailPageEvidence(results);

  return results;
}
