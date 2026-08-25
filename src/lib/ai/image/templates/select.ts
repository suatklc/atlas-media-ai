import type { VisualTemplateId } from "./types";

// Deterministic contentTemplateId -> visualTemplateId mapping — pure lookup,
// no AI call, no prose inspection. Reuses the classification Content
// Planning already computed from the user's own request (never Claude's
// generated output). IDs match content/templates.ts's existing catalog
// exactly.
const VISUAL_TEMPLATE_BY_CONTENT_TEMPLATE_ID: Record<string, VisualTemplateId> = {
  PREMIUM_LISTING_01: "hero",
  ANNOUNCEMENT_01: "hero",
  EDUCATIONAL_CAROUSEL_01: "educational",
  INFOGRAPHIC_01: "educational",
  COMPARISON_01: "comparison",
};

// "hero" is the safe fallback for any unrecognized/future contentTemplateId:
// it's today's only proven, working layout (single photo + headline + CTA),
// so an unmapped id degrades to known-good behavior rather than a layout
// that assumes structured data (points/columns) it may not have.
const FALLBACK_VISUAL_TEMPLATE_ID: VisualTemplateId = "hero";

export function selectVisualTemplateId(contentTemplateId: string): VisualTemplateId {
  return VISUAL_TEMPLATE_BY_CONTENT_TEMPLATE_ID[contentTemplateId] ?? FALLBACK_VISUAL_TEMPLATE_ID;
}
