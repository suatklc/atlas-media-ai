import type { KnowledgeEntry } from "../knowledge/types";
import type { ConfidenceLevel, RiskFlag, TopicAssessment, RequestAssessment } from "./types";

// Shared, centrally-owned anchor detectors. Entry metadata references these
// by key (requiredAnchors/optionalAnchors are string[] of keys), keeping
// detection logic in one place instead of duplicated per topic.
const ANCHOR_DETECTORS: Record<string, { label: string; pattern: RegExp }> = {
  "parsel-alani": {
    label: "parsel alanı",
    pattern: /\d[\d.,]*\s*(m²|m2|metrekare)/i,
  },
  "taks-degeri": {
    label: "TAKS değeri",
    pattern: /taks.{0,15}\d/i,
  },
  "kaks-degeri": {
    label: "KAKS/emsal değeri",
    pattern: /(kaks|emsal).{0,15}\d/i,
  },
  fiyat: {
    label: "mülk fiyatı/değeri",
    pattern: /\d[\d.,]*\s*(bin|milyon|milyar)?\s*(tl|₺|lira)/i,
  },
  "kira-tutari-veya-emsal": {
    label: "kira tutarı veya karşılaştırma verisi",
    pattern:
      /(kira.{0,30}\d[\d.,]*\s*(bin|milyon|milyar)?\s*(tl|₺|lira))|(\d[\d.,]*\s*(bin|milyon|milyar)?\s*(tl|₺|lira).{0,30}kira)|(emsal|benzer (daire|ev|mülk|konut))/i,
  },
};

// Deliberately narrow: only an explicit imperative, not generic phrases like
// "ne kadar"/"kaç", which are common in purely conceptual questions too and
// would over-trigger calculation-mode detection.
const CALCULATION_CUE_PATTERN = /\bhesapla\b|kaç (daire|kat)\b|inşaat alanı ne kadar/i;

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
}

function confidenceMin(...levels: ConfidenceLevel[]): ConfidenceLevel {
  const order: Record<ConfidenceLevel, number> = { high: 2, medium: 1, low: 0 };
  let result: ConfidenceLevel = "high";
  for (const level of levels) {
    if (order[level] < order[result]) result = level;
  }
  return result;
}

// Pure function. Uses only the current message and one matched entry —
// never conversation history, never generates prose.
export function assessTopic(message: string, entry: KnowledgeEntry): TopicAssessment {
  const normalizedMessage = normalize(message);
  const metadata = entry.reasoning;

  if (!metadata) {
    return {
      topicId: entry.id,
      sufficiency: "sufficient",
      calculationReadiness: "not-applicable",
      riskFlags: [],
      confidence: "high",
      missingAnchors: [],
    };
  }

  const requiredKeys = metadata.requiredAnchors;
  const optionalKeys = metadata.optionalAnchors;

  const presentRequired = requiredKeys.filter((key) =>
    ANCHOR_DETECTORS[key]?.pattern.test(normalizedMessage),
  );
  const missingRequired = requiredKeys.filter((key) => !presentRequired.includes(key));

  const hasAnchorSignal = [...requiredKeys, ...optionalKeys].some((key) =>
    ANCHOR_DETECTORS[key]?.pattern.test(normalizedMessage),
  );
  const hasCalcCue = CALCULATION_CUE_PATTERN.test(normalizedMessage);
  const isCalculationRequest = metadata.calculationCapability === "present" && (hasAnchorSignal || hasCalcCue);

  let sufficiency: TopicAssessment["sufficiency"];
  let calculationReadiness: TopicAssessment["calculationReadiness"];

  if (metadata.calculationCapability === "none" || !isCalculationRequest) {
    sufficiency = "sufficient";
    calculationReadiness = "not-applicable";
  } else if (missingRequired.length === 0) {
    sufficiency = "sufficient";
    calculationReadiness = "ready";
  } else if (presentRequired.length > 0) {
    sufficiency = "partial";
    calculationReadiness = "partial";
  } else {
    const canEscalate = metadata.clarificationConditions.includes(
      "missing-all-required-on-calculation-request",
    );
    sufficiency = canEscalate ? "impossible" : "insufficient";
    calculationReadiness = "partial";
  }

  const riskFlags: RiskFlag[] = [];
  for (const signal of metadata.riskSignals) {
    if (signal.patterns.some((phrase) => normalizedMessage.includes(normalize(phrase)))) {
      if (!riskFlags.includes(signal.flag)) riskFlags.push(signal.flag);
    }
  }
  if (calculationReadiness === "partial" && sufficiency !== "impossible") {
    if (!riskFlags.includes("missing-critical-anchor")) riskFlags.push("missing-critical-anchor");
  }

  const missingAnchors = missingRequired.map((key) => ANCHOR_DETECTORS[key]?.label ?? key);

  if (sufficiency === "impossible") {
    return {
      topicId: entry.id,
      sufficiency,
      calculationReadiness,
      riskFlags,
      missingAnchors,
    };
  }

  const sufficiencyCandidate: ConfidenceLevel =
    sufficiency === "sufficient" ? "high" : sufficiency === "partial" ? "medium" : "low";
  const riskCandidate: ConfidenceLevel =
    riskFlags.length === 0 ? "high" : riskFlags.length === 1 ? "medium" : "low";
  const readinessCandidate: ConfidenceLevel = calculationReadiness === "partial" ? "low" : "high";

  let confidence = confidenceMin(sufficiencyCandidate, riskCandidate, readinessCandidate);
  if (metadata.confidenceModifiers?.maxConfidence) {
    confidence = confidenceMin(confidence, metadata.confidenceModifiers.maxConfidence);
  }

  return {
    topicId: entry.id,
    sufficiency,
    calculationReadiness,
    riskFlags,
    confidence,
    missingAnchors,
  };
}

// Pure function. Aggregates independent per-topic assessments — never lets
// one impossible topic suppress an otherwise-answerable one.
export function assessRequest(message: string, matchedEntries: KnowledgeEntry[]): RequestAssessment {
  if (matchedEntries.length === 0) {
    return {
      topicAssessments: [],
      overallRiskFlags: [],
      missingAnchorsByTopic: {},
      shouldAsk: false,
    };
  }

  const topicAssessments = matchedEntries.map((entry) => assessTopic(message, entry));

  const overallRiskFlags: RiskFlag[] = [];
  for (const assessment of topicAssessments) {
    for (const flag of assessment.riskFlags) {
      if (!overallRiskFlags.includes(flag)) overallRiskFlags.push(flag);
    }
  }

  const missingAnchorsByTopic: Record<string, string[]> = {};
  for (const assessment of topicAssessments) {
    if (assessment.missingAnchors.length > 0) {
      missingAnchorsByTopic[assessment.topicId] = assessment.missingAnchors;
    }
  }

  const shouldAsk = topicAssessments.every((assessment) => assessment.sufficiency === "impossible");

  if (shouldAsk) {
    return { topicAssessments, overallRiskFlags, missingAnchorsByTopic, shouldAsk: true };
  }

  const confidences = topicAssessments
    .map((assessment) => assessment.confidence)
    .filter((confidence): confidence is ConfidenceLevel => confidence !== undefined);
  const overallConfidence = confidences.length > 0 ? confidenceMin(...confidences) : "high";

  return {
    topicAssessments,
    overallConfidence,
    overallRiskFlags,
    missingAnchorsByTopic,
    shouldAsk: false,
  };
}
