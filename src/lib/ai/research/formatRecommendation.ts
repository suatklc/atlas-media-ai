import type { ContentOpportunity } from "./types";

// Current Content Opportunities UI: a small, deterministic recommendation
// of which VISUAL FORMAT best suits a given opportunity — "single" or
// "carousel" only today. Structured as a union type (not a boolean) and a
// small ordered rule list specifically so a future third option
// ("video"/"reels") is an additive change here — one more union member,
// one more rule — never a redesign of this function's shape or of
// whatever UI consumes it.
//
// This is a PRESENTATION/recommendation concept, not a new content-
// planning authority: it never overrides ContentIntent, never bypasses
// buildContentPlan, and is not read by anything in content/ or creative/.
// It only helps the dashboard pre-select a sensible default for the
// user's own, always-overridable choice (see the UI component).
export type RecommendedVisualFormat = "single" | "carousel";

// Carousel is preferred for content whose own research-stage
// classification already signals multiple distinct takeaways or a
// step-by-step/regulatory explanation — "educational" is the one
// suggestedContentType value this pipeline's own discover.ts ever assigns
// for that kind of content (see discover.ts's suggestContentType — tapu/
// imar/mevzuat/yönetmelik/kanun-pattern titles, and its own safe default
// for anything unclassified). "comparison" is included for the same
// reason even though no current live adapter produces it, since a
// checklist/comparison structure is equally carousel-appropriate by the
// same reasoning, and ContentIntent already defines it. Every other
// suggestedContentType (market-stats, listing, announcement, and the
// absence of one) is a single dominant-insight/single-announcement case —
// "single" is the safe default.
const CAROUSEL_PREFERRED_TYPES = new Set<ContentOpportunity["suggestedContentType"]>(["educational", "comparison"]);

export function recommendVisualFormat(opportunity: ContentOpportunity): RecommendedVisualFormat {
  return opportunity.suggestedContentType && CAROUSEL_PREFERRED_TYPES.has(opportunity.suggestedContentType)
    ? "carousel"
    : "single";
}

// The user's own, always-overridable format choice (see the dashboard
// component) is threaded through as the ContentOpportunity's own
// suggestedContentType — no new backend field, no new ContentPlan path.
// "carousel" forces the educational/checklist framing (-> the existing
// EDUCATIONAL_CAROUSEL_01 template, dispatched to the existing educational
// renderer by templates/select.ts, unmodified); "single" leaves the
// opportunity's own research-stage classification exactly as-is — a
// market-stats/announcement/listing opportunity keeps its own single-
// insight framing, and an educational opportunity the user overrides to
// "single" anyway is deliberately NOT force-reclassified to something
// else (e.g. market-stats) — that would risk misrepresenting genuinely
// regulatory/informational content as a market statistic merely to fit a
// visual-format choice, which is a worse error than leaving it educational.
export function buildOpportunityForFormat(
  opportunity: ContentOpportunity,
  format: RecommendedVisualFormat,
): ContentOpportunity {
  if (format === "carousel") {
    return { ...opportunity, suggestedContentType: "educational" };
  }
  return opportunity;
}
