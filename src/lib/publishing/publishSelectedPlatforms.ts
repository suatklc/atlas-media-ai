import type { SupabaseClient } from "@supabase/supabase-js";
import { publishGeneratedPost } from "./publishGeneratedPost";
import { publishGeneratedPostToFacebook, readFacebookPublishState } from "./publishFacebookPost";

// "Seçili Platformlarda Yayınla" — the ONE explicit publish action for an
// approved post. Server-only. Publishes only to the platforms Suat ticked
// (nothing is pre-selected, nothing is inferred from connected accounts),
// each platform exactly once per action and independently:
//   - Instagram: the existing, protected publishGeneratedPost path
//     (status approved -> posted only after Meta confirms). An already
//     posted row is reported, never re-published.
//   - Facebook: publishGeneratedPostToFacebook (Page post, 5 slides in
//     order, result in metadata.publishResults.facebook). An already
//     published Facebook result is reported, never re-published.
// One platform's failure never retries, skips or triggers the other; the
// caller gets one outcome per selected platform, never a global "success".

export const PUBLISH_PLATFORMS = ["instagram", "facebook"] as const;
export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number];

export type PlatformOutcome = {
  platform: PublishPlatform;
  status: "published" | "already-published" | "failed";
  message: string;
};

export type PublishSelectedResult = { error: string | null; results: PlatformOutcome[] };

export function parseSelectedPlatforms(values: unknown[]): PublishPlatform[] | null {
  const selected = PUBLISH_PLATFORMS.filter((platform) => values.includes(platform));
  const unknown = values.some((value) => !PUBLISH_PLATFORMS.includes(value as PublishPlatform));
  return selected.length === 0 || unknown ? null : selected;
}

export async function publishToSelectedPlatforms(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  platforms: PublishPlatform[],
): Promise<PublishSelectedResult> {
  if (platforms.length === 0) return { error: "En az bir platform seçin.", results: [] };

  const { data: post, error } = await supabase
    .from("generated_posts")
    .select("id, status, metadata")
    .eq("id", postId)
    .eq("user_id", userId)
    .single<{ id: string; status: string; metadata: unknown }>();
  if (error || !post) return { error: "Gönderi bulunamadı.", results: [] };

  // Explicit approval first — nothing is published from a draft.
  if (post.status !== "approved" && post.status !== "posted") {
    return { error: "Gönderi henüz onaylanmadı.", results: [] };
  }

  const results: PlatformOutcome[] = [];

  if (platforms.includes("instagram")) {
    if (post.status === "posted") {
      results.push({ platform: "instagram", status: "already-published", message: "Instagram'da zaten paylaşıldı." });
    } else {
      const result = await publishGeneratedPost(supabase, userId, postId);
      results.push(
        result.success
          ? { platform: "instagram", status: "published", message: "Paylaşıldı" }
          : { platform: "instagram", status: "failed", message: result.error },
      );
    }
  }

  if (platforms.includes("facebook")) {
    if (readFacebookPublishState(post.metadata)?.state === "published") {
      results.push({ platform: "facebook", status: "already-published", message: "Facebook'ta zaten paylaşıldı." });
    } else {
      const result = await publishGeneratedPostToFacebook(supabase, userId, postId);
      results.push(
        result.success
          ? { platform: "facebook", status: "published", message: "Paylaşıldı" }
          : { platform: "facebook", status: "failed", message: result.error },
      );
    }
  }

  return { error: null, results };
}
