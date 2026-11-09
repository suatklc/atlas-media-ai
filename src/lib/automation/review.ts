// A draft Suat rejected: metadata.review = { state: "rejected" } (no schema
// change — status stays "draft"). Hidden from the history list and never
// approvable; still counted as "recently used" by the weekly plan.
export function isRejectedDraft(metadata: unknown): boolean {
  const review = (metadata as { review?: { state?: unknown } } | null | undefined)?.review;
  return review?.state === "rejected";
}

// A compose-test draft (dailyContent.ts COMPOSE_TEST_PACKAGE): its caption
// and topic carry this mark. Never offered for review/publishing in Telegram.
export const TEST_DRAFT_MARK = "TEST — YAYINLAMAYIN";

export function isTestDraft(content: unknown, metadata: unknown): boolean {
  const topic = (metadata as { contentPackage?: { topic?: unknown } } | null | undefined)?.contentPackage?.topic;
  return (
    (typeof content === "string" && content.includes(TEST_DRAFT_MARK)) ||
    (typeof topic === "string" && topic.includes(TEST_DRAFT_MARK))
  );
}
