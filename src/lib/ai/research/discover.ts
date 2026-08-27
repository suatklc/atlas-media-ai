import type { BusinessProfile } from "../context/businessProfile";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "../context/businessProfile";
import type { ContentIntent } from "../content/types";
import type { ContentOpportunity, ContentOpportunityFreshness, ResearchSource, SourceTier } from "./types";
import type { NormalizedResearchResult, RetrievalQuery } from "./retrieval/types";
import { retrieveCurrentInformation } from "./retrieval/router";

// Phase 2 (Current Content Engine — live research foundation): the
// deterministic RETRIEVAL -> NORMALIZATION -> CONTENT OPPORTUNITY pipeline.
// Raw retrieval text (NormalizedResearchResult.title/snippet) never
// becomes final social-media copy here — this only ever assembles a
// ContentOpportunity (topic/angle/whyNow/keyFacts/sources/freshness/
// riskCaveat/suggestedContentType), which still has to travel through the
// EXISTING, untouched buildSeedMessage -> buildContentPlan ->
// buildCreativeBrief pipeline (research/opportunity.ts) before it can
// become anything published. This file adds no new authority to bypass
// that — see discoverCurrentContentOpportunities at the bottom, which is
// the one new server-callable entry point this task introduces, and which
// never generates a post, a visual, or touches approval/publishing.

// ============================================================
// Business-profile-biased query construction
// ============================================================

// This task's "first live research scope" topic families (A. Housing/
// Market Data, B. Credit/Interest, C. Regulation/Property, D. Local/
// Regional) as base vocabulary — combined with, never replacing,
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

// URL-based exact dedup: TCMB's own two feeds (see providers/tcmb.ts) COULD
// plausibly publish the same press release in both (a rate-decision
// announcement is also a general press release) — a live test run against
// both feeds found zero URL overlap at the time it ran, so this exact
// scenario is exercised by a synthetic fixture (tests/research-retrieval
// .test.mjs), not by observed live duplication. Deliberately not fuzzy/
// similarity-based dedup (different URLs, similar topic) — that would need
// real text-similarity work; URL equality is the smallest coherent,
// deterministic mechanism for the concrete same-URL case this pipeline can
// actually produce.
function dedupeByUrl(results: NormalizedResearchResult[]): NormalizedResearchResult[] {
  const seen = new Set<string>();
  const deduped: NormalizedResearchResult[] = [];
  for (const result of results) {
    if (seen.has(result.url)) continue;
    seen.add(result.url);
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
// fabricated" convention (see providers/tcmb.ts) — it resolves to
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
// claim the source doesn't support — a national TCMB rate decision is
// never rewritten here as if it were Zekeriyaköy-specific, even though
// BusinessProfile's geography terms bias which results got RETRIEVED/
// RANKED in the first place (see buildRetrievalQuery/rankContentOpportunities
// above/below) — relevance bias and factual claims are kept strictly
// separate.
export function buildContentOpportunities(
  results: NormalizedResearchResult[],
  now: Date = new Date(),
): ContentOpportunity[] {
  const deduped = dedupeByUrl(results);

  return deduped.map((result): ContentOpportunity => {
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
    };
  });
}

// ============================================================
// Ranking — simple, transparent, deterministic additive score
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
// angle": the two suggestedContentType values this task's own topic
// families naturally produce (market-stats, educational) get a small,
// fixed bonus over anything else — not a subjective/opaque judgment, a
// fixed lookup exactly like the two tables above it.
const PRACTICAL_VALUE_TYPES = new Set<ContentIntent>(["educational", "market-stats"]);

function relevanceKeywordScore(opportunity: ContentOpportunity, keywords: string[]): number {
  const haystack = `${opportunity.topic} ${opportunity.angle} ${opportunity.keyFacts.join(" ")}`.toLocaleLowerCase(
    "tr-TR",
  );
  return keywords.reduce(
    (score, keyword) => (haystack.includes(keyword.toLocaleLowerCase("tr-TR")) ? score + 1 : score),
    0,
  );
}

export function rankContentOpportunities(
  opportunities: ContentOpportunity[],
  keywords: string[],
  limit = 5,
): ContentOpportunity[] {
  return opportunities
    .map((opportunity) => {
      const tierScore = opportunity.sources.reduce((max, s) => Math.max(max, TIER_SCORE[s.tier]), 0);
      const freshnessScore = FRESHNESS_SCORE[opportunity.freshness];
      const relevance = relevanceKeywordScore(opportunity, keywords);
      const practicalBonus =
        opportunity.suggestedContentType && PRACTICAL_VALUE_TYPES.has(opportunity.suggestedContentType) ? 1 : 0;
      return { opportunity, score: tierScore + freshnessScore + relevance + practicalBonus };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.opportunity);
}

// ============================================================
// Main entry point — the one new server-callable function this task
// introduces. retrieve -> normalize (already done by the adapters/router)
// -> build opportunities -> rank -> return. Never generates a post, a
// visual, or touches approval/publishing (see src/app/api/research/
// discover/route.ts, the manual trigger this feeds).
// ============================================================

export type DiscoverCurrentOpportunitiesOptions = {
  profile?: BusinessProfile;
  limit?: number;
  now?: Date;
};

export async function discoverCurrentContentOpportunities(
  options: DiscoverCurrentOpportunitiesOptions = {},
): Promise<ContentOpportunity[]> {
  const profile = options.profile ?? ATLAS_DEFAULT_BUSINESS_PROFILE;
  const query = buildRetrievalQuery(profile);
  const results = await retrieveCurrentInformation(query);
  const opportunities = buildContentOpportunities(results, options.now ?? new Date());
  return rankContentOpportunities(opportunities, query.keywords, options.limit ?? 5);
}
