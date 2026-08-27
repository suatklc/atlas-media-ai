import type { SourceTier } from "../types";

// Deterministic, domain-allowlist-based source-tier classification —
// NEVER inferred from writing style, confidence of tone, or content
// length. Only a URL's own hostname, matched against a small, explicit,
// documented allowlist per tier, decides the tier. An unknown domain NEVER
// receives a high tier automatically — it falls to "commentary" (the
// lowest, safest-to-assume tier) by default, exactly per the requirement
// that unknown sources are never silently promoted.

// TIER 1 — official/public authority. Every domain here is a real,
// verifiable .gov.tr / .bel.tr institutional domain relevant to Turkish
// real-estate/finance/regulatory information (see the architecture
// review's source-quality hierarchy). Today's only LIVE retrieval adapter
// (providers/tcmb.ts) only ever produces tcmb.gov.tr URLs; the rest are
// listed now as the allowlist future adapters (Resmî Gazete, TÜİK, TKGM,
// Sarıyer Belediyesi) will resolve to once implemented — adding a real
// adapter for one of these never requires touching this function, only
// registering the adapter in retrieval/router.ts.
const TIER_1_OFFICIAL_DOMAINS = [
  "tcmb.gov.tr",
  "tuik.gov.tr",
  "resmigazete.gov.tr",
  "mevzuat.gov.tr",
  "tkgm.gov.tr",
  "csb.gov.tr",
  "sariyer.bel.tr",
];

// TIER 2/3/4 allowlists are intentionally empty today — no primary-data,
// financial-news, or specialist adapter is actually integrated yet (only
// the Tier-1 TCMB adapter is live; see the Phase 2 final report's "exact
// live sources" section). A future adapter for one of these tiers adds its
// domain(s) here — this function's own logic never changes.
const TIER_2_PRIMARY_DATA_DOMAINS: string[] = [];
const TIER_3_FINANCIAL_NEWS_DOMAINS: string[] = [];
const TIER_4_SPECIALIST_DOMAINS: string[] = [];

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesDomain(hostname: string, allowlist: string[]): boolean {
  return allowlist.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export function classifySourceTier(url: string): SourceTier {
  const hostname = hostnameOf(url);
  if (!hostname) return "commentary";

  if (matchesDomain(hostname, TIER_1_OFFICIAL_DOMAINS)) return "official-authority";
  if (matchesDomain(hostname, TIER_2_PRIMARY_DATA_DOMAINS)) return "primary-data";
  if (matchesDomain(hostname, TIER_3_FINANCIAL_NEWS_DOMAINS)) return "financial-news";
  if (matchesDomain(hostname, TIER_4_SPECIALIST_DOMAINS)) return "specialist";

  return "commentary";
}
