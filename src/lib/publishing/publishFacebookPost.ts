import type { SupabaseClient } from "@supabase/supabase-js";
import { publishPost } from "./router";
import { listConnectedMetaAccounts } from "./connections/query";
import { getConnectedAccountCredential } from "./connections/credentials";
import { resolveFacebookText } from "../ai/content/facebookText";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "../ai/context/businessProfile";
import type { ConnectedAccountSummary } from "./connections/types";

// Facebook Page publishing for an approved Atlas post. Server-only.
//
// Independent of Instagram by design: generated_posts.status (the Instagram
// lifecycle draft -> approved -> posted) is never read for anything but the
// approval gate and never written here. The Facebook result lives in
// metadata.publishResults.facebook:
//   { state: "publishing" | "published" | "failed", at, postId?, error? }
// - "published" blocks any further Facebook publish of the same post (no
//   duplicates); "failed" is retryable; a "publishing" marker younger than
//   PUBLISHING_LOCK_MS blocks a concurrent double click.
// - A multi-image post requires the Page's non-public multi-photo check
//   (facebookCapability.ts) to have passed for at least that many photos —
//   never silently reduced to fewer images.

export const PUBLISHING_LOCK_MS = 5 * 60 * 1000;
export const FACEBOOK_REQUIRED_SLIDES = 5;

// Facebook V1 publishes exactly the approved 5-slide carousel: slides 1..5,
// each a public https URL, returned in slide order. Anything else (a
// missing/duplicate slide, a single-image post) is refused BEFORE any Meta
// call — never a cover-only or reduced post.
export function requireFacebookSlides(metadata: unknown): string[] | null {
  const meta = metadataObject(metadata);
  if (meta.outputMode !== "carousel" || !Array.isArray(meta.carouselImages)) return null;
  const bySlide = new Map<number, string>();
  for (const item of meta.carouselImages as Array<{ slide?: unknown; imageUrl?: unknown }>) {
    if (!item || typeof item.slide !== "number" || typeof item.imageUrl !== "string" || !item.imageUrl.startsWith("https://")) return null;
    if (bySlide.has(item.slide)) return null;
    bySlide.set(item.slide, item.imageUrl);
  }
  if (bySlide.size !== FACEBOOK_REQUIRED_SLIDES) return null;
  const ordered: string[] = [];
  for (let slide = 1; slide <= FACEBOOK_REQUIRED_SLIDES; slide += 1) {
    const url = bySlide.get(slide);
    if (!url) return null;
    ordered.push(url);
  }
  return ordered;
}

export type FacebookPublishState = { state: "publishing" | "published" | "failed"; at: string; postId?: string; error?: string };

export type FacebookPublishResult = { success: true; postId: string } | { success: false; error: string };

type PostRow = { id: string; content: string; final_image_url: string; status: string; metadata: unknown };

function metadataObject(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
}

export function readFacebookPublishState(metadata: unknown): FacebookPublishState | null {
  const results = metadataObject(metadata).publishResults as Record<string, unknown> | undefined;
  const facebook = results?.facebook as FacebookPublishState | undefined;
  return facebook && typeof facebook === "object" && typeof facebook.state === "string" ? facebook : null;
}

// The selected, credentialed Facebook Page destination, if any.
export function selectedFacebookPage(accounts: ConnectedAccountSummary[]): ConnectedAccountSummary | undefined {
  return accounts.find((account) => account.platform === "facebook" && account.selected && account.hasCredential);
}

async function writeFacebookState(supabase: SupabaseClient, userId: string, postId: string, state: FacebookPublishState) {
  // Re-read so a concurrent write (e.g. Instagram's instagramMediaId) is
  // merged, never clobbered.
  const { data } = await supabase.from("generated_posts").select("metadata").eq("id", postId).eq("user_id", userId).single();
  const metadata = metadataObject(data?.metadata);
  const publishResults = metadataObject(metadata.publishResults);
  return supabase
    .from("generated_posts")
    .update({ metadata: { ...metadata, publishResults: { ...publishResults, facebook: state } } })
    .eq("id", postId)
    .eq("user_id", userId);
}

export async function publishGeneratedPostToFacebook(
  supabase: SupabaseClient,
  userId: string,
  postId: string,
  now: number = Date.now(),
): Promise<FacebookPublishResult> {
  const { data: post, error: postError } = await supabase
    .from("generated_posts")
    .select("id, content, final_image_url, status, metadata")
    .eq("id", postId)
    .eq("user_id", userId)
    .single<PostRow>();
  if (postError || !post) return { success: false, error: "Gönderi bulunamadı." };

  // Explicit approval is required (approved, or already published to
  // Instagram after approval). A draft can never reach Facebook.
  if (post.status !== "approved" && post.status !== "posted") {
    return { success: false, error: "Gönderi henüz onaylanmadı." };
  }

  const previous = readFacebookPublishState(post.metadata);
  if (previous?.state === "published") return { success: false, error: "Bu gönderi Facebook'ta zaten paylaşıldı." };
  if (previous?.state === "publishing" && now - Date.parse(previous.at) < PUBLISHING_LOCK_MS) {
    return { success: false, error: "Facebook paylaşımı zaten sürüyor. Lütfen birkaç dakika sonra tekrar kontrol edin." };
  }

  const slides = requireFacebookSlides(post.metadata);
  if (!slides) {
    return { success: false, error: "Facebook için 5 carousel görselinin tamamı (1→5) gerekli; gönderi paylaşılmadı." };
  }

  const page = selectedFacebookPage(await listConnectedMetaAccounts(supabase, userId));
  if (!page) return { success: false, error: "Bağlı ve seçili bir Facebook Sayfası bulunamadı." };
  if (!(page.multiPhotoCheck?.ok && page.multiPhotoCheck.count >= slides.length)) {
    return {
      success: false,
      error: `Facebook ${slides.length} görselli gönderi testi henüz doğrulanmadı. Bağlı Hesaplar'dan testi çalıştırın.`,
    };
  }

  const pageToken = await getConnectedAccountCredential(supabase, page.id);
  if (!pageToken) return { success: false, error: "Facebook Sayfası kimlik bilgisi alınamadı." };

  const message = resolveFacebookText(post.metadata, post.content, ATLAS_DEFAULT_BUSINESS_PROFILE.geography.primary);

  const { error: lockError } = await writeFacebookState(supabase, userId, postId, { state: "publishing", at: new Date(now).toISOString() });
  if (lockError) return { success: false, error: "Facebook paylaşımı başlatılamadı. Lütfen tekrar deneyin." };

  const result = await publishPost({
    platform: "facebook",
    caption: message,
    imageUrl: slides[0],
    carouselImageUrls: slides,
    externalAccountId: page.externalAccountId,
    accessToken: pageToken,
  });

  if (!result.success || !result.externalPostId) {
    const error = result.success ? "Meta beklenen gönderi kimliğini döndürmedi." : result.error;
    await writeFacebookState(supabase, userId, postId, { state: "failed", at: new Date().toISOString(), error });
    return { success: false, error };
  }

  const { error: saveError } = await writeFacebookState(supabase, userId, postId, {
    state: "published",
    at: new Date().toISOString(),
    postId: result.externalPostId,
  });
  if (saveError) {
    // Published on Facebook but not recorded: the "publishing" marker stays,
    // which blocks an immediate retry; never reported as a failure.
    console.error("Facebook publish succeeded but the result could not be saved:", saveError.message);
    return { success: false, error: "Facebook'ta paylaşıldı ancak sonuç kaydedilemedi. Tekrar paylaşmadan önce Sayfanızı kontrol edin." };
  }
  return { success: true, postId: result.externalPostId };
}
