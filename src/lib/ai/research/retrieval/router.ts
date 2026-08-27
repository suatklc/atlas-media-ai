import type { NormalizedResearchResult, RetrievalOptions, RetrievalQuery } from "./types";
import { fetchTcmbAnnouncements } from "./providers/tcmb";
import { fetchTkgmAnnouncements } from "./providers/tkgm";

const DEFAULT_MAX_RESULTS = 20;

// Fan-out, not a single-provider switch (unlike media/router.ts or
// publishing/router.ts, which each pick exactly ONE provider per request):
// research legitimately wants results from every relevant adapter
// combined, not one chosen source. Each adapter already isolates its own
// per-feed/per-page failures (see providers/tcmb.ts, providers/tkgm.ts);
// this wraps every adapter call in its own catch too, so one adapter
// throwing outright can never fail the others.
//
// providers/resmiGazete.ts exists, is parsing-correct (its extraction
// logic was verified against real, live-captured HTML), and is
// deliberately NOT registered here: live validation found that Node's
// native fetch() cannot complete a TLS handshake to
// www.resmigazete.gov.tr — `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — while the
// exact same request via curl (which uses the OS's own certificate
// store, not Node's bundled one) succeeds. TCMB and TKGM, fetched the
// same way in the same run, both succeed, so this is specific to Resmî
// Gazete's certificate chain, not a general environment problem. Working
// around this would mean disabling TLS verification (a real security
// regression for content whose entire value is coming from a verified
// official source) or bundling a specific CA trust anchor without being
// able to safely confirm it's the correct one in this task — see the
// Phase 3 final report. Register fetchResmiGazeteAnnouncements here only
// once a safe fix is confirmed.
//
// TÜİK (veriportali.tuik.gov.tr — a JS-rendered SPA with no discoverable
// public JSON API within a safe, non-invasive inspection) and Sarıyer
// Belediyesi (sariyer.bel.tr — also a full JS SPA; every path serves an
// identical shell) were investigated and left out for a different
// reason: no server-rendered content is reachable via fetch at all.
//
// Adding a real, live-validated future adapter means adding one more
// entry to this array; nothing else here changes.
const ADAPTERS: Array<() => Promise<NormalizedResearchResult[]>> = [fetchTcmbAnnouncements, fetchTkgmAnnouncements];

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
