import type { PublishRequest, PublishResult } from "../types";
import {
  MetaGraphApiError,
  createInstagramCarouselContainer,
  createInstagramMediaContainer,
  publishInstagramMediaContainer,
  waitForInstagramContainerReady,
} from "../connections/meta-graph";

// Meta (Instagram + Facebook) publishing provider.
//
// Instagram is live: real Graph API calls via connections/meta-graph.ts,
// using the same "Instagram API with Instagram Login" product (and the
// same graph.instagram.com host) the OAuth connection flow already
// verified against Meta's current documentation — no separate/older
// Instagram Graph API host or request shape is used here. The credential
// (request.accessToken) is resolved by the caller BEFORE this file is ever
// reached (see publishGeneratedPost.ts) — this provider makes no Supabase/
// Vault call of its own and never logs the token it's given.
//
// Facebook remains an intentional stub: this task's scope is Instagram
// only (Handoff 6 Step 5D follow-up). Kept as a distinct function — never
// conflated with Instagram's two-step flow — so implementing it later is
// additive, not a restructuring of this file.
async function publishFacebookPagePost(request: PublishRequest): Promise<never> {
  throw new Error(`Facebook sayfa paylaşımı henüz uygulanmadı (platform: ${request.platform}).`);
}

// Every container is checked with waitForInstagramContainerReady before it
// is used: Meta only publishes a container whose status_code is FINISHED,
// and a freshly created one is still IN_PROGRESS (measured live). A
// carousel post follows Meta's documented flow — one is_carousel_item child
// per slide (in slide order), then one CAROUSEL container carrying the
// caption — so what Suat approved (all slides) is what gets published,
// never just the cover.
async function createInstagramContainer(request: PublishRequest): Promise<string> {
  const base = { igUserId: request.externalAccountId, accessToken: request.accessToken };
  const slides = request.carouselImageUrls;

  if (!slides || slides.length === 0) {
    const containerId = await createInstagramMediaContainer({ ...base, imageUrl: request.imageUrl, caption: request.caption });
    await waitForInstagramContainerReady({ containerId, accessToken: request.accessToken });
    return containerId;
  }

  // Created concurrently (Meta fetches/processes them in parallel); slide
  // order is fixed by the children list below, not by creation order.
  const childContainerIds = await Promise.all(
    slides.map((imageUrl) => createInstagramMediaContainer({ ...base, imageUrl, isCarouselItem: true })),
  );
  for (const containerId of childContainerIds) {
    await waitForInstagramContainerReady({ containerId, accessToken: request.accessToken });
  }
  const carouselId = await createInstagramCarouselContainer({ ...base, childContainerIds, caption: request.caption });
  await waitForInstagramContainerReady({ containerId: carouselId, accessToken: request.accessToken });
  return carouselId;
}

// Dispatches by platform within the Meta provider, converts any failure
// into a typed PublishResult — never a thrown exception escaping to the
// caller, and never a fabricated success. The Instagram branch only
// resolves `success: true` once BOTH the container-creation and publish
// Graph API calls have themselves returned a real id — a failure at either
// step is caught below and reported as success: false, so the caller
// (publishGeneratedPost.ts) can never mark a generated_posts row "posted"
// on anything other than a confirmed Meta-side publish.
export async function publishToMeta(request: PublishRequest): Promise<PublishResult> {
  try {
    if (request.platform === "instagram") {
      const containerId = await createInstagramContainer(request);

      const mediaId = await publishInstagramMediaContainer({
        igUserId: request.externalAccountId,
        accessToken: request.accessToken,
        containerId,
      });

      return { success: true, platform: request.platform, externalPostId: mediaId };
    }

    if (request.platform === "facebook") {
      await publishFacebookPagePost(request);
      // Unreachable — publishFacebookPagePost always throws. Kept so this
      // branch's shape is already correct for when a live implementation
      // replaces the stub above.
      return { success: true, platform: request.platform };
    }

    return {
      success: false,
      platform: request.platform,
      error: "Meta sağlayıcısı bu platformu desteklemiyor.",
    };
  } catch (error) {
    // One line with the failed stage and Meta's own error fields (code,
    // subcode, type, message, fbtrace_id) — never the token or request.
    const details = error instanceof MetaGraphApiError ? error.details : undefined;
    console.error(
      details
        ? `Meta publishing error — platform=${request.platform} stage=${details.stage} status=${details.httpStatus ?? "yok"} code=${details.code ?? "yok"} subcode=${details.subcode ?? "yok"} type=${details.type ?? "yok"} fbtrace_id=${details.fbtraceId ?? "yok"} message=${details.message ?? (error as Error).message}`
        : `Meta publishing error — platform=${request.platform}: ${error instanceof MetaGraphApiError ? error.message : "unknown error"}`,
    );
    return {
      success: false,
      platform: request.platform,
      error: "Meta üzerinden yayınlama başarısız oldu.",
    };
  }
}
