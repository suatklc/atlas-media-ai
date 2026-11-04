// A draft Suat rejected: metadata.review = { state: "rejected" } (no schema
// change — status stays "draft"). Hidden from the history list and never
// approvable; still counted as "recently used" by the weekly plan.
export function isRejectedDraft(metadata: unknown): boolean {
  const review = (metadata as { review?: { state?: unknown } } | null | undefined)?.review;
  return review?.state === "rejected";
}
