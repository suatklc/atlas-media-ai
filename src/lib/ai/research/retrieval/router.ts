import type { NormalizedResearchResult, RetrievalOptions, RetrievalQuery } from "./types";
import { fetchTcmbAnnouncements } from "./providers/tcmb";
import { fetchTkgmAnnouncements } from "./providers/tkgm";
import { fetchResmiGazeteAnnouncements } from "./providers/resmiGazete";
import { fetchCsbAnnouncements } from "./providers/csb";

const DEFAULT_MAX_RESULTS = 20;

// Fan-out, not a single-provider switch (unlike media/router.ts or
// publishing/router.ts, which each pick exactly ONE provider per request):
// research legitimately wants results from every relevant adapter
// combined, not one chosen source. Each adapter already isolates its own
// per-feed/per-page failures (see providers/tcmb.ts, providers/tkgm.ts);
// this wraps every adapter call in its own catch too, so one adapter
// throwing outright can never fail the others.
//
// Research Breadth Expansion v2: providers/resmiGazete.ts is now
// registered — its previous blocker (Node's fetch() rejecting
// www.resmigazete.gov.tr with UNABLE_TO_VERIFY_LEAF_SIGNATURE) is fixed
// via secureFetch.ts's scoped use of the OS's own trusted certificate
// store (see that module's own comment) — never a TLS-verification
// bypass. providers/csb.ts is new: the Ministry of Environment,
// Urbanization and Climate Change's own /haberler news listing, live-
// verified to be plain-fetch()-reachable (no TLS issue) and server-
// rendered, filtered through the same real-estate relevance check as
// Resmî Gazete (relevance.ts) since this ministry's news is not
// exclusively real-estate content either.
//
// Investigated and rejected, with the exact reason (see the final report
// for this task):
// - TÜİK: the only server-rendered surface (www.tuik.gov.tr's homepage
//   bulletin slider) has a title and reference PERIOD but no verifiable
//   PUBLICATION date; the surface that would have one (veriportali.tuik
//   .gov.tr's individual press pages) is a client-rendered SPA with no
//   server-rendered content — confirmed live. Fabricating a date to work
//   around this is exactly what this task's own rules forbid.
// - BDDK: reachable (also needed the same TLS fix), but its public site
//   is a statistical/PDF bulletin portal (weekly/monthly aggregate
//   banking data) with no discoverable per-item news/announcement
//   structure — extracting genuine mortgage-specific developments would
//   need PDF parsing or fragile heuristic scraping.
// - Sarıyer Belediyesi: re-confirmed live — every route (home/haberler/
//   duyurular) serves an identical, byte-for-byte JS SPA shell with no
//   server-rendered content at all.
//
// Adding a real, live-validated future adapter means adding one more
// entry to this array; nothing else here changes.
const ADAPTERS: Array<() => Promise<NormalizedResearchResult[]>> = [
  fetchTcmbAnnouncements,
  fetchTkgmAnnouncements,
  fetchResmiGazeteAnnouncements,
  fetchCsbAnnouncements,
];

function normalizeForMatch(text: string): string {
  return text.toLocaleLowerCase("tr-TR");
}

function relevanceScore(result: NormalizedResearchResult, keywords: string[]): number {
  const haystack = normalizeForMatch(`${result.title} ${result.snippet}`);
  return keywords.reduce(
    (score, keyword) => (haystack.includes(normalizeForMatch(keyword)) ? score + 1 : score),
    0,
  );
}

// query.keywords filter/rank the fixed set of entries each adapter's own
// official source already publishes — none of today's live adapters
// accept a free-text search query over the network themselves (TCMB's
// Atom feeds are not a search API); "query" here means "retrieve each
// adapter's current entries, then keep the ones textually relevant to the
// requested topic," never a string actually sent to a remote search
// endpoint. A future search-provider adapter that DOES accept a real query
// would receive query.keywords as its own search terms instead — this
// function's own shape does not need to change for that.
export async function retrieveCurrentInformation(
  query: RetrievalQuery,
  options: RetrievalOptions = {},
): Promise<NormalizedResearchResult[]> {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  const settled = await Promise.all(
    ADAPTERS.map((adapter) =>
      adapter().catch((error: unknown) => {
        console.error("Research adapter failed:", error instanceof Error ? error.message : String(error));
        return [] as NormalizedResearchResult[];
      }),
    ),
  );
  const all = settled.flat();

  if (query.keywords.length === 0) {
    return all.slice(0, maxResults);
  }

  return all
    .map((result) => ({ result, score: relevanceScore(result, query.keywords) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((entry) => entry.result);
}
