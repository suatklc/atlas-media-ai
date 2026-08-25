"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publishGeneratedPost } from "@/lib/publishing/publishGeneratedPost";

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type StatusActionState = { error: string | null };

// "posted" is deliberately NOT settable here — it is reachable only through
// publishApprovedPost below, which sets it exclusively after a real Meta
// publish succeeds. Directly flipping status to "posted" (as this action
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

// Called via Server Action form binding: publishApprovedPost.bind(null,
// postId) — same pattern as updatePostStatus above. Thin wrapper only: auth
// extraction and revalidatePath live here; every eligibility/credential/
// publish decision is made by publishGeneratedPost (a plain, Supabase-
// client-driven function, testable without any Next.js Server Action
// machinery). The authenticated user's own id — never a client-supplied
// value — is the only identity passed through.
export async function publishApprovedPost(
  postId: string,
  _prevState: StatusActionState,
  _formData: FormData,
): Promise<StatusActionState> {
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

  const result = await publishGeneratedPost(supabase, user.id, postId);
  if (!result.success) {
    return { error: result.error };
  }

  revalidatePath("/dashboard");
  return { error: null };
}
