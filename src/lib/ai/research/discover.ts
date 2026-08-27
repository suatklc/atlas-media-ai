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

// Base real-estate topic vocabulary — combined with, never replacing,
// BusinessProfile's own expertise/geography terms. This is what keeps the
// retrieval engine itself generic: a future BusinessProfile with a
// different industry/geography changes what gets appended here, not this
// function's logic, and never touches retrieval/router.ts or any adapter.
const BASE_TOPIC_KEYWORDS = ["konut", "faiz", "kredi", "tapu", "imar", "fiyat", "piyasa", "gayrimenkul"];

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
  for (const rule of SUGGESTED_TYPE_RULES) {
    if (rule.pattern.test(title)) return rule.type;
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

const TOPIC_FAMILY_RULES: { pattern: RegExp; family: TopicFamily }[] = [
  { pattern: /faiz|kredi|ppk|para politikası/i, family: "credit-interest" },
  { pattern: /tapu|imar|kadastro|mevzuat|yönetmelik|kanun|resmî gazete|resmi gazete/i, family: "regulation-property" },
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
  for (const rule of TOPIC_FAMILY_RULES) {
    if (rule.pattern.test(title)) return rule.family;
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
  if (REGULATORY_PATTERN.test(title)) {
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

// Fixed, documented priority order for the "one guaranteed slot per
// family" pass below — matches this task's own conceptual description
// (strongest market-data, then credit-interest, then regulation-property,
// then local-regional, then investment-education, then highest-value
// remaining). Not a scoring weight, just a tie-break/traversal order.
const FAMILY_PRIORITY: TopicFamily[] = [
  "market-data",
  "credit-interest",
  "regulation-property",
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
// excludes a strong one.
export function rankContentOpportunities(
  opportunities: RankedContentOpportunity[],
  keywords: string[],
  limit = 5,
): RankedContentOpportunity[] {
  const scored = opportunities
    .map((opportunity) => ({ opportunity, score: scoreOpportunity(opportunity, keywords) }))
    .sort((a, b) => b.score - a.score);

  const picked: RankedContentOpportunity[] = [];
  const pickedSet = new Set<RankedContentOpportunity>();

  for (const family of FAMILY_PRIORITY) {
    if (picked.length >= limit) break;
    const best = scored.find(
      (entry) => entry.opportunity.topicFamily === family && !pickedSet.has(entry.opportunity),
    );
    if (best && best.score >= DIVERSITY_QUALITY_FLOOR) {
      picked.push(best.opportunity);
      pickedSet.add(best.opportunity);
    }
  }

  for (const entry of scored) {
    if (picked.length >= limit) break;
    if (pickedSet.has(entry.opportunity)) continue;
    picked.push(entry.opportunity);
    pickedSet.add(entry.opportunity);
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

export async function discoverCurrentContentOpportunities(
  options: DiscoverCurrentOpportunitiesOptions = {},
): Promise<RankedContentOpportunity[]> {
  const profile = options.profile ?? ATLAS_DEFAULT_BUSINESS_PROFILE;
  const query = buildRetrievalQuery(profile);
  const results = await retrieveCurrentInformation(query, { maxResults: CANDIDATE_POOL_SIZE });
  const opportunities = buildContentOpportunities(results, options.now ?? new Date());
  return rankContentOpportunities(opportunities, query.keywords, options.limit ?? 5);
}
