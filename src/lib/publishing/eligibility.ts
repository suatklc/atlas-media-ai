import type { PlatformId } from "../ai/platform/config";
import { isPlatformId } from "../ai/platform/config";
import type { PublishingProviderId } from "./types";
import { PLATFORM_PUBLISHING_CAPABILITIES } from "./config";

// Server-side only, pure, no DB/network access — the caller supplies
// whatever it already has from a generated_posts row. Never mutates
// anything, never publishes anything; a "true" result only means
// "eligible to proceed toward publishing," not that publishing happened.
export type PublishEligibilityInput = {
  status: string;
  platform: unknown;
  caption: string | null | undefined;
  finalImageUrl: string | null | undefined;
};

export type PublishEligibility =
  | { eligible: true; platform: PlatformId; providerId: PublishingProviderId }
  | { eligible: false; reason: string };

// A generated post may proceed toward publishing only if every one of
// these holds — status, platform validity, caption presence, image
// presence, and a configured provider for that platform. Any single
// failure returns a specific, human-readable reason rather than a bare
// boolean, so a future caller can surface exactly why.
export function evaluatePublishEligibility(input: PublishEligibilityInput): PublishEligibility {
  if (input.status !== "approved") {
    return { eligible: false, reason: "Gönderi henüz onaylanmadı." };
  }

  if (!isPlatformId(input.platform)) {
    return { eligible: false, reason: "Geçerli bir platform bulunamadı." };
  }

  if (!input.caption || !input.caption.trim()) {
    return { eligible: false, reason: "Paylaşılabilir metin bulunamadı." };
  }

  if (!input.finalImageUrl || !input.finalImageUrl.trim()) {
    return { eligible: false, reason: "Görsel URL'si bulunamadı." };
  }

  const capability = PLATFORM_PUBLISHING_CAPABILITIES[input.platform];
  if (!capability.providerId) {
    return { eligible: false, reason: `${input.platform} için henüz bir yayınlama sağlayıcısı yok.` };
  }

  return { eligible: true, platform: input.platform, providerId: capability.providerId };
}
