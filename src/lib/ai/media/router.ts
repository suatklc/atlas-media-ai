import type { GeneratedImage, GeneratedVideo, ImageGenerationRequest, VideoGenerationRequest } from "./types";
import { estimateVideoCostUsd, MAX_VIDEO_COST_PER_REQUEST_USD } from "./config";
import { generateOpenAIImage } from "./providers/openai";
import { generateFalImage, generateFalVideo } from "./providers/fal";

// Pure routing by request.provider — no automatic/AI-based provider
// selection, no fallback between providers. The switch is exhaustive over
// ImageProvider at compile time; the default branch is a runtime guard only
// (e.g. a value that reached here via an `as` cast or an unvalidated
// external source), never expected to fire for a type-checked caller.
export async function generateImage(request: ImageGenerationRequest): Promise<GeneratedImage> {
  switch (request.provider) {
    case "openai":
      return generateOpenAIImage(request);
    case "fal":
      return generateFalImage(request);
    default: {
      const unsupported: never = request.provider;
      throw new Error(`Unsupported image provider: ${String(unsupported)}`);
    }
  }
}

// ============================================================
// Video/Reels V1 cost controls — paid video generation is OFF unless the
// server explicitly sets VIDEO_GENERATION_ENABLED=true, and every request
// is priced (conservatively) against a hard per-request cap BEFORE any
// provider call. Both checks fail closed. Generating a clip never
// approves or publishes anything — it only produces a draft asset.
// ============================================================

export class VideoGenerationBlockedError extends Error {}

export function isVideoGenerationEnabled(): boolean {
  return process.env.VIDEO_GENERATION_ENABLED === "true";
}

export function assertVideoGenerationAllowed(request: VideoGenerationRequest): number {
  if (!isVideoGenerationEnabled()) {
    throw new VideoGenerationBlockedError("Video generation is disabled (VIDEO_GENERATION_ENABLED is not 'true').");
  }
  const estimatedCostUsd = estimateVideoCostUsd(request.tier);
  if (!(estimatedCostUsd > 0) || estimatedCostUsd > MAX_VIDEO_COST_PER_REQUEST_USD) {
    throw new VideoGenerationBlockedError(
      `Estimated video cost $${estimatedCostUsd} exceeds the $${MAX_VIDEO_COST_PER_REQUEST_USD} per-request cap.`,
    );
  }
  return estimatedCostUsd;
}

export async function generateVideo(request: VideoGenerationRequest): Promise<GeneratedVideo> {
  const estimatedCostUsd = assertVideoGenerationAllowed(request);
  switch (request.provider) {
    case "fal":
      return generateFalVideo(request, estimatedCostUsd);
    default: {
      const unsupported: never = request.provider;
      throw new Error(`Unsupported video provider: ${String(unsupported)}`);
    }
  }
}
