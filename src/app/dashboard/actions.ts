"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runFacebookMultiPhotoCheck } from "@/lib/publishing/facebookCapability";
import { selectFacebookPage } from "@/lib/publishing/connections/query";
import {
  parseSelectedPlatforms,
  publishToSelectedPlatforms,
  type PlatformOutcome,
} from "@/lib/publishing/publishSelectedPlatforms";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type StatusActionState = { error: string | null };

// "posted" is deliberately NOT settable here — it is reachable only through
// publishSelectedPlatformsAction below (Instagram ticked), which sets it
// exclusively after a real Meta publish succeeds. Directly flipping status to "posted" (as this action
// used to allow) would let a post appear published in the UI without ever
// having actually been sent to Instagram.
type AllowedStatus = "approved";

function isAllowedStatus(value: unknown): value is AllowedStatus {
  return value === "approved";
}

// Called via Server Action form binding: updatePostStatus.bind(null, postId,
// nextStatus) — postId/nextStatus come only from this app's own two button
// call sites in StatusAction.tsx, never from client-supplied form fields.
// user_id is never accepted as an argument at all — the authenticated
// user's own id (from the session, not the client) is the only identity
// ever used, both in the explicit .eq() below and via RLS's own USING
// clause, which independently enforces the same ownership boundary.
export async function updatePostStatus(
  postId: string,
  nextStatus: AllowedStatus,
  _prevState: StatusActionState,
  _formData: FormData,
): Promise<StatusActionState> {
  if (!isAllowedStatus(nextStatus)) {
    return { error: "Geçersiz durum." };
  }

  if (typeof postId !== "string" || !postId) {
    return { error: "Geçersiz gönderi." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Bu işlem için giriş yapmanız gerekiyor." };
  }

  const { data, error } = await supabase
    .from("generated_posts")
    .update({ status: nextStatus })
    .eq("id", postId)
    .eq("user_id", user.id)
    .select("id");

  if (error) {
    console.error("Post status update error:", error);
    return { error: "Durum güncellenemedi. Lütfen tekrar deneyin." };
  }

  if (!data || data.length === 0) {
    // No row matched id + owner — either it doesn't exist or isn't this
    // user's post (RLS would have filtered it either way). Same generic,
    // safe message for both cases; nothing about the generated post/image
    // itself is touched or affected by this failing.
    return { error: "Gönderi bulunamadı." };
  }

  revalidatePath("/dashboard");
  return { error: null };
}

// ===== Facebook Page (Facebook Login for Business) =====
// Thin wrappers: session user id only (never client-supplied), every
// decision inside the lib functions. Approving a post never publishes it.

async function sessionUserId(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; userId: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

export async function runFacebookCheckAction(_prevState: StatusActionState, _formData: FormData): Promise<StatusActionState> {
  const { supabase, userId } = await sessionUserId();
  if (!userId) return { error: "Bu işlem için giriş yapmanız gerekiyor." };
  const result = await runFacebookMultiPhotoCheck(supabase, userId);
  revalidatePath("/dashboard");
  return { error: result.ok ? null : result.error ?? "Test başarısız oldu." };
}

export async function selectFacebookPageAction(accountId: string, _prevState: StatusActionState, _formData: FormData): Promise<StatusActionState> {
  if (typeof accountId !== "string" || !accountId) return { error: "Geçersiz sayfa." };
  const { supabase, userId } = await sessionUserId();
  if (!userId) return { error: "Bu işlem için giriş yapmanız gerekiyor." };
  const ok = await selectFacebookPage(supabase, userId, accountId);
  revalidatePath("/dashboard");
  return { error: ok ? null : "Sayfa seçilemedi. Lütfen tekrar deneyin." };
}

export type PublishPanelState = { error: string | null; results: PlatformOutcome[] };

// "Seçili Platformlarda Yayınla": publishes ONLY the platforms ticked in
// the form (no defaults, no connected-account inference). Validation,
// approval gate and per-platform independence live in
// publishToSelectedPlatforms.
export async function publishSelectedPlatformsAction(postId: string, _prevState: PublishPanelState, formData: FormData): Promise<PublishPanelState> {
  if (typeof postId !== "string" || !postId) return { error: "Geçersiz gönderi.", results: [] };
  const platforms = parseSelectedPlatforms(formData.getAll("platform"));
  if (!platforms) return { error: "En az bir geçerli platform seçin.", results: [] };
  const { supabase, userId } = await sessionUserId();
  if (!userId) return { error: "Bu işlem için giriş yapmanız gerekiyor.", results: [] };
  const result = await publishToSelectedPlatforms(supabase, userId, postId, platforms);
  revalidatePath("/dashboard");
  return result;
}
