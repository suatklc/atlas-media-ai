// Phase 1: narrow provider-abstraction contract for image generation (plus,
// since Video/Reels V1, one image-to-video job type — see the bottom).
// Deliberately excludes any other video job types, a generic GeneratedMedia union,
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

// ============================================================
// Video/Reels V1 — the acknowledged seam above, extended with ONE video
// job type (image-to-video), not a generic media union. The planning
// brain stays ContentOpportunity -> ContentPlan -> CreativeBrief; this
// layer only turns an already-decided prompt + first frame into a clip.
// ============================================================

export type VideoProvider = "fal";

// Instagram Reels / vertical short-form only, for now.
export type VideoAspectRatio = "9:16";

// Named cost tiers instead of free-form duration/resolution — the only
// two shapes Atlas ever requests (see media/config.ts's VIDEO_TIERS).
export type VideoTier = "test" | "final";

export type VideoGenerationRequest = {
  provider: VideoProvider;
  model: string;
  prompt: string;
  // First frame — a publicly fetchable URL (e.g. Atlas's own uploaded
  // base image in Supabase Storage).
  imageUrl: string;
  aspectRatio: VideoAspectRatio;
  tier: VideoTier;
};

export type GeneratedVideo = {
  bytes: Buffer;
  contentType: string;
  durationSeconds: number;
  estimatedCostUsd: number;
};
