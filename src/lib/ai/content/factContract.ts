// Verified Fact Contract — the small intermediate layer between raw
// MEANINGFUL evidence and ContentPackage generation. A proven, live-
// observed defect (context leakage: a true fact from one conditional
// branch of a source document ending up applied to a different
// scenario) recurred across three separate deterministic/prompt-only
// attempts to fix it. The actual fix moves the decision out of the
// editorial call entirely: a separate, narrow, non-editorial AI call
// (Job 1) classifies every factual claim in the evidence as
// current-topic / different-scenario / unsupported, and CODE — never
// the editorial model — deterministically keeps only current-topic
// facts before the ContentPackage call ever runs. Deliberately as
// small as contentPackage.ts's own contract: one flat type, one JSON
// schema, one structural guard — not a generic framework, no
// confidence score, no source IDs, no embeddings, no citation system.

export type EvidenceFactStatus = "current-topic" | "different-scenario" | "unsupported";

export type EvidenceFact = {
  claim: string;
  evidenceFragment: string;
  status: EvidenceFactStatus;
};

const VALID_STATUSES = new Set<EvidenceFactStatus>(["current-topic", "different-scenario", "unsupported"]);

export function isEvidenceFact(value: unknown): value is EvidenceFact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.claim === "string" &&
    typeof v.evidenceFragment === "string" &&
    typeof v.status === "string" &&
    VALID_STATUSES.has(v.status as EvidenceFactStatus)
  );
}

export function isEvidenceFactArray(value: unknown): value is EvidenceFact[] {
  return Array.isArray(value) && value.every(isEvidenceFact);
}

// The core safety property: never rely on the editorial call to
// self-censor a fact it was already shown — code alone decides what
// reaches it, by simply never including anything else in the first
// place.
export function filterCurrentTopicFacts(facts: EvidenceFact[]): EvidenceFact[] {
  return facts.filter((fact) => fact.status === "current-topic");
}

const EVIDENCE_FACT_SCHEMA = {
  type: "object" as const,
  properties: {
    claim: { type: "string" },
    evidenceFragment: { type: "string" },
    status: { type: "string", enum: ["current-topic", "different-scenario", "unsupported"] },
  },
  required: ["claim", "evidenceFragment", "status"],
  additionalProperties: false,
};

export const FACT_CONTRACT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    facts: { type: "array" as const, items: EVIDENCE_FACT_SCHEMA },
  },
  required: ["facts"],
  additionalProperties: false,
};
