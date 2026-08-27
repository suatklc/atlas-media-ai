import type { ContentIntent, OutputMode } from "../content/types";
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
// intent is optional and used to gate the EDUCATIONAL_POINTS instruction
// below (Package 5C); outputMode is optional and used to additionally gate
// EDUCATIONAL_POINTS (Real Multi-Slide Carousel — any carousel needs
// per-slide "considerations" content, not just educational-intent content)
// and to request the new CAROUSEL_STRUCTURE marker. Every other line's
// behavior is unaffected by either.
export function buildCreativeDirective(
  brief: CreativeBrief | undefined,
  intent?: ContentIntent,
  outputMode?: OutputMode,
): string {
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
  // the truncation floor below. Other intents/output modes retain the
  // headline-only contract used by their existing renderers — UNLESS the
  // resolved output is a carousel, which needs per-slide point content
  // (the visual renderer's "considerations" slide) regardless of intent.
  const needsPoints = intent === "educational" || outputMode === "carousel";
  if (needsPoints) {
    lines.push(
      `Etiketler'den sonra bu sırayla iki ayrı meta satırını da zorunlu üret:\n[[VISUAL_HEADLINE: 4-10 kelime]]\n[[EDUCATIONAL_POINTS: nokta1 | nokta2 | nokta3 | nokta4 | nokta5]]\nMeta içinde tırnak/markdown/giriş yok; noktalar içerikten en fazla 5 kısa değer; hashtag/CTA/numara yok; nokta içinde "|" yok.`,
    );
  } else {
    lines.push(
      `Etiketler'den sonra meta satırı: [[VISUAL_HEADLINE: 4-10 kelime]]; tırnak/markdown/giriş ifadesi yok.`,
    );
  }

  // Real Multi-Slide Carousel: a third, separate meta line carrying the
  // 3-part slide narrative (what happened / why it matters / closing line)
  // that EDUCATIONAL_POINTS alone can't express — those are 1-5 short
  // takeaways for one "considerations" slide, not the cover/body/closing
  // structure the carousel renderer needs. Requested only when the
  // resolved output is actually a carousel; never affects the single-image
  // path for any intent.
  if (outputMode === "carousel") {
    lines.push(
      `Ayrıca bu üçüncü meta satırını da zorunlu üret:\n[[CAROUSEL_STRUCTURE: ne oldu | neden önemli | kapanış cümlesi]]\nÜç kısa değer tek satırda "|" ile ayrılmış olsun; "ne oldu" yalnızca kaynağa dayalı somut gelişmeyi 1-2 cümlede özetlesin; "neden önemli" alıcı/yatırımcı açısından pratik ilgiyi 1-2 cümlede açıklasın; "kapanış cümlesi" kısa ve iddiasız bir kapanış/özet cümlesi olsun; hiçbiri kesin hukuki tavsiye niteliğinde iddia içermesin; tırnak/markdown yok, değer içinde "|" yok.`,
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
    if (needsPoints) {
      // Defensive compact fallback for a future oversized brief: keep the
      // header plus every required line (Yapı sınırı, the marker line, and
      // the CAROUSEL_STRUCTURE line when present) intact rather than
      // slicing any marker syntax mid-string. lines[3..requiredLineCount-1]
      // is exactly that required range regardless of which marker set was
      // requested above.
      directive = [lines[0], ...lines.slice(3, requiredLineCount)].join("\n");
    } else {
      directive = directive.slice(0, MAX_DIRECTIVE_CHARS);
    }
  }

  return directive;
}
