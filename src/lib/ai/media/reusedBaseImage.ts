import { AsyncLocalStorage } from "node:async_hooks";
import type { GeneratedImage } from "./types";

// Automation compose test (cron route, test mode only): inside
// withReusedBaseImage, media/router's generateImage returns an image Atlas
// already stored instead of calling a paid provider, so the real
// composition + upload + draft path can be verified without a new
// generation. Only this project's own public generated-visuals Storage
// PNG URLs are accepted.
const reusedBaseImage = new AsyncLocalStorage<string>();

export function withReusedBaseImage<T>(url: string, fn: () => Promise<T>): Promise<T> {
  return reusedBaseImage.run(url, fn);
}

export function currentReusedBaseImageUrl(): string | undefined {
  return reusedBaseImage.getStore();
}

export function isOwnGeneratedVisualUrl(url: string): boolean {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return Boolean(supabaseUrl) && url.startsWith(`${supabaseUrl}/storage/v1/object/public/generated-visuals/`) && url.endsWith(".png");
}

export async function fetchReusedBaseImage(url: string): Promise<GeneratedImage> {
  if (!isOwnGeneratedVisualUrl(url)) throw new Error("Reused base image must be an Atlas generated-visuals PNG.");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Reused base image fetch failed (${response.status}).`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: "image/png" };
}
