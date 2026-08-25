import type { ImageAspectRatio } from "../media/types";

// Phase 1: a minimal, typed target-platform layer — output-format selection
// only. No captions, tone, publishing, scheduling, or account concepts here;
// those are explicitly later work. Aspect ratios are drawn only from
// ImageAspectRatio (the media layer's own existing type), never a new
// platform-specific size concept — provider adapters need no changes.

export type PlatformId = "instagram" | "facebook" | "linkedin" | "google-business";

export type PlatformConfig = {
  id: PlatformId;
  label: string;
  aspectRatio: ImageAspectRatio;
  dimensions: string;
};

// Instagram is the production default — these exact values match what
// generate-visual/route.ts's own hardcoded FINAL_FORMAT already produced,
// so a request with no platform (or an explicit "instagram") is unchanged.
export const DEFAULT_PLATFORM: PlatformId = "instagram";

// One centralized map — MVP output presets, not a claim that each platform
// supports only this one size. One preset per platform for this first
// implementation; do not add more without a reason to.
export const PLATFORM_CONFIGS: Record<PlatformId, PlatformConfig> = {
  instagram: { id: "instagram", label: "Instagram", aspectRatio: "4:5", dimensions: "1080x1350" },
  facebook: { id: "facebook", label: "Facebook", aspectRatio: "1:1", dimensions: "1080x1080" },
  linkedin: { id: "linkedin", label: "LinkedIn", aspectRatio: "1:1", dimensions: "1080x1080" },
  "google-business": {
    id: "google-business",
    label: "Google Business",
    aspectRatio: "1:1",
    dimensions: "1080x1080",
  },
};

export function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLATFORM_CONFIGS, value);
}

// Reads the "platform" key out of a generated_posts row's untyped metadata
// JSONB column. Extracted here (rather than left as a local copy in each
// caller) so GenerationHistory.tsx's display and publishGeneratedPost.ts's
// publish-time platform resolution can never silently drift apart — both
// now interpret the exact same shape through one function. Legacy rows (no
// platform key, or an old/invalid value) safely resolve to DEFAULT_PLATFORM,
// never a crash or an arbitrary string.
export function resolvePlatformFromMetadata(metadata: unknown): PlatformId {
  const platform =
    metadata && typeof metadata === "object" && "platform" in metadata
      ? (metadata as { platform?: unknown }).platform
      : undefined;
  return isPlatformId(platform) ? platform : DEFAULT_PLATFORM;
}
