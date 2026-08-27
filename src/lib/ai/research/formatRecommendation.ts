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

// --- Format <-> ContentIntent decoupling (Grounded Content Safety + Real
// Multi-Slide Carousel) ---
//
// Replaces the previous buildOpportunityForFormat, which forced
// suggestedContentType to "educational" whenever the user picked Carousel
// — a hack that worked only because carousel visual generation didn't
// really exist yet (every ContentOpportunity request was silently forced
// to outputMode "single" regardless of format choice; see the old fixed
// "Tek görsel üret." suffix this replaces). Now that generate-visual/
// route.ts can actually render a carousel, ContentIntent and visual output
// format are genuinely separate concerns: the opportunity's own
// suggestedContentType (its real research-stage classification) is never
// rewritten, and the user's Tek Görsel/Carousel choice instead travels as
// its own explicit `visualFormat` request field, resolved to outputMode
// via the exact same existing content/format.ts trigger-phrase mechanism
// every ordinary chat message already uses — no new ContentPlan path, no
// new outputMode authority.
export function isVisualFormat(value: unknown): value is RecommendedVisualFormat {
  return value === "single" || value === "carousel";
}

// content/format.ts's resolveOutputSpecification recognizes both phrases
// today (SINGLE_PATTERNS/CAROUSEL_PATTERNS + COUNT_PATTERNS) — this is not
// a new parsing path, only a deliberate choice of which existing trigger
// phrase to append based on the user's explicit format field. "5 slaytlık"
// pins slideCount to exactly 5 (checked before the bare "carousel" word —
// see resolveOutputSpecification's own explicitCount-first precedence),
// matching the carousel renderer's fixed 5-slide structure.
export function buildFormatSuffix(format: RecommendedVisualFormat): string {
  return format === "carousel" ? " 5 slaytlık carousel oluştur." : " Tek görsel üret.";
}
