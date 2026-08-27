import type { NormalizedResearchResult, RetrievalOptions, RetrievalQuery } from "./types";
import { fetchTcmbAnnouncements } from "./providers/tcmb";

const DEFAULT_MAX_RESULTS = 20;

// Fan-out, not a single-provider switch (unlike media/router.ts or
// publishing/router.ts, which each pick exactly ONE provider per request):
// research legitimately wants results from every relevant adapter
// combined, not one chosen source. Each adapter already isolates its own
// per-feed failures (see providers/tcmb.ts); this wraps every adapter call
// in its own catch too, so one adapter throwing outright can never fail
// the others. Adding a future adapter (Resmî Gazete, TÜİK, TKGM, Sarıyer
// Belediyesi — see sourceQuality.ts's TIER_1 allowlist, already prepared
// for them) means adding one more entry to this array; nothing else here
// changes.
const ADAPTERS: Array<() => Promise<NormalizedResearchResult[]>> = [fetchTcmbAnnouncements];

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
