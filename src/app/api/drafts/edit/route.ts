import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isContentPackage, validateContentPackage } from "@/lib/ai/content/contentPackage";
import { applyDraftEdit, parseDraftEdit } from "@/lib/ai/content/draftEdit";
import {
  appendHashtagsToCaption,
  buildNewsCarouselSlideText,
  buildPremiumCarouselText,
} from "@/lib/ai/content/carouselSlides";
import { renderCarousel } from "@/lib/ai/image/templates/carousel";
import { renderPremiumCarousel } from "@/lib/ai/image/templates/premiumCarousel";
import { buildPublishableCaption } from "@/lib/ai/creative/caption";
import { resolveFacebookText } from "@/lib/ai/content/facebookText";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";
import { GENERATED_VISUALS_BUCKET, uploadGeneratedImage } from "@/lib/supabase/storage";

// Draft Edit (Real Use V1): Suat edits the copy of an existing carousel
// DRAFT, and its five slides are re-rendered from the draft's own stored
// base photo (no new paid image generation). The SAME generated_posts row
// is updated in place. This route can never approve or publish: it never
// writes `status`, and the update itself only matches a row that is still
// status = 'draft' — an approved/posted post can't be edited here.

const MAX_CONTENT_LENGTH = 8000;
const DEFAULT_DIMENSIONS = "1080x1350";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Only this project's own public storage objects are ever fetched — never
// an arbitrary URL from the database row.
function isOwnStorageUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  return url.startsWith(`${base.replace(/\/$/, "")}/storage/v1/object/public/${GENERATED_VISUALS_BUCKET}/`);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }
  const postId = (body as { postId?: unknown } | null)?.postId;
  if (typeof postId !== "string" || !postId) return jsonError("Geçersiz gönderi.", 400);
  const edit = parseDraftEdit(body);
  if (typeof edit === "string") return jsonError(edit, 400);

  const { data: post, error: selectError } = await supabase
    .from("generated_posts")
    .select("id, status, base_image_url, metadata")
    .eq("id", postId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (selectError) {
    console.error("Draft edit select error:", selectError);
    return jsonError("Taslak yüklenemedi. Lütfen tekrar deneyin.", 502);
  }
  if (!post) return jsonError("Gönderi bulunamadı.", 404);
  if (post.status !== "draft") return jsonError("Yalnızca taslaklar düzenlenebilir.", 409);

  const metadata = (post.metadata ?? {}) as Record<string, unknown>;
  const original = metadata.contentPackage;
  if (!isContentPackage(original) || original.format !== "carousel") {
    return jsonError("Bu taslak düzenlenemiyor (yapılandırılmış carousel içeriği yok).", 422);
  }

  const updated = applyDraftEdit(original, edit);
  const validation = validateContentPackage(updated);
  if (!validation.ok) return jsonError(`İçerik doğrulanamadı: ${validation.reason}`, 422);

  if (typeof post.base_image_url !== "string" || !isOwnStorageUrl(post.base_image_url)) {
    return jsonError("Taslağın kaynak görseli bulunamadı.", 422);
  }
  let baseImage: Buffer;
  try {
    const response = await fetch(post.base_image_url);
    if (!response.ok) throw new Error(`status ${response.status}`);
    baseImage = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.error("Draft edit base image fetch error:", error instanceof Error ? error.message : error);
    return jsonError("Taslağın kaynak görseli okunamadı. Lütfen tekrar deneyin.", 502);
  }

  const dimensions = typeof metadata.dimensions === "string" ? metadata.dimensions : DEFAULT_DIMENSIONS;
  let slideBuffers: Buffer[];
  try {
    slideBuffers =
      updated.contentMode === "expert"
        ? await renderPremiumCarousel(
            baseImage,
            dimensions,
            buildPremiumCarouselText(updated, ATLAS_DEFAULT_BUSINESS_PROFILE.geography.primary),
          )
        : await renderCarousel(baseImage, dimensions, buildNewsCarouselSlideText(updated));
  } catch (error) {
    console.error("Draft edit carousel composition error:", error);
    return jsonError("Carousel görselleri oluşturulamadı. Lütfen tekrar deneyin.", 502);
  }

  const uploadedSlides: { slide: number; imageUrl: string }[] = [];
  try {
    for (let index = 0; index < slideBuffers.length; index += 1) {
      const uploaded = await uploadGeneratedImage(supabase, user.id, slideBuffers[index], "image/png");
      uploadedSlides.push({ slide: index + 1, imageUrl: uploaded.url });
    }
  } catch (error) {
    console.error("Draft edit slide upload error:", error);
    return jsonError("Görseller kaydedilemedi. Lütfen tekrar deneyin.", 502);
  }

  const captionWithHashtags = appendHashtagsToCaption(updated.caption, updated.hashtags);
  const content = buildPublishableCaption(captionWithHashtags).slice(0, MAX_CONTENT_LENGTH) || captionWithHashtags;

  // Facebook text: unchanged unless Suat edited it; emptied = back to the
  // deterministic default derived from the package.
  const platformText = {
    ...((metadata.platformText as Record<string, unknown> | undefined) ?? {}),
    ...(edit.facebookText !== undefined ? { facebook: edit.facebookText || null } : {}),
  };

  // Same row, still a draft: no `status` in the payload, and the WHERE
  // clause re-checks status = 'draft' so a concurrent approval wins.
  const { data: saved, error: updateError } = await supabase
    .from("generated_posts")
    .update({
      content,
      final_image_url: uploadedSlides[0].imageUrl,
      metadata: {
        ...metadata,
        carouselImages: uploadedSlides,
        contentPackage: updated,
        platformText,
        editedAt: new Date().toISOString(),
      },
    })
    .eq("id", postId)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .select("id");
  if (updateError) {
    console.error("Draft edit update error:", updateError);
    return jsonError("Taslak kaydedilemedi. Lütfen tekrar deneyin.", 502);
  }
  if (!saved || saved.length === 0) return jsonError("Taslak artık düzenlenebilir durumda değil.", 409);

  return Response.json({
    images: uploadedSlides,
    contentPackage: updated,
    facebookText: resolveFacebookText({ contentPackage: updated, platformText }, content, ATLAS_DEFAULT_BUSINESS_PROFILE.geography.primary),
    status: "draft",
  });
}
