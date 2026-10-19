import type { SupabaseClient } from "@supabase/supabase-js";
import { listConnectedMetaAccounts, mergeConnectedAccountMetadata } from "./connections/query";
import { getConnectedAccountCredential } from "./connections/credentials";
import { MetaGraphApiError } from "./connections/meta-graph";
import {
  createPageFeedPost,
  deleteGraphObject,
  getPostPhotoIds,
  uploadUnpublishedPagePhoto,
} from "./connections/facebook-graph";
import { resolveCarouselImageUrls } from "./publishGeneratedPost";
import { selectedFacebookPage } from "./publishFacebookPost";
import type { MultiPhotoCheck } from "./connections/types";

// Non-public multi-photo capability check for the selected Facebook Page.
// Meta documents the multi-photo flow (unpublished photos + attached_media)
// but states no maximum photo count, so before Facebook publishing is
// enabled for carousels Atlas proves it on the real Page:
//   1. upload the user's latest real Atlas carousel slides (PNG) with
//      published=false
//   2. create the parent Page feed post with published=false — an
//      unpublished post never appears in the Page's feed
//   3. read the post's attachments back and require every photo, in order
//   4. delete the unpublished test post (and its photos)
// Nothing here can create a public post (published is hard-coded false).
// The result is stored on the Page connection (metadata.multiPhotoCheck)
// and gates multi-image Facebook publishing.

export type MultiPhotoCheckResult = MultiPhotoCheck;

const CHECK_MESSAGE = "Atlas çoklu görsel testi — yayınlanmadı, otomatik silinir.";

async function latestCarouselImages(supabase: SupabaseClient, userId: string): Promise<string[] | null> {
  const { data } = await supabase
    .from("generated_posts")
    .select("metadata, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const row of data ?? []) {
    const urls = resolveCarouselImageUrls(row.metadata);
    if (Array.isArray(urls)) return urls;
  }
  return null;
}

function describe(error: unknown): string {
  if (error instanceof MetaGraphApiError && error.details) {
    const d = error.details;
    return `${d.stage}: ${d.code ?? ""}${d.subcode ? `/${d.subcode}` : ""} ${d.message ?? error.message}`.trim();
  }
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && message ? message : "bilinmeyen hata";
}

export async function runFacebookMultiPhotoCheck(supabase: SupabaseClient, userId: string): Promise<MultiPhotoCheckResult> {
  const checkedAt = new Date().toISOString();
  const page = selectedFacebookPage(await listConnectedMetaAccounts(supabase, userId));
  if (!page) return { ok: false, count: 0, checkedAt, error: "Seçili Facebook Sayfası yok." };

  const images = await latestCarouselImages(supabase, userId);
  if (!images) return { ok: false, count: 0, checkedAt, error: "Test için Atlas carousel görseli bulunamadı." };

  const pageToken = await getConnectedAccountCredential(supabase, page.id);
  if (!pageToken) return { ok: false, count: 0, checkedAt, error: "Facebook Sayfası kimlik bilgisi alınamadı." };

  const created: string[] = [];
  let result: MultiPhotoCheckResult;
  try {
    const photoIds: string[] = [];
    for (const imageUrl of images) {
      const id = await uploadUnpublishedPagePhoto({ pageId: page.externalAccountId, pageToken, imageUrl });
      photoIds.push(id);
      created.push(id);
    }
    const postId = await createPageFeedPost({
      pageId: page.externalAccountId,
      pageToken,
      message: CHECK_MESSAGE,
      photoIds,
      published: false,
    });
    created.unshift(postId);
    const attached = await getPostPhotoIds({ postId, pageToken });
    const inOrder = attached.length === photoIds.length && attached.every((id, index) => id === photoIds[index]);
    result = inOrder
      ? { ok: true, count: photoIds.length, checkedAt }
      : {
          ok: false,
          count: attached.length,
          checkedAt,
          error:
            attached.length === photoIds.length
              ? "Görsellerin sırası korunmadı."
              : `${photoIds.length} görsel yüklendi, gönderide ${attached.length} görsel bulundu.`,
        };
  } catch (error) {
    console.error(`Facebook multi-photo check failed — ${describe(error)}`);
    result = { ok: false, count: 0, checkedAt, error: describe(error) };
  }

  // Clean up the unpublished test post first, then any stray photos.
  for (const id of created) {
    try {
      await deleteGraphObject({ id, pageToken });
    } catch {
      // Unpublished photos are removed by Meta after ~24 h anyway.
    }
  }

  await mergeConnectedAccountMetadata(supabase, userId, page.id, { multiPhotoCheck: result });
  return result;
}
