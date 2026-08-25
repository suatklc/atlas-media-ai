import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Centralized bucket name for generated social visuals. This code expects
// the bucket to already exist — it does not create it. One-time manual
// provisioning (Supabase Dashboard > Storage): create a bucket named
// "generated-visuals", mark it public (or otherwise servable via
// getPublicUrl), and allow INSERT for the "authenticated" role so the
// signed-in user's own session can upload.
export const GENERATED_VISUALS_BUCKET = "generated-visuals";

export type UploadedImage = {
  url: string;
  path: string;
};

// Takes the caller's own authenticated Supabase client (the same
// request-scoped session used elsewhere in the app, e.g. src/lib/supabase/
// server.ts) — deliberately no service-role key. Requires the bucket above
// to permit authenticated uploads and public reads; if that policy isn't in
// place yet, the upload call fails with a clear Supabase error rather than
// silently succeeding.
export async function uploadGeneratedImage(
  supabase: SupabaseClient,
  userId: string,
  bytes: Buffer,
  contentType: string,
): Promise<UploadedImage> {
  const extension = contentType === "image/png" ? "png" : "bin";
  const path = `${userId}/${Date.now()}-${randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(GENERATED_VISUALS_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(GENERATED_VISUALS_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}
