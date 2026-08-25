export type ContentIntent =
  | "listing"
  | "educational"
  | "comparison"
  | "market-stats"
  | "announcement"
  | "none";

export type ContentGoal = "lead-generation" | "brand-awareness" | "education" | "authority" | "engagement";

export type AudienceType =
  | "luxury-home-buyer"
  | "villa-buyer"
  | "land-investor"
  | "property-owner"
  | "first-time-home-buyer"
  | "commercial-investor"
  | "general-buyer";

export type ContentFormat =
  | "single-premium-post"
  | "carousel"
  | "comparison-graphic"
  | "infographic"
  | "simple-branded-post"
  | "none";

export type OutputMode = "single" | "carousel";

export type OutputSpecification = {
  outputMode: OutputMode;
  slideCount: number;
};

export type TemplateDefinition = {
  id: string;
  format: ContentFormat;
  layoutType: string;
  sectionStructure: string[];
  recommendedSlideCount: number;
  visualEmphasis: string;
  ctaPosition: "end" | "overlay" | "caption-only";
};

export type ContentPlan = {
  intent: ContentIntent;
  goal?: ContentGoal;
  audience: AudienceType;
  outputMode: OutputMode;
  slideCount: number;
  format: ContentFormat;
  template?: TemplateDefinition;
};
