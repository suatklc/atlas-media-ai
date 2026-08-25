import type { ContentFormat, TemplateDefinition } from "./types";

// Declarative catalog — structural metadata only, never generated content.
export const templateCatalog: TemplateDefinition[] = [
  {
    id: "PREMIUM_LISTING_01",
    format: "single-premium-post",
    layoutType: "single-image-overlay",
    sectionStructure: ["hook", "key-features", "cta"],
    recommendedSlideCount: 1,
    visualEmphasis: "photo-forward",
    ctaPosition: "overlay",
  },
  {
    id: "EDUCATIONAL_CAROUSEL_01",
    format: "carousel",
    layoutType: "multi-slide-sequence",
    sectionStructure: ["hook", "point-1", "point-2", "point-3", "summary", "cta-slide"],
    recommendedSlideCount: 6,
    visualEmphasis: "text-forward",
    ctaPosition: "end",
  },
  {
    id: "COMPARISON_01",
    format: "comparison-graphic",
    layoutType: "split-comparison",
    sectionStructure: ["title", "option-a", "option-b", "verdict"],
    recommendedSlideCount: 1,
    visualEmphasis: "data-visualization",
    ctaPosition: "caption-only",
  },
  {
    id: "INFOGRAPHIC_01",
    format: "infographic",
    layoutType: "data-grid",
    sectionStructure: ["title", "stat-1", "stat-2", "stat-3", "source-note"],
    recommendedSlideCount: 1,
    visualEmphasis: "data-visualization",
    ctaPosition: "caption-only",
  },
  {
    id: "ANNOUNCEMENT_01",
    format: "simple-branded-post",
    layoutType: "branded-frame",
    sectionStructure: ["headline", "detail", "cta"],
    recommendedSlideCount: 1,
    visualEmphasis: "text-forward",
    ctaPosition: "overlay",
  },
];

// Pure lookup — must only ever be called with an already-resolved format.
export function selectTemplate(format: ContentFormat): TemplateDefinition | undefined {
  return templateCatalog.find((template) => template.format === format);
}
