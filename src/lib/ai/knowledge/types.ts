import type { TopicReasoningMetadata } from "../reasoning/types";

export type KnowledgeTopic = "development-potential" | "title-deed-types" | "valuation-basics";

export type KnowledgeProvenance = {
  basis: "genel-mevzuat-kavramı" | "genel-finansal-formül" | "genel-pratik-bilgi";
  reviewedBy?: string;
  notes: string;
};

export type KnowledgeEntry = {
  id: string;
  topic: KnowledgeTopic;
  title: string;
  keywords: string[];
  strongIntentPhrases: string[];
  supportingTerms: string[];
  exclusionSignals: string[];
  content: string;
  limitations: string[];
  lastReviewed: string;
  reviewIntervalDays?: number;
  provenance: KnowledgeProvenance;
  reasoning?: TopicReasoningMetadata;
};
