export type ConfidenceLevel = "high" | "medium" | "low";

export type SufficiencyLevel = "sufficient" | "partial" | "insufficient" | "impossible";

export type CalculationReadiness = "ready" | "partial" | "not-applicable";

export type RiskFlag =
  | "parcel-specific"
  | "legal-uncertainty"
  | "investment-judgment"
  | "missing-critical-anchor";

// Closed, deterministic set — do not add free-form condition strings.
export type ClarificationCondition = "missing-all-required-on-calculation-request";

export type TopicReasoningMetadata = {
  supportedRequestTypes: ("conceptual" | "calculation")[];
  requiredAnchors: string[];
  optionalAnchors: string[];
  calculationCapability: "none" | "present";
  riskSignals: { flag: RiskFlag; patterns: string[] }[];
  clarificationConditions: ClarificationCondition[];
  confidenceModifiers?: { maxConfidence?: ConfidenceLevel };
};

export type TopicAssessment = {
  topicId: string;
  sufficiency: SufficiencyLevel;
  calculationReadiness: CalculationReadiness;
  riskFlags: RiskFlag[];
  confidence?: ConfidenceLevel; // omitted when sufficiency = "impossible"
  missingAnchors: string[];
};

export type RequestAssessment = {
  topicAssessments: TopicAssessment[];
  overallConfidence?: ConfidenceLevel; // omitted when shouldAsk = true
  overallRiskFlags: RiskFlag[]; // deduplicated
  missingAnchorsByTopic: Record<string, string[]>;
  shouldAsk: boolean;
};
