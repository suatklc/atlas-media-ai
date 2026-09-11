// Source-Grounding Minimal Fix: deterministic, dependency-free evidence-
// text cleanup shared by any provider that captures real extracted source
// text (as opposed to a bare title) — see research/types.ts's
// ResearchSource.evidenceText. Deliberately NOT a generic scraper
// framework: each provider still does its own fetch/extraction; this only
// cleans + caps whatever raw HTML/text a provider hands it, and decides
// whether the result is meaningful enough to call "evidence" at all.

// Conservative deterministic cap: enough text to carry a specific date,
// figure, or procedural sentence or two without passing an entire page
// into the model. Applied here (capture time) and defensively again in
// content-package/route.ts's prompt assembly.
export const EVIDENCE_TEXT_MAX_CHARS = 1800;

// Below this length, "evidence" is almost always leftover boilerplate
// (a failed render, a cookie notice, a near-empty description tag) —
// treated the same as no evidence at all, never padded or accepted as-is.
const MIN_MEANINGFUL_EVIDENCE_CHARS = 40;

const NOISE_BLOCK_PATTERN = /<(script|style|nav|footer|header)[^>]*>[\s\S]*?<\/\1>/gi;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Strips script/style/nav/footer/header blocks, then every remaining tag,
// decodes entities, and collapses whitespace — a bounded, generic
// "reduce markup to plain text" pass, not a content-model-aware
// extractor. Safe on both a full HTML detail page and a feed's inline
// <description>/<summary> value (which may itself contain markup).
export function stripHtmlToText(rawHtmlOrText: string): string {
  const withoutNoiseBlocks = rawHtmlOrText.replace(NOISE_BLOCK_PATTERN, " ");
  const withoutTags = withoutNoiseBlocks.replace(/<[^>]+>/g, " ");
  return decodeBasicEntities(withoutTags).replace(/\s+/g, " ").trim();
}

export function capEvidenceText(text: string, maxChars: number = EVIDENCE_TEXT_MAX_CHARS): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars).trim();
}

// The one entry point providers should use. Returns undefined — never an
// empty string, never the input title — when the cleaned text isn't long
// enough to be meaningful evidence, so a provider's safe-failure path
// (evidenceText left absent) is just "don't assign the result" rather
// than needing its own separate emptiness check.
export function toEvidenceTextOrUndefined(
  rawHtmlOrText: string,
  minChars: number = MIN_MEANINGFUL_EVIDENCE_CHARS,
): string | undefined {
  const cleaned = capEvidenceText(stripHtmlToText(rawHtmlOrText));
  return cleaned.length >= minChars ? cleaned : undefined;
}

// ============================================================
// Evidence Safety Gate (Source-Grounding Minimal Fix, follow-up):
// evidence PRESENT is not the same as evidence SUFFICIENT. Live
// production verification proved a real TKGM detail page can pass
// toEvidenceTextOrUndefined's >=40-char bar while being ~80% site
// navigation/project-menu chrome plus a "click below to access the
// [linked] file" stub — i.e. non-empty, but carrying essentially no real
// rule/procedure text. Generation-time code (content-package/route.ts)
// must know this distinction; it is derived here, on demand, from the
// text itself — deliberately NOT a new persisted field on ResearchSource/
// ContentOpportunity, since it's a pure function of evidenceText.
// ============================================================

export type EvidenceSufficiency = "meaningful" | "thin" | "none";

// Conservative: real evidence this short is treated the SAME as thin/
// stub content (a real TKGM detail page can already clear 40 chars of
// pure menu text). False negatives (real evidence marked "thin") are the
// safe direction here — the model is instructed the same strict way for
// "thin" as for "none", so under-classifying real evidence never causes
// unsupported claims, only an occasional missed opportunity to cite
// something that was genuinely there.
const MEANINGFUL_EVIDENCE_MIN_CHARS = 150;

// The exact, live-observed defect signatures: a page whose only "content"
// is its own navigation/project list, or a sentence telling the reader to
// go fetch a linked file rather than stating anything itself. Any one of
// these appearing is a strong, specific signal that the text is a stub,
// regardless of length — deliberately narrow, literal phrases (not a
// generic word-frequency heuristic) so this can't misfire on genuine
// prose that happens to mention, say, a link.
const CHROME_OR_STUB_MARKERS =
  /dosyasına erişmek için|bağlantıya tıklayınız|tıklayınız|tümünü gör|geri dön|ana ?sayfa/i;

// Deterministic, dependency-free — no AI classifier. Callers pass the
// already-captured evidenceText (or undefined); this never fetches
// anything itself.
export function classifyEvidenceSufficiency(evidenceText: string | undefined): EvidenceSufficiency {
  if (!evidenceText) return "none";
  if (CHROME_OR_STUB_MARKERS.test(evidenceText)) return "thin";
  if (evidenceText.length < MEANINGFUL_EVIDENCE_MIN_CHARS) return "thin";
  return "meaningful";
}
