import type { ResearchSource } from "../types";

// Phase 2 (Current Content Engine — live research foundation): the raw
// retrieval-stage contract. Deliberately NOT a new source-description
// type — NormalizedResearchResult is ResearchSource (reused, not
// duplicated) plus exactly the two extra fields a raw retrieval result
// carries that a already-built ContentOpportunity's source reference does
// not need: a short factual snippet (retrieval-stage input, never final
// copy — see discover.ts) and retrievedAt (when THIS retrieval ran,
// distinct from publishedAt, which is when the source itself was
// published).
export type NormalizedResearchResult = ResearchSource & {
  snippet: string;
  // ISO timestamp of this retrieval run.
  retrievedAt: string;
};

// A raw text query is deliberately not the shape here: every existing
// "provider request" in this codebase (ImageGenerationRequest,
// PublishRequest) is a typed object, and BusinessProfile-derived queries
// are naturally a list of terms (expertise topics + geography), not one
// search string an adapter would need to re-split. Today's only live
// adapter (providers/tcmb.ts) has no free-text search of its own — these
// keywords filter/rank a fixed set of entries an adapter's own official
// source already publishes, not something sent over the network (see
// router.ts's own comment).
export type RetrievalQuery = {
  keywords: string[];
};

export type RetrievalOptions = {
  maxResults?: number;
};
