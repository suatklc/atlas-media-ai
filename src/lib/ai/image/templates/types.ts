// Package 5A: the structured contract between Content Planning/Creative
// Intelligence and the compositor. Small and intentional — carries only
// fields already computed upstream today and genuinely useful to
// deterministic composition. Deliberately excludes supporting points/lines:
// no structured model for those exists yet (see Package 5 audit, Part C) —
// fabricating or parsing them here would be premature for 5A.

export type VisualTemplateId = "hero" | "educational" | "comparison";

export type CompositionInput = {
  // Content Planning's own template id (e.g. "PREMIUM_LISTING_01") — carried
  // through for traceability; the compositor's rendering choices are driven
  // by visualTemplateId below, not this raw id.
  contentTemplateId: string;

  // Deterministic mapping of contentTemplateId -> rendering family (see
  // templates/select.ts). Accepted by the compositor now; not yet used to
  // branch rendering behavior until Package 5B.
  visualTemplateId: VisualTemplateId;

  // Already computed by Creative Intelligence (creativeBrief.execution),
  // currently unused by compose.ts's actual canvas math — threaded through
  // now so 5B can switch to it without another signature change.
  aspectRatio: string;
  dimensionsPx: string;

  // Free-text per-template guidance from creative/lookups.ts — descriptive
  // only, not yet consumed by any deterministic rendering rule.
  typographyHierarchy: string;
  textPlacement: string;
  logoPlacement: string;
  ctaVisualTreatment: string;

  // Existing rendered content (Package 4) — unchanged in meaning.
  headline: string;
  cta?: string;

  // Package 5C: concise candidate points extracted from the same Claude
  // response's [[EDUCATIONAL_POINTS: ...]] marker (see creative/caption.ts,
  // creative/directive.ts). Plain strings only — no title/description
  // object shape here, since that's all the marker actually produces;
  // educational.ts maps each string to a title-only point at the point of
  // consumption. Ignored by hero/comparison. Absent/empty means "no
  // structured points available" (e.g. non-educational content, or an
  // older/malformed response) — never fabricated.
  educationalPoints?: string[];
};
