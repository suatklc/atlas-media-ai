import type { ContentPlan } from "../content/types";
import type { CreativeBrief } from "./types";
import { BY_AUDIENCE, BY_INTENT, BY_GOAL, BY_TEMPLATE_ID } from "./lookups";

function adaptGuidanceForOutputMode(value: string, outputMode: ContentPlan["outputMode"]): string {
  if (outputMode !== "single") {
    return value;
  }

  return value
    .replace(/slayt slayt, sol-sağ kaydırma sırasıyla/giu, "tek görsel içinde üstten alta")
    .replace(/her slaytta/giu, "tek görselde")
    .replace(/tüm slaytlarda/giu, "tek görselde");
}

// Pure function. Consumes the already-resolved ContentPlan only — never
// recomputes intent/goal/audience/format/template, never inspects the raw
// message or conversation history. Strict no-op when Content Planning
// itself produced no plan (intent "none" or no template).
//
// Field precedence (documented, non-contradictory — one primary owner per
// field, occasionally composed with a second input):
//   attentionFocus, visualPriority, ctaVisualTreatment(base) <- Goal
//   primaryMessage, secondaryMessage, imagerySubject(base),
//   cameraDirection, lightingDirection                       <- Intent
//   narrativeAngle, emotionalTone, colorDirection,
//   imagerySubject(hint), imageryTreatment(mood)              <- Audience
//   eyeFlow, aspectRatio, dimensionsPx, composition(base),
//   typographyHierarchy, textPlacement, logoPlacement,
//   consistencyNote, ctaVisualTreatment(position),
//   structureConstraint, headlineHookNote                     <- Template
export function buildCreativeBrief(plan: ContentPlan): CreativeBrief | undefined {
  if (plan.intent === "none" || !plan.template) {
    return undefined;
  }

  const intent = plan.intent;
  const goal = plan.goal ?? "education";
  const audience = plan.audience;
  const template = plan.template;

  const audienceData = BY_AUDIENCE[audience];
  const intentData = BY_INTENT[intent];
  const goalData = BY_GOAL[goal];
  const templateData = BY_TEMPLATE_ID[template.id];

  // Defensive fallback only — every current catalog ID has an entry, so
  // this path should not trigger for any of the five known templates.
  const eyeFlow = adaptGuidanceForOutputMode(
    templateData?.eyeFlow ?? `${template.layoutType} düzeninde doğal akış`,
    plan.outputMode,
  );
  const aspectRatio = templateData?.aspectRatio ?? "1:1";
  const dimensionsPx = templateData?.dimensionsPx ?? "1080x1080";
  const compositionBase = adaptGuidanceForOutputMode(
    templateData?.composition ?? template.layoutType,
    plan.outputMode,
  );
  const typographyHierarchy = adaptGuidanceForOutputMode(
    templateData?.typographyHierarchy ?? "başlık ve gövde metni net ayrım",
    plan.outputMode,
  );
  const textPlacement = adaptGuidanceForOutputMode(
    templateData?.textPlacement ?? "içerikle uyumlu",
    plan.outputMode,
  );
  const logoPlacement = adaptGuidanceForOutputMode(
    templateData?.logoPlacement ?? "alt köşe, sabit",
    plan.outputMode,
  );

  const direction: CreativeBrief["direction"] = {
    attentionFocus: goalData.attentionFocus,
    primaryMessage: intentData.primaryMessage,
    secondaryMessage: intentData.secondaryMessage,
    narrativeAngle: audienceData.narrativeAngle,
    emotionalTone: audienceData.emotionalTone,
    visualPriority: goalData.visualPriority,
    eyeFlow,
  };

  const isSingleImage = plan.outputMode === "single";
  const structureConstraint = isSingleImage
    ? "tek görsel üret; ek slayt/bölüm ekleme"
    : `tam olarak ${plan.slideCount} bölüm/slayt kullan; fazla veya eksik ekleme`;

  const execution: CreativeBrief["execution"] = {
    aspectRatio,
    dimensionsPx,
    composition: `${compositionBase}; ${direction.visualPriority} öne çıkarılmalı`,
    imagerySubject: `${intentData.imagerySubject}; ${audienceData.imagerySubjectHint}`,
    imageryTreatment: `${audienceData.imageryMoodHint}, ${template.visualEmphasis}`,
    cameraDirection: intentData.cameraDirection,
    lightingDirection: intentData.lightingDirection,
    colorDirection: audienceData.colorDirection,
    typographyHierarchy,
    textPlacement,
    logoPlacement,
    ctaVisualTreatment: `${goalData.ctaVisualTreatment}, konum: ${template.ctaPosition}`,
    structureConstraint,
    headlineHookNote: isSingleImage
      ? "konuyu tekrarlama; somut fayda veya merak açısıyla aç; klişe/abartı/clickbait yok"
      : undefined,
    consistencyNote:
      plan.outputMode === "carousel"
        ? "Tüm slaytlarda aynı renk paleti, tipografi hiyerarşisi ve logo konumu korunmalı"
        : undefined,
  };

  return { direction, execution };
}
