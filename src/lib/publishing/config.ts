import type { PlatformId } from "../ai/platform/config";
import type { PublishingProviderId } from "./types";

// Centralized capability map — one place declaring which platforms have an
// assigned publishing provider and what that provider is known to support,
// mirroring the same "small named allowlist" pattern already used by
// media/config.ts and platform/config.ts. A platform with no providerId
// (LinkedIn, Google Business today) is an explicit, typed "not yet
// supported" state, never a fake/guessed provider.
export type PlatformPublishingCapability = {
  platform: PlatformId;
  providerId?: PublishingProviderId;
  supportsImagePublishing: boolean;
};

export const PLATFORM_PUBLISHING_CAPABILITIES: Record<PlatformId, PlatformPublishingCapability> = {
  instagram: { platform: "instagram", providerId: "meta", supportsImagePublishing: true },
  facebook: { platform: "facebook", providerId: "meta", supportsImagePublishing: true },
  // Recognized MVP platforms with no provider implementation yet — do not
  // invent one. router.ts's own switch treats an undefined providerId as
  // an explicit failure, never a silent fallback to "meta" or anywhere else.
  linkedin: { platform: "linkedin", supportsImagePublishing: false },
  "google-business": { platform: "google-business", supportsImagePublishing: false },
};
