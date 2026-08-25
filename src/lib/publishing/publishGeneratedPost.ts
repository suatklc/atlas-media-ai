import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluatePublishEligibility } from "./eligibility";
import { publishPost } from "./router";
import { listConnectedMetaAccounts } from "./connections/query";
import { getConnectedAccountCredential } from "./connections/credentials";
import { resolvePlatformFromMetadata } from "../ai/platform/config";

export type PublishGeneratedPostResult = { success: true } | { success: false; error: string };

// The single sanctioned entry point for turning an "approved" generated_posts
// row into a real, published Instagram post. Server-only. Pulled out of the
// "use server" action in dashboard/actions.ts (which only handles auth +
// revalidatePath) so this can be unit-tested directly with a mocked
// Supabase client, and so the action itself stays a thin wrapper.
//
// Every step here REUSES an already-sanctioned boundary — this file invents
// no new credential/DB access path:
//   - evaluatePublishEligibility (eligibility.ts) gates on status/platform/
//     caption/image exactly as already defined; a draft or otherwise
//     ineligible post never proceeds past this point.
//   - listConnectedMetaAccounts (connections/query.ts) is the one sanctioned
//     safe-summary query for connected_accounts.
//   - getConnectedAccountCredential (connections/credentials.ts) is the one
//     sanctioned way to decrypt a Vault-stored credential.
//   - publishPost (router.ts) is the one sanctioned dispatch into a real
//     provider call.
// generated_posts.status is written as "posted" ONLY after publishPost
// itself reports success — any failure at any step above returns
// success:false without ever touching the row's status.
export async function publishGeneratedPost(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
): Promise<PublishGeneratedPostResult> {
  const { data: post, error: postError } = await supabase
    .from("generated_posts")
    .select("id, content, final_image_url, status, metadata")
    .eq("id", postId)
    .eq("user_id", userId)
    .single();

  if (postError || !post) {
    return { success: false, error: "Gönderi bulunamadı." };
  }

  const platform = resolvePlatformFromMetadata(post.metadata);

  const eligibility = evaluatePublishEligibility({
    status: post.status,
    platform,
    caption: post.content,
    finalImageUrl: post.final_image_url,
  });

  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason };
  }

  const accounts = await listConnectedMetaAccounts(supabase, userId);
  const account = accounts.find((a) => a.platform === eligibility.platform && a.hasCredential);

  if (!account) {
    return { success: false, error: "Bağlı ve kimlik bilgisi kayıtlı bir hesap bulunamadı." };
  }

  const accessToken = await getConnectedAccountCredential(supabase, account.id);
  if (!accessToken) {
    return { success: false, error: "Kimlik bilgisi alınamadı." };
  }

  const result = await publishPost({
    platform: eligibility.platform,
    caption: post.content,
    imageUrl: post.final_image_url,
    externalAccountId: account.externalAccountId,
    accessToken,
  });

  if (!result.success) {
    return { success: false, error: result.error };
  }

  // metadata already carries { platform, ... } (see generate-visual/route.ts)
  // — merged, never overwritten, so the publish result doesn't erase it.
  const existingMetadata =
    post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata)
      ? (post.metadata as Record<string, unknown>)
      : {};

  const { error: updateError } = await supabase
    .from("generated_posts")
    .update({
      status: "posted",
      metadata: { ...existingMetadata, instagramMediaId: result.externalPostId ?? null },
    })
    .eq("id", postId)
    .eq("user_id", userId);

  if (updateError) {
    console.error("Post status update after publish error:", updateError);
    return { success: false, error: "Paylaşıldı ancak durum güncellenemedi. Lütfen sayfayı yenileyin." };
  }

  return { success: true };
}
