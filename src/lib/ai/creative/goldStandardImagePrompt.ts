import { SAFETY_CLAUSE, PHOTOGRAPHY_QUALITY_CLAUSE, GEOGRAPHIC_CONTEXT_CLAUSE, NEGATIVE_SPACE_CLAUSE } from "./image-prompt";

// Gold Standard V1 — a small, purpose-built composer for the Current
// Content Radar structured-package path, NOT a rewrite of image-prompt.ts's
// existing buildImagePrompt (which stays exactly as-is for the general
// chat path). visualBrief is already a clean, model-authored visual
// CONCEPT (never raw user prose, never rendered text) — this only adds
// the same safety/quality/format guarantees every other image prompt in
// this pipeline already gets, reusing those exact clauses rather than
// duplicating their text.
//
// Explicit Türkiye/İstanbul context clause (Gold Standard visual-quality
// bar): the observed defect this fixes is generic American-suburban-house
// imagery appearing for a Turkish real-estate context — a plain "villa"
// prompt with no country context lets the image model default to
// whatever "house" imagery is statistically dominant in its training
// data, which is not Turkish residential architecture.
const TURKISH_CONTEXT_CLAUSE =
  "Görsel Türkiye/İstanbul bağlamında, Türk şehir/konut mimarisine uygun olsun (örn. tipik Amerikan banliyö evi/beyaz çit gibi Türkiye dışı bir estetik OLMASIN); modern Türk gayrimenkul/mimari dilini yansıtsın.";

export function buildGoldStandardImagePrompt(visualBrief: string): string {
  const clauses = [
    visualBrief.trim(),
    TURKISH_CONTEXT_CLAUSE,
    PHOTOGRAPHY_QUALITY_CLAUSE,
    GEOGRAPHIC_CONTEXT_CLAUSE,
    NEGATIVE_SPACE_CLAUSE,
    "format: 4:5 (1080x1350), Instagram gönderisi için",
  ];
  return `${clauses.join("; ")}. ${SAFETY_CLAUSE}`;
}
