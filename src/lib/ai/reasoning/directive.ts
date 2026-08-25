import type { ConfidenceLevel, RequestAssessment, RiskFlag } from "./types";

const MAX_DIRECTIVE_CHARS = 400;

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: "yüksek",
  medium: "orta",
  low: "düşük",
};

const RISK_LABELS: Record<RiskFlag, string> = {
  "parcel-specific": "parsel/mülk özelinde belirsizlik",
  "legal-uncertainty": "hukuki belirsizlik",
  "investment-judgment": "öznel yatırım yargısı",
  "missing-critical-anchor": "eksik kritik veri",
};

// Pure string assembly only — no matching/scoring logic, no history access,
// never mutates its input. Returns "" when nothing matched.
export function buildReasoningDirective(assessment: RequestAssessment): string {
  if (assessment.topicAssessments.length === 0) {
    return "";
  }

  const lines: string[] = ["[Dahili yönlendirme — yalnızca bu istek için, yanıtta tekrar etme]"];

  if (assessment.overallConfidence) {
    lines.push(`Güven: ${CONFIDENCE_LABELS[assessment.overallConfidence]}`);
  }

  if (assessment.overallRiskFlags.length > 0) {
    lines.push(`Riskler: ${assessment.overallRiskFlags.map((flag) => RISK_LABELS[flag]).join(", ")}`);
  }

  for (const [topicId, anchors] of Object.entries(assessment.missingAnchorsByTopic)) {
    if (anchors.length > 0) {
      lines.push(`Eksik bilgi — ${topicId}: ${anchors.join(", ")}`);
    }
  }

  let directive = lines.join("\n");
  if (directive.length > MAX_DIRECTIVE_CHARS) {
    directive = directive.slice(0, MAX_DIRECTIVE_CHARS);
  }

  return directive;
}
