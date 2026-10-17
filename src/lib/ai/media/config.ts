import type { ImageProvider, VideoProvider, VideoTier } from "./types";

// Today's exact production behavior — must not change as part of provider
// abstraction. generate-visual/route.ts uses this unless an explicit,
// allowlisted server-side override is supplied (see IMAGE_MODEL_CONFIGS
// below); there is no public/browser-supplied way to change this.
export const DEFAULT_IMAGE_PROVIDER: ImageProvider = "openai";
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export type ImageModelConfig = {
  provider: ImageProvider;
  model: string;
};

// Named, allowlisted configs only — never an arbitrary provider/model
// string from the browser. To benchmark a new fal model, add a named entry
// here; nothing else needs to change. "fal-benchmark"'s model id is a
// placeholder — set it to the actual model being benchmarked before use.
export const IMAGE_MODEL_CONFIGS: Record<string, ImageModelConfig> = {
  default: { provider: DEFAULT_IMAGE_PROVIDER, model: DEFAULT_IMAGE_MODEL },
  "fal-benchmark": { provider: "openai", model: "gpt-image-1" },
};

// ============================================================
// Video/Reels V1 — fal.ai (already integrated: @fal-ai/client installed,
// FAL_KEY configured) over Higgsfield, which would need a new vendor
// account, prepaid wallet, API key and client for the same underlying
// model families. Seedance 1.5 Pro image-to-video: input schema verified
// against the installed @fal-ai/client's SeedanceProv15ImageToVideoInput
// (9:16, 4-12s, 480p/720p/1080p, optional audio).
// ============================================================

export const DEFAULT_VIDEO_PROVIDER: VideoProvider = "fal";
export const DEFAULT_VIDEO_MODEL = "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

export type VideoResolution = "480p" | "720p" | "1080p";

export type VideoTierConfig = {
  durationSeconds: number;
  resolution: VideoResolution;
  // Native audio stays off: Turkish voice-over/music is a separate,
  // later decision, and audio raises per-second cost.
  generateAudio: false;
};

// "test" = cheapest useful look at motion/composition; "final" = the
// Reel-quality clip. Nothing else is requestable.
export const VIDEO_TIERS: Record<VideoTier, VideoTierConfig> = {
  test: { durationSeconds: 5, resolution: "480p", generateAudio: false },
  final: { durationSeconds: 8, resolution: "1080p", generateAudio: false },
};

// Deliberately CONSERVATIVE (rounded-up) USD-per-second estimates for this
// model, used only as a pre-flight budget guard — fal bills the real
// amount. Re-check fal's model pricing page before the first paid run and
// whenever DEFAULT_VIDEO_MODEL changes.
export const VIDEO_COST_PER_SECOND_USD: Record<VideoResolution, number> = {
  "480p": 0.03,
  "720p": 0.06,
  "1080p": 0.15,
};

// Hard ceiling per single generation request, regardless of tier.
export const MAX_VIDEO_COST_PER_REQUEST_USD = 1.5;

export function estimateVideoCostUsd(tier: VideoTier): number {
  const config = VIDEO_TIERS[tier];
  return Math.round(config.durationSeconds * VIDEO_COST_PER_SECOND_USD[config.resolution] * 100) / 100;
}
