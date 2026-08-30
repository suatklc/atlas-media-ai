import type { BusinessProfile } from "../context/businessProfile";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "../context/businessProfile";
import type { ContentIntent } from "../content/types";
import type { ContentOpportunityFreshness, ResearchSource, SourceTier } from "./types";
import type { NormalizedResearchResult, RankedContentOpportunity, RetrievalQuery, TopicFamily } from "./retrieval/types";
import { retrieveCurrentInformation } from "./retrieval/router";

// Phase 2/3 (Current Content Engine — live research foundation +
// diversity): the deterministic RETRIEVAL -> NORMALIZATION -> CONTENT
// OPPORTUNITY pipeline. Raw retrieval text (NormalizedResearchResult
// .title/snippet) never becomes final social-media copy here — this only
// ever assembles a ContentOpportunity (topic/angle/whyNow/keyFacts/
// sources/freshness/riskCaveat/suggestedContentType, plus Phase 3's
// topicFamily hint), which still has to travel through the EXISTING,
// untouched buildSeedMessage -> buildContentPlan -> buildCreativeBrief
// pipeline (research/opportunity.ts) before it can become anything
// published. This file adds no new authority to bypass that — see
// discoverCurrentContentOpportunities at the bottom, which never
// generates a post, a visual, or touches approval/publishing.

// ============================================================
// Business-profile-biased query construction
// ============================================================

// Research Breadth Expansion: root cause of the "only 1-2 results" report
// was NOT retrieval limits, filtering, or dedup — CANDIDATE_POOL_SIZE
// below was already generous (200) and ranking/dedup were already correct.
// It was that today's two live adapters (TCMB, TKGM) are FIXED official
// feeds, not a real search API (see retrieval/router.ts's own comment:
// "query" here means "keep the fixed entries these feeds already publish
// that are textually relevant to these keywords", never a string actually
// sent over the network) — so retrieveCurrentInformation's relevance
// filter (router.ts: keep only entries where at least one keyword appears
// in the title/snippet) was silently discarding genuinely current,
// genuinely relevant entries from BOTH feeds' broader content (TCMB
// publishes two feeds — general press releases, not just PPK rate
// decisions; TKGM publishes both /duyurular AND /haberler) whenever their
// titles used real-estate vocabulary this list didn't cover — "kira" had
// no entry at all, "imar"/"inşaat"/"ruhsat" (zoning/construction),
// "kadastro"/"takbis" (cadastre), "vergi"/"harç" (tax/fee), and
// "enflasyon"/"endeks"/"istatistik"/"yatırım" (economic data) were all
// absent. This is a query-diversification fix, not a new "search
// portfolio": since the adapters accept no per-category query parameter,
// "diversifying the query" here means broadening and CATEGORIZING the
// single relevance-keyword vocabulary these fixed feeds are filtered
// against — bounded, zero new network calls, same one retrieval pass.
// Organized by category (loosely mirroring this task's own 8 content
// categories) for readability/maintainability, flattened into one list for
// buildRetrievalQuery below exactly as the old flat BASE_TOPIC_KEYWORDS
// was — every original term (konut, faiz, kredi, tapu, imar, fiyat,
// piyasa, gayrimenkul) is still present, unchanged in meaning.
const TOPIC_KEYWORD_CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: "tapu-kadastro", keywords: ["tapu", "kadastro", "takbis", "tescil"] },
  { category: "imar-yapilasma", keywords: ["imar", "inşaat", "ruhsat", "kentsel dönüşüm"] },
  { category: "konut-piyasasi", keywords: ["konut", "satış", "fiyat"] },
  { category: "kira", keywords: ["kira", "kiralık"] },
  { category: "kredi-faiz", keywords: ["faiz", "kredi", "ipotek"] },
  { category: "ekonomi-yatirim", keywords: ["enflasyon", "endeks", "istatistik", "yatırım"] },
  { category: "vergi-mevzuat", keywords: ["vergi", "harç", "mevzuat", "yönetmelik"] },
  { category: "piyasa-genel", keywords: ["piyasa", "gayrimenkul"] },
];

// Combined with, never replacing, BusinessProfile's own expertise/
// geography terms. This is what keeps the retrieval engine itself
// generic: a future BusinessProfile with a different industry/geography
// changes what gets appended here, not this function's logic, and never
// touches retrieval/router.ts or any adapter.
const BASE_TOPIC_KEYWORDS = TOPIC_KEYWORD_CATEGORIES.flatMap((entry) => entry.keywords);

export function buildRetrievalQuery(profile: BusinessProfile = ATLAS_DEFAULT_BUSINESS_PROFILE): RetrievalQuery {
  const geographyTerms = [profile.geography.primary, ...profile.geography.nearby];
  const keywords = [...BASE_TOPIC_KEYWORDS, ...profile.expertiseTopics, ...geographyTerms];
  return { keywords };
}

// ============================================================
// Deduplication — same event, not a fake second topic
// ============================================================

// Light, deterministic title normalization — lowercase + collapsed
// whitespace ONLY. Deliberately does NOT strip parenthetical content: for
// TCMB's own title convention ("Faiz Oranlarına İlişkin Basın Duyurusu
// (2026-28)"), the trailing "(2026-28)" code is the ONLY thing
// distinguishing one genuine rate-decision event from another with an
// otherwise near-identical title — stripping it would collapse multiple
// real, distinct events into one fake "duplicate". This only catches the
// concrete case this pipeline can actually produce: the identical title
// text reachable via two different URLs (e.g. a protocol/anchor/query
// difference) — not fuzzy/similarity-based matching, which would need
// real text-similarity work (explicitly out of scope — no embeddings).
function normalizeEventKey(title: string): string {
  return title.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

// URL-based exact dedup, PLUS a normalized-title event key — either match
// is enough to treat two results as the same event. TCMB's own two feeds
// (see providers/tcmb.ts) COULD plausibly publish the same press release
// in both; a live test run against both feeds found zero URL overlap at
// the time it ran, so this exact scenario is exercised by a synthetic
// fixture (tests/research-retrieval.test.mjs), not by observed live
// duplication.
function dedupeByUrlOrTitle(results: NormalizedResearchResult[]): NormalizedResearchResult[] {
  const seenUrls = new Set<string>();
  const seenTitleKeys = new Set<string>();
  const deduped: NormalizedResearchResult[] = [];

  for (const result of results) {
    const titleKey = normalizeEventKey(result.title);
    if (seenUrls.has(result.url) || seenTitleKeys.has(titleKey)) continue;
    seenUrls.add(result.url);
    seenTitleKeys.add(titleKey);
    deduped.push(result);
  }

  return deduped;
}

// ============================================================
// Freshness — never assume "current" without a real, recent date
// ============================================================

const FRESHNESS_BREAKING_DAYS = 3;
const FRESHNESS_RECENT_DAYS = 30;

// publishedAt === "" is this pipeline's explicit "unknown, never
// fabricated" convention (see every provider) — it resolves to
// "evergreen-adjacent", the same bucket as a genuinely old article, since
// neither can be presented as "current" without real evidence. A future
// (or clock-skewed) date is treated the same way — a date that hasn't
// happened yet is not trustworthy evidence of current relevance either.
export function classifyFreshness(publishedAt: string, now: Date): ContentOpportunityFreshness {
  if (!publishedAt) return "evergreen-adjacent";
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return "evergreen-adjacent";

  const ageDays = (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return "evergreen-adjacent";
  if (ageDays <= FRESHNESS_BREAKING_DAYS) return "breaking";
  if (ageDays <= FRESHNESS_RECENT_DAYS) return "recent";
  return "evergreen-adjacent";
}

// Research Breadth Expansion: found while adding the zoning-construction
// family below — plain JS regex /i case-insensitivity does NOT correctly
// fold the Turkish dotted capital İ to plain "i" (verified:
// /imar/i.test("İmar Planı") is false; "İmar".toLowerCase() produces
// "i̇mar" — i + a combining dot, not "imar"). Since real official Turkish
// titles routinely capitalize their first word ("İmar Planı Değişikliği
// Onaylandı"), every keyword-matching regex in this file that could start
// a title (imar, istatistik, ...) was silently failing to match its own
// most natural, common form — a pre-existing latent bug (not introduced by
// this task, but surfaced by it), affecting suggestContentType,
// classifyTopicFamily, and buildRiskCaveat's REGULATORY_PATTERN alike.
// toLocaleLowerCase("tr-TR") is the correct fix (already the established
// pattern elsewhere in this codebase, e.g. content/intent.ts's own
// normalizedWord) — every pattern below now tests against this normalized
// form instead of relying on the /i flag.
function normalizedTitle(title: string): string {
  return title.toLocaleLowerCase("tr-TR");
}

// ============================================================
// suggestedContentType — a hint only, reusing the EXISTING ContentIntent
// enum (content/types.ts), never a new one. Exactly like research/
// opportunity.ts's own buildSeedMessage hints, this never overrides or
// bypasses the real detectContentIntent classifier that still runs later
// in the existing pipeline — it only shapes buildSeedMessage's wording.
// ============================================================

const SUGGESTED_TYPE_RULES: { pattern: RegExp; type: ContentIntent }[] = [
  { pattern: /faiz|kredi/i, type: "market-stats" },
  { pattern: /tapu|imar|mevzuat|yönetmelik|kanun/i, type: "educational" },
  { pattern: /fiyat|endeks|istatistik/i, type: "market-stats" },
];

// Educational (informational framing) is the safe default for anything
// that matched none of the rules above — never "listing": a retrieved
// news item is never, by itself, evidence that the user wants to
// advertise a specific property for sale.
function suggestContentType(title: string): ContentIntent {
  const normalized = normalizedTitle(title);
  for (const rule of SUGGESTED_TYPE_RULES) {
    if (rule.pattern.test(normalized)) return rule.type;
  }
  return "educational";
}

// ============================================================
// Topic family — Phase 3's minimum diversity concept (see retrieval/
// types.ts's own doc comment: NOT a second ContentIntent taxonomy).
// Keyword rules first (most specific evidence); a source-domain fallback
// second, since a source's own domain is still real evidence of its
// general subject area even when its title doesn't literally contain one
// of the keyword triggers below.
// ============================================================

// Research Breadth Expansion: "imar" moved OUT of regulation-property's
// own pattern into the new zoning-construction rule below (previously
// conflated zoning/planning content with tapu/kadastro content under one
// family — no existing test pinned "imar" to regulation-property, so this
// is a safe, isolated split). "harç" (fee) added to regulation-property —
// TKGM's own real announcement style ("Tapu Harcı Güncellemesi") is
// exactly this category. Deliberately no "yapı" in the zoning pattern:
// this codebase already has a documented, live-verified false-positive
// case for that exact substring ("...Değişiklik Yapılmasına Dair
// Yönetmelik" contains "Yapılmasına", a conjugated form of "yapmak", not
// the noun "yapı" — see resmiGazete.ts/its own test) — omitting the word
// avoids reintroducing that bug class rather than needing a Turkish word-
// boundary regex for one topic-family hint.
const TOPIC_FAMILY_RULES: { pattern: RegExp; family: TopicFamily }[] = [
  { pattern: /faiz|kredi|ppk|para politikası/i, family: "credit-interest" },
  { pattern: /tapu|kadastro|mevzuat|yönetmelik|kanun|resmî gazete|resmi gazete|harç/i, family: "regulation-property" },
  { pattern: /imar|inşaat|ruhsat|kentsel dönüşüm/i, family: "zoning-construction" },
  { pattern: /kira|kiralık/i, family: "rental-housing" },
  { pattern: /endeks|istatistik|fiyat|satış|enflasyon/i, family: "market-data" },
  { pattern: /sarıyer|zekeriyaköy|uskumruköy|demirciköy|gümüşdere|kilyos|belediye/i, family: "local-regional" },
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function classifyTopicFamily(title: string, url: string): TopicFamily {
  const normalized = normalizedTitle(title);
  for (const rule of TOPIC_FAMILY_RULES) {
    if (rule.pattern.test(normalized)) return rule.family;
  }

  const hostname = hostnameOf(url);
  if (hostname.endsWith("tkgm.gov.tr") || hostname.endsWith("resmigazete.gov.tr") || hostname.endsWith("mevzuat.gov.tr")) {
    return "regulation-property";
  }
  if (hostname.endsWith("tcmb.gov.tr")) return "credit-interest";
  if (hostname.endsWith("bel.tr")) return "local-regional";
  if (hostname.endsWith("tuik.gov.tr")) return "market-data";

  return "investment-education";
}

// ============================================================
// Risk caveats — commentary-only evidence and regulatory content
// ============================================================

const REGULATORY_PATTERN = /tapu|imar|mevzuat|yönetmelik|kanun|resmî gazete|resmi gazete/i;

function buildRiskCaveat(sources: ResearchSource[], title: string): string | undefined {
  const allCommentary = sources.length > 0 && sources.every((source) => source.tier === "commentary");
  if (allCommentary) {
    return "Bu bilgi yalnızca ikincil yorum kaynaklarına dayanmaktadır; doğrulanmış resmi veri olarak sunulmamalıdır.";
  }
  if (REGULATORY_PATTERN.test(normalizedTitle(title))) {
    return "Bu bilgi genel bilgilendirme niteliğindedir; bireysel hukuki tavsiye değildir; güncel uygulama için ilgili resmi kurumla teyit edilmelidir.";
  }
  return undefined;
}

// ============================================================
// Content Opportunity construction
// ============================================================

// exact statistics require source support: keyFacts is exactly the
// source's own title text — never an invented number/statistic beyond
// what the source itself states. do not invent local price data / do not
// turn national data into local factual claims: `angle` is deliberately
// audience-framing language ("who this matters to"), never a geographic
// claim the source doesn't support — a national TCMB/TÜİK-scale rate or
// price statistic is never rewritten here as if it were Zekeriyaköy-
// specific, even though BusinessProfile's geography terms bias which
// results got RETRIEVED/RANKED in the first place (see buildRetrievalQuery
// /rankContentOpportunities above/below) — relevance bias and factual
// claims are kept strictly separate.
export function buildContentOpportunities(
  results: NormalizedResearchResult[],
  now: Date = new Date(),
): RankedContentOpportunity[] {
  const deduped = dedupeByUrlOrTitle(results);

  return deduped.map((result): RankedContentOpportunity => {
    const source: ResearchSource = {
      title: result.title,
      publisher: result.publisher,
      url: result.url,
      publishedAt: result.publishedAt,
      tier: result.tier,
    };

    return {
      topic: result.title,
      angle: "Bu gelişmenin gayrimenkul alıcı ve yatırımcıları için pratik anlamı",
      // No trailing period: opportunity.ts's buildSeedMessage renders this
      // as "Güncellik nedeni: ${whyNow}." — appending its own period.
      whyNow: result.publishedAt
        ? `${result.publisher} tarafından ${result.publishedAt.slice(0, 10)} tarihinde yayımlandı`
        : `${result.publisher} tarafından yayımlandı; yayım tarihi bu kaynaktan doğrulanamadı`,
      keyFacts: [result.title],
      sources: [source],
      freshness: classifyFreshness(result.publishedAt, now),
      riskCaveat: buildRiskCaveat([source], result.title),
      suggestedContentType: suggestContentType(result.title),
      topicFamily: classifyTopicFamily(result.title, result.url),
    };
  });
}

// ============================================================
// Ranking — simple, transparent, deterministic additive score, PLUS
// Phase 3's diversified shortlist selection.
// ============================================================

const TIER_SCORE: Record<SourceTier, number> = {
  "official-authority": 4,
  "primary-data": 3,
  "financial-news": 2,
  specialist: 1,
  commentary: 0,
};

const FRESHNESS_SCORE: Record<ContentOpportunityFreshness, number> = {
  breaking: 3,
  recent: 2,
  "evergreen-adjacent": 1,
};

// "practical value for buyer/seller/investor, clear educational/content
// angle": the two suggestedContentType values this pipeline's topic
// families naturally produce (market-stats, educational) get a small,
// fixed bonus over anything else — not a subjective/opaque judgment, a
// fixed lookup exactly like the two tables above it.
const PRACTICAL_VALUE_TYPES = new Set<ContentIntent>(["educational", "market-stats"]);

function relevanceKeywordScore(opportunity: RankedContentOpportunity, keywords: string[]): number {
  const haystack = `${opportunity.topic} ${opportunity.angle} ${opportunity.keyFacts.join(" ")}`.toLocaleLowerCase(
    "tr-TR",
  );
  return keywords.reduce(
    (score, keyword) => (haystack.includes(keyword.toLocaleLowerCase("tr-TR")) ? score + 1 : score),
    0,
  );
}

function scoreOpportunity(opportunity: RankedContentOpportunity, keywords: string[]): number {
  const tierScore = opportunity.sources.reduce((max, s) => Math.max(max, TIER_SCORE[s.tier]), 0);
  const freshnessScore = FRESHNESS_SCORE[opportunity.freshness];
  const relevance = relevanceKeywordScore(opportunity, keywords);
  const practicalBonus =
    opportunity.suggestedContentType && PRACTICAL_VALUE_TYPES.has(opportunity.suggestedContentType) ? 1 : 0;
  return tierScore + freshnessScore + relevance + practicalBonus;
}

// ============================================================
// Recurring-series suppression (Handoff — quality gate before UI): a
// SHORTLIST-only concept — never applied at retrieval/storage (deduped
// results still all exist as distinct opportunities; this only decides
// which ones may occupy the small final shortlist). Real live data
// exposed the concrete case this addresses: TCMB republishes the same
// recurring "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)" /
// "(2026-23)" / "(2025-63)" title, differing only by its trailing
// "(YYYY-NN)" event code — four technically-distinct, technically-non-
// duplicate events (Phase 3's own title/URL dedup correctly does NOT
// collapse them) that nonetheless all represent the SAME recurring
// announcement series for shortlist purposes, and let one prolific series
// crowd out every other family. Deliberately narrow: only a single
// TRAILING parenthetical group is stripped (the exact, verified pattern
// TCMB's own titles use for their event code) — not a general fuzzy/
// similarity matcher, no embeddings, and never touching any parenthetical
// content that isn't at the very end of the title (a mid-title
// parenthetical could be genuinely meaningful, e.g. an amount or a
// clarifying aside, and must not be stripped).
function deriveSeriesKey(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\s+/g, " ")
    .trim();
}

// Fixed, documented priority order for the "one guaranteed slot per
// family" pass below — matches this task's own conceptual description
// (strongest market-data, then credit-interest, then regulation-property,
// then local-regional, then investment-education, then highest-value
// remaining). Not a scoring weight, just a tie-break/traversal order.
// Research Breadth Expansion: inserted the 2 new families (zoning-
// construction, rental-housing) between regulation-property and
// local-regional — every original family keeps its exact prior relative
// order, so this is a pure insertion, not a reordering.
const FAMILY_PRIORITY: TopicFamily[] = [
  "market-data",
  "credit-interest",
  "regulation-property",
  "zoning-construction",
  "rental-housing",
  "local-regional",
  "investment-education",
];

// A family's own best entry only earns a GUARANTEED diversity slot when
// its score clears this floor — otherwise that slot is left empty here
// and is filled by the highest-value remaining opportunity in the pass
// below instead. This is what stops a weak/stale story from being forced
// in "merely to fill a category": an official-tier source alone already
// clears this floor (tierScore 4), and so does a merely "recent" (not
// "breaking") source with a little keyword relevance and the practical-
// value bonus (2 + 1 + 1). A commentary-tier, evergreen-adjacent entry
// does NOT clear it even with both the relevance point and the practical-
// value bonus (0 + 1 + 1 + 1 = 3 < 4) — every unclassified title defaults
// to suggestedContentType "educational" (see suggestContentType above),
// which itself carries the practical-value bonus, so the floor has to sit
// above what that default alone can reach for a weak source; a live test
// fixture (a stale, commentary-tier "yorum yazısı") confirmed 3 was too
// low before this was raised to 4.
const DIVERSITY_QUALITY_FLOOR = 4;

// Diversified shortlist: one guaranteed slot per topic family (in
// FAMILY_PRIORITY order, skipped when that family has no entry clearing
// DIVERSITY_QUALITY_FLOOR), then the remaining slots filled by the
// highest-value opportunities left over, regardless of family. Quality
// and freshness still govern the fill pass — diversity only ever WIDENS
// which families can appear, it never forces a weak entry in and never
// excludes a strong one. Recurring-series suppression (deriveSeriesKey,
// above) applies throughout both passes: once one entry from a series has
// a slot, every other entry sharing its series key is skipped for the
// rest of this call — in EITHER pass — so a single prolific recurring
// announcement (TCMB's own "Faiz Oranlarına İlişkin..." series is the
// live-observed case) can occupy at most one shortlist slot, never four.
// The initial sort's tie-break (equal score -> more recent publishedAt
// wins) is what makes "prefer the newest item from a recurring series"
// deterministic rather than incidentally depending on an adapter's own
// feed ordering. If suppression (by family floor or by series) leaves
// fewer than `limit` genuinely distinct, qualifying opportunities, fewer
// than `limit` are returned — this function never pads a short result
// with a same-series repeat merely to hit the requested count.
// Research Breadth Expansion: a soft per-family cap on the FILL pass only
// (never on the guaranteed-slot pass above it, and never able to shrink
// the final list) — the task's own "avoid returning 6 nearly identical
// legal/tapu topics simply because they score highly individually"
// requirement. 2 keeps the shortlist genuinely spread across categories
// (e.g. 5 families x 2 already covers a limit of 10) while still allowing
// a strong 3rd-in-family item when nothing else qualifies — pass 2b below
// exists exactly for that "quality > diversity when there is no real
// choice" fallback, so this can only ever prefer diversity, never enforce
// it at the cost of returning fewer opportunities than genuinely qualify.
const FAMILY_SOFT_CAP = 2;

// ============================================================
// Semantic near-duplicate detection (Current Content Radar V1) — beyond
// deriveSeriesKey's exact-trailing-parenthetical scheme. Now that Layer 2
// (providers/economyNews.ts) can report a DIFFERENTLY-WORDED story about
// the SAME underlying development a Layer 1 official adapter already
// found (e.g. AA covering the same TCMB rate decision the TCMB adapter
// pulled directly), exact-title/series matching alone would let both
// through as "distinct" opportunities. This is a deliberately simple,
// deterministic heuristic — Jaccard token overlap on normalized title
// words — not an embeddings/fuzzy-similarity system (explicitly out of
// scope): cheap, bounded (compared only against already-picked entries,
// never the whole pool, since `scored` is walked best-first throughout
// rankContentOpportunities below).
//
// Tuning (carried over from the same heuristic developed and verified
// against this project's own test suite in an earlier, now-paused
// experiment — reused here as-is, independent of anything else from that
// experiment): official Turkish announcement titles share a lot of
// generic bureaucratic vocabulary regardless of actual topic — "Basın
// Duyurusu" (press release), "İlişkin" (regarding), "Hakkında" (about) —
// which a naive stopword list doesn't catch (these are ordinary nouns,
// not grammatical particles) and which can inflate similarity between two
// GENUINELY DIFFERENT press releases past a naive threshold. Both the
// expanded stopword list below and the minimum-token-count guard exist
// specifically to avoid that false positive — a genuine duplicate pair
// shares SPECIFIC content words (entity names, the actual subject), not
// just procedural boilerplate.
const SEMANTIC_TITLE_STOPWORDS = new Set([
  "ile", "için", "olan", "olarak", "veya", "ve", "bir", "bu", "da", "de",
  "hakkında", "üzerine", "göre", "daha", "ne", "mi", "mı", "mu", "mü",
  "ilişkin", "basın", "duyurusu", "duyuru", "açıklaması", "açıklandı",
  "yayımlandı", "genel", "resmi",
]);

// Real production case (Current Content Radar V1 micro-fix): Turkish is
// agglutinative — a single root takes a case/possessive suffix that
// changes with the sentence's own grammar, e.g. "sözleşmelerinde" (in the
// contracts) and "sözleşmelerinin" (of the contracts) are the SAME root
// ("sözleşme") but, compared as exact strings, share zero characters at
// the point the two forms diverge — plain Jaccard on whole words treats
// them as completely unrelated tokens. STEM_LENGTH is a deliberately
// crude, well-known heuristic for this class of language (not a real
// morphological analyzer): truncate to the first few characters, where
// the shared root lives, and let the inflectional suffix fall away. Kept
// short (5) so it only merges genuine suffix variants of the same root,
// not unrelated words that happen to start the same way over a longer
// span.
const STEM_LENGTH = 5;

function stem(token: string): string {
  return token.length <= STEM_LENGTH ? token : token.slice(0, STEM_LENGTH);
}

// Hyphens are now PRESERVED (not stripped to a space) specifically so a
// compound like "e-Devlet" survives as one distinctive token instead of
// being split into "e" (discarded, too short) and "devlet" (state/
// government — on its own, a generic word that says nothing specific).
// "e-devlet" is a genuinely narrow, specific reference (Turkey's e-
// government portal); splitting it was throwing away exactly the kind of
// distinctive signal isSameUnderlyingDevelopment below now depends on.
function titleTokenSet(title: string): Set<string> {
  return new Set(
    normalizedTitle(title)
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 && !SEMANTIC_TITLE_STOPWORDS.has(token))
      .map(stem),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const SEMANTIC_DUPLICATE_THRESHOLD = 0.6;
const SEMANTIC_DUPLICATE_WINDOW_DAYS = 4;
// Below this many meaningful tokens on EITHER side, similarity is too
// unreliable to trust (a short, generically-worded title can trivially
// share most of its 2-3 remaining words with an unrelated one) — skip the
// semantic check entirely rather than risk a false collapse; exact-title/
// series-key matching elsewhere still catches true duplicates of short
// titles.
const SEMANTIC_MIN_TOKEN_COUNT = 4;

// Real production case: two outlets can report the SAME underlying event
// in wording similar enough for a human to recognize instantly, but too
// DIFFERENT for the ratio-based Jaccard check above to ever clear 0.6 —
// live-observed pair: Dünya's "Kira sözleşmelerinde yeni dönem: Bakan
// Şimşek'ten e-Devlet çağrısı" (framed around the minister's call) vs
// AA's "Kira sözleşmelerinin e-Devlet üzerinden hazırlanmasının zorunlu
// olması öngörülüyor" (framed around the upcoming requirement) — overall
// Jaccard on this pair is ~0.14-0.23 even after stemming, nowhere near
// 0.6, yet both are unmistakably the same story once a human reads them.
//
// Rather than lowering SEMANTIC_DUPLICATE_THRESHOLD globally (which the
// task this fix was written for explicitly rejected: it would risk
// collapsing two DIFFERENT stories that merely share common domain words
// like "konut"/"kira"/"gayrimenkul"), this is a SEPARATE, additional
// check: sharing 2+ terms from a small, deliberately narrow ALLOW-list of
// specific, low-ambiguity terms/entities is independent strong evidence
// of the same event, regardless of the two titles' overall wording.
//
// This is an ALLOW-list, not "every word except a short deny-list of
// generic terms" — a deny-list-shaped version of this check was tried
// first and rejected: it let two clearly UNRELATED TCMB stories (e.g. a
// governor's Davos remarks vs. the same governor's parliamentary
// testimony) collapse merely for sharing organizational/title words like
// "tcmb" and "başkanı", which recur across many unrelated stories and are
// therefore NOT meaningfully distinctive even though neither belongs to
// an obvious "generic housing word" list. Restricting the pool to a few
// genuinely narrow, specific terms keeps the false-positive surface small
// and reviewable, rather than "everything that isn't obviously generic."
const DISTINCTIVE_SIGNATURE_TERMS = ["e-devlet", "sözleşme", "takbis", "ipotek"];
const DISTINCTIVE_SIGNATURE_STEMS = new Set(DISTINCTIVE_SIGNATURE_TERMS.map(stem));
const DISTINCTIVE_SIGNATURE_MINIMUM_MATCHES = 2;

function sharedDistinctiveSignatureCount(aTokens: Set<string>, bTokens: Set<string>): number {
  let count = 0;
  for (const signature of DISTINCTIVE_SIGNATURE_STEMS) {
    if (aTokens.has(signature) && bTokens.has(signature)) count += 1;
  }
  return count;
}

function isSameUnderlyingDevelopment(a: RankedContentOpportunity, b: RankedContentOpportunity): boolean {
  const aDate = a.sources[0]?.publishedAt ?? "";
  const bDate = b.sources[0]?.publishedAt ?? "";
  if (aDate && bDate) {
    const ageDiffDays = Math.abs(new Date(aDate).getTime() - new Date(bDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDiffDays > SEMANTIC_DUPLICATE_WINDOW_DAYS) return false;
  }
  const aTokens = titleTokenSet(a.topic);
  const bTokens = titleTokenSet(b.topic);
  if (aTokens.size < SEMANTIC_MIN_TOKEN_COUNT || bTokens.size < SEMANTIC_MIN_TOKEN_COUNT) return false;

  if (jaccardSimilarity(aTokens, bTokens) >= SEMANTIC_DUPLICATE_THRESHOLD) return true;
  return sharedDistinctiveSignatureCount(aTokens, bTokens) >= DISTINCTIVE_SIGNATURE_MINIMUM_MATCHES;
}

export function rankContentOpportunities(
  opportunities: RankedContentOpportunity[],
  keywords: string[],
  limit = 5,
): RankedContentOpportunity[] {
  const scored = opportunities
    .map((opportunity) => ({ opportunity, score: scoreOpportunity(opportunity, keywords) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aDate = a.opportunity.sources[0]?.publishedAt ?? "";
      const bDate = b.opportunity.sources[0]?.publishedAt ?? "";
      if (aDate !== bDate) return aDate < bDate ? 1 : -1;
      return 0;
    });

  const picked: RankedContentOpportunity[] = [];
  const pickedSet = new Set<RankedContentOpportunity>();
  const pickedSeriesKeys = new Set<string>();
  const familyCounts = new Map<TopicFamily, number>();

  function isAvailable(entry: (typeof scored)[number]): boolean {
    if (pickedSet.has(entry.opportunity)) return false;
    if (pickedSeriesKeys.has(deriveSeriesKey(entry.opportunity.topic))) return false;
    // scored is walked best-first throughout every pass below, so the
    // first occurrence of a semantic cluster is always the one already
    // picked — checking against `picked` (not the whole pool) keeps this
    // O(n * limit), never O(n^2).
    return !picked.some((already) => isSameUnderlyingDevelopment(already, entry.opportunity));
  }

  function pick(entry: (typeof scored)[number]): void {
    picked.push(entry.opportunity);
    pickedSet.add(entry.opportunity);
    pickedSeriesKeys.add(deriveSeriesKey(entry.opportunity.topic));
    const family = entry.opportunity.topicFamily;
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }

  for (const family of FAMILY_PRIORITY) {
    if (picked.length >= limit) break;
    const best = scored.find((entry) => entry.opportunity.topicFamily === family && isAvailable(entry));
    if (best && best.score >= DIVERSITY_QUALITY_FLOOR) {
      pick(best);
    }
  }

  // Pass 2a: fill remaining slots by score, but skip a family once it has
  // reached FAMILY_SOFT_CAP — diversity-preferring, never quality-lowering
  // (still walks `scored`, i.e. highest-score-first, within that
  // constraint).
  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (!isAvailable(entry)) continue;
    if ((familyCounts.get(entry.opportunity.topicFamily) ?? 0) >= FAMILY_SOFT_CAP) continue;
    pick(entry);
  }

  // Pass 2b: only reached if slots still remain after 2a — i.e. every
  // available family is already at its cap. Fills purely by score with no
  // cap, so a genuinely thin/undiverse pool still returns as many real
  // opportunities as qualify, never fewer merely to preserve diversity.
  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (!isAvailable(entry)) continue;
    pick(entry);
  }

  return picked.slice(0, limit);
}

// ============================================================
// Main entry point — the one server-callable function this pipeline
// exposes. retrieve -> normalize (already done by the adapters/router)
// -> dedupe -> build opportunities (+ topicFamily) -> diversified rank ->
// return. Never generates a post, a visual, or touches approval/
// publishing (see src/app/api/research/discover/route.ts, the manual
// trigger this feeds).
// ============================================================

export type DiscoverCurrentOpportunitiesOptions = {
  profile?: BusinessProfile;
  limit?: number;
  now?: Date;
  // Hard cutoff (Handoff — Current Content Opportunities UI): when set, any
  // retrieval result whose publishedAt is missing, unparsable, in the
  // future, or older than this many days is excluded BEFORE opportunities
  // are even built — not merely down-ranked. This is deliberately a
  // SEPARATE concept from the existing internal freshness classification
  // (classifyFreshness's breaking/recent/evergreen-adjacent, still used for
  // scoring/display and unchanged) — "evergreen-adjacent" is an acceptable
  // internal bucket for material older than 30 days, but this UI surface
  // must never present that material as a CURRENT opportunity merely to
  // fill a shortlist. Optional and undefined by default so every existing
  // caller (tests, any other future consumer) is completely unaffected;
  // the dashboard-facing route is the one caller that sets it.
  maxAgeDays?: number;
};

// retrieveCurrentInformation is asked for a generously large CANDIDATE
// pool here — not the small `limit` the caller actually wants. Bug found
// during Phase 3 live validation: retrieval/router.ts's own maxResults
// defaults to 20 (a plain relevance-count pre-filter, unaware of topic
// families), and a single prolific adapter (TCMB, ~40+ current entries)
// can fill every one of those 20 slots on its own, silently discarding
// every candidate from a smaller adapter (TKGM, a handful of relevant
// entries) before rankContentOpportunities' diversity logic ever sees
// them — confirmed live: with the router's default cap, 0 of 20 pooled
// candidates were non-TCMB even though real, relevant TKGM entries
// existed. Requesting a large pool here (well above what today's adapters
// combined realistically produce) lets THIS function's own diversity-
// aware ranking make the final cut, instead of an earlier, cruder,
// family-blind cap doing it first.
const CANDIDATE_POOL_SIZE = 200;

// Hard age cutoff (see DiscoverCurrentOpportunitiesOptions.maxAgeDays) —
// missing/unparsable/future dates are excluded here too: an unknown
// publication date is never treated as "within" any age window, matching
// the "do not falsely label it current" requirement.
function isWithinMaxAge(publishedAt: string, now: Date, maxAgeDays: number): boolean {
  if (!publishedAt) return false;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return false;
  const ageDays = (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays >= 0 && ageDays <= maxAgeDays;
}

export async function discoverCurrentContentOpportunities(
  options: DiscoverCurrentOpportunitiesOptions = {},
): Promise<RankedContentOpportunity[]> {
  const profile = options.profile ?? ATLAS_DEFAULT_BUSINESS_PROFILE;
  const now = options.now ?? new Date();
  const query = buildRetrievalQuery(profile);
  const results = await retrieveCurrentInformation(query, { maxResults: CANDIDATE_POOL_SIZE });
  const ageFiltered =
    options.maxAgeDays !== undefined
      ? results.filter((result) => isWithinMaxAge(result.publishedAt, now, options.maxAgeDays!))
      : results;
  const opportunities = buildContentOpportunities(ageFiltered, now);
  return rankContentOpportunities(opportunities, query.keywords, options.limit ?? 5);
}
