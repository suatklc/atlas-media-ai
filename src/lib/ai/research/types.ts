import type { AudienceType, ContentIntent } from "../content/types";

// Phase 1 (Research -> Content Opportunity): the smallest structural
// contract needed for a research-derived idea to enter the EXISTING
// ContentPlan/CreativeBrief pipeline (see opportunity.ts's buildSeedMessage)
// as if a user had typed it. Deliberately excludes retrieval, ranking,
// scheduling, and any live source-fetching mechanism — those are later,
// separate work. Reuses AudienceType/ContentIntent from content/types.ts
// rather than redefining a second, competing taxonomy.

// Source-quality hierarchy, most to least trustworthy — gates how a
// source's facts may be worded in opportunity.ts's buildResearchDirective
// (e.g. commentary-only sources may never be presented as verified fact).
export type SourceTier =
  | "official-authority"
  | "primary-data"
  | "financial-news"
  | "specialist"
  | "commentary";

export type ResearchSource = {
  title: string;
  publisher: string;
  url: string;
  // ISO date string (e.g. "2026-08-20") — when the source itself was
  // published, not when Atlas retrieved it. Required so a fact can always
  // be attributed "according to X, published on Y" rather than stated as a
  // timeless truth (see buildResearchDirective).
  publishedAt: string;
  tier: SourceTier;
};

export type ContentOpportunityFreshness = "breaking" | "recent" | "evergreen-adjacent";

export type ContentOpportunity = {
  topic: string;
  angle: string;
  whyNow: string;
  keyFacts: string[];
  sources: ResearchSource[];
  freshness: ContentOpportunityFreshness;
  // Optional hints only — opportunity.ts's buildSeedMessage uses these to
  // shape the wording of the synthetic message it produces, but the
  // EXISTING detectContentIntent/resolveAudience classifiers (content/
  // intent.ts, content/audience.ts) still make the actual determination
  // from that rendered text, exactly as they would for a real user
  // message. Never force-assigned/overridden downstream — doing so would
  // mean a second, parallel classification path.
  audience?: AudienceType;
  riskCaveat?: string;
  suggestedContentType?: ContentIntent;
};
