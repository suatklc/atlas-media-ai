// Shared "uncertain publish" rule for every publish path (dashboard and
// Telegram alike). Each platform's result lives in
// generated_posts.metadata.publishResults.<platform>; a "publishing" marker
// is written right BEFORE the Meta call and replaced by "published" or
// "failed" right after it. A marker that never got replaced means the call
// may have reached Meta but its outcome was never recorded (the function
// died, or saving the result failed). Such a platform is never sent again
// automatically — a person has to check Meta first.

export const PUBLISHING_MARKER_TTL_MS = 5 * 60 * 1000;

export type PublishMarker = { state: "publishing" | "published" | "failed" | "uncertain"; at?: string };

export function readPublishMarker(metadata: unknown, platform: "instagram" | "facebook"): PublishMarker | null {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const results = meta.publishResults as Record<string, unknown> | undefined;
  const marker = results?.[platform] as PublishMarker | undefined;
  return marker && typeof marker === "object" && typeof marker.state === "string" ? marker : null;
}

// Why a new publish to this platform must not start, or null when it may.
// "published" is handled by each publisher's own already-published rule.
export function publishBlockReason(marker: PublishMarker | null, now: number, label: string): string | null {
  if (!marker) return null;
  const uncertain = `${label} yayın durumu belirsiz: gönderi Meta'ya ulaşmış olabilir ama sonucu kaydedilemedi. Lütfen önce ${label}'da kontrol edin; Atlas bu gönderiyi tekrar göndermez.`;
  if (marker.state === "uncertain") return uncertain;
  if (marker.state === "publishing") {
    const age = marker.at ? now - Date.parse(marker.at) : Number.POSITIVE_INFINITY;
    return age < PUBLISHING_MARKER_TTL_MS ? `${label} paylaşımı zaten sürüyor. Lütfen birkaç dakika sonra tekrar kontrol edin.` : uncertain;
  }
  return null;
}
