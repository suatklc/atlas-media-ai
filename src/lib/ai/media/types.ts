// Phase 1: narrow provider-abstraction contract for image generation only.
// Deliberately excludes video job types, a generic GeneratedMedia union,
// commercial quality tiers, and platform concepts — those are later phases
// (see the Phase 1 audit), not premature generalization here.

export type ImageProvider = "openai" | "fal";

// Atlas's own semantic aspect ratios — never a provider's native size enum
// (e.g. OpenAI's "1024x1536" or a fal model's width/height). Each provider
// adapter is responsible for mapping this to whatever its own model needs.
export type ImageAspectRatio = "1:1" | "4:5" | "3:2";

export type ImageGenerationRequest = {
  provider: ImageProvider;
  model: string;
  prompt: string;
  aspectRatio: ImageAspectRatio;
};

export type GeneratedImage = {
  bytes: Buffer;
  contentType: string;
};
