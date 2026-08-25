import type { PublishRequest, PublishResult } from "./types";
import { PLATFORM_PUBLISHING_CAPABILITIES } from "./config";
import { publishToMeta } from "./providers/meta";

// Pure routing by the capability map — no automatic/AI provider selection,
// no fallback between providers, same pattern as media/router.ts. A
// platform with no assigned provider (LinkedIn, Google Business today) is
// an explicit, typed failure — never silently routed to Meta or anywhere
// else.
export async function publishPost(request: PublishRequest): Promise<PublishResult> {
  const capability = PLATFORM_PUBLISHING_CAPABILITIES[request.platform];

  if (!capability.providerId) {
    return {
      success: false,
      platform: request.platform,
      error: `${request.platform} için henüz bir yayınlama sağlayıcısı yapılandırılmadı.`,
    };
  }

  switch (capability.providerId) {
    case "meta":
      return publishToMeta(request);
    default: {
      const unsupported: never = capability.providerId;
      return {
        success: false,
        platform: request.platform,
        error: `Desteklenmeyen yayınlama sağlayıcısı: ${String(unsupported)}`,
      };
    }
  }
}
