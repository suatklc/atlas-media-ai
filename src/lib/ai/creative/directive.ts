import type { ContentIntent } from "../content/types";
import type { CreativeBrief } from "./types";

const MAX_DIRECTIVE_CHARS = 1250;

// Pure string assembly only — no matching/derivation logic (that's brief.ts),
// no history access, never mutates its input. Returns "" when there is no
// brief (Content Planning was itself a no-op).
//
// Scope is per-line, not block-wide: the "Görsel" line carries its own tag
// claiming ownership of Sprint 8's existing "Görsel Spesifikasyonu" section
// name (so the model fills that section instead of inventing a second,
// separate visual one). "Ana başlık" deliberately sits outside that scope —
// it targets the post's own headline/opening line, not the image overlay
// text described inside Görsel Spesifikasyonu. Keeping the scope claim on
// the specific line it governs (rather than one blanket claim in the shared
// header) is what lets "Ana başlık" avoid being read as another visual-spec
// instruction.
// intent is optional and used only to gate the EDUCATIONAL_POINTS
// instruction below (Package 5C) — every other line's behavior is
// unaffected by it.
export function buildCreativeDirective(brief: CreativeBrief | undefined, intent?: ContentIntent): string {
  if (!brief) {
    return "";
  }

  const { direction: d, execution: e } = brief;

  const lines: string[] = [
    "[Dahili brief — bu istek için, yanıtta tekrar etme]",
    `Yön: odak=${d.attentionFocus}; ana mesaj=${d.primaryMessage}; ikincil=${d.secondaryMessage}; anlatı=${d.narrativeAngle}; ton=${d.emotionalTone}; öncelik=${d.visualPriority}; akış=${d.eyeFlow}`,
    `Görsel [yalnızca bu bölüm; ayrı bölüm açma]: ${e.aspectRatio} ${e.dimensionsPx}; kompozisyon=${e.composition}; konu=${e.imagerySubject}; işleme=${e.imageryTreatment}; kamera=${e.cameraDirection}; ışık=${e.lightingDirection}; renk=${e.colorDirection}; tipografi=${e.typographyHierarchy}; metin=${e.textPlacement}; logo=${e.logoPlacement}; CTA=${e.ctaVisualTreatment}`,
  ];

  lines.push(`Yapı sınırı: ${e.structureConstraint}`);

  // Educational metadata is one indivisible contract: both required marker
  // instructions live in the same array item and are protected together by
  // the truncation floor below. Other intents retain the headline-only
  // contract used by their existing renderers.
  if (intent === "educational") {
    lines.push(
      `Etiketler'den sonra bu sırayla iki ayrı meta satırını da zorunlu üret:\n[[VISUAL_HEADLINE: 4-10 kelime]]\n[[EDUCATIONAL_POINTS: nokta1 | nokta2 | nokta3 | nokta4 | nokta5]]\nMeta içinde tırnak/markdown/giriş yok; noktalar içerikten en fazla 5 kısa değer; hashtag/CTA/numara yok; nokta içinde "|" yok.`,
    );
  } else {
    lines.push(
      `Etiketler'den sonra meta satırı: [[VISUAL_HEADLINE: 4-10 kelime]]; tırnak/markdown/giriş ifadesi yok.`,
    );
  }

  const requiredLineCount = lines.length;

  if (e.headlineHookNote) {
    lines.push(`Ana başlık [görsel dışı]: ${e.headlineHookNote}`);
  }

  if (e.consistencyNote) {
    lines.push(`Tutarlılık: ${e.consistencyNote}`);
  }

  // Safe truncation: drop whole trailing lines rather than slicing
  // mid-string (same fix already applied in content/directive.ts after a
  // mid-word truncation bug was found there).
  let directive = lines.join("\n");
  while (directive.length > MAX_DIRECTIVE_CHARS && lines.length > requiredLineCount) {
    lines.pop();
    directive = lines.join("\n");
  }
  if (directive.length > MAX_DIRECTIVE_CHARS) {
    if (intent === "educational") {
      // Defensive compact fallback for a future oversized brief: preserve
      // the required pair intact rather than slicing either marker syntax.
      directive = [lines[0], `Yapı sınırı: ${e.structureConstraint}`, lines[requiredLineCount - 1]].join("\n");
    } else {
      directive = directive.slice(0, MAX_DIRECTIVE_CHARS);
    }
  }

  return directive;
}
