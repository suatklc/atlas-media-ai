export type CreativeDirection = {
  attentionFocus: string;
  primaryMessage: string;
  secondaryMessage: string;
  narrativeAngle: string;
  emotionalTone: string;
  visualPriority: string;
  eyeFlow: string;
};

export type VisualExecution = {
  aspectRatio: string;
  dimensionsPx: string;
  composition: string;
  imagerySubject: string;
  imageryTreatment: string;
  cameraDirection: string;
  lightingDirection: string;
  colorDirection: string;
  typographyHierarchy: string;
  textPlacement: string;
  logoPlacement: string;
  ctaVisualTreatment: string;
  structureConstraint: string;
  headlineHookNote?: string;
  consistencyNote?: string;
};

export type CreativeBrief = {
  direction: CreativeDirection;
  execution: VisualExecution;
};
