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
//
// TKGM Linked-PDF Evidence Extraction: raised from 1800 after a live
// measurement against the real DASK circular PDF proved 1800 truncates
// BEFORE its single most important sentence (the actual effective date
// and procedural requirement, at raw character index ~3735 of 5189).
// Stripping repeated per-page header/footer boilerplate first (tested)
// only recovered ~500 characters and did not move that sentence's
// position — the length is genuine substantive letter body (citations +
// quoted regulation text + operative conclusion), not padding. The full
// substantive body of that real letter ends at index 4588, right before
// the purely administrative distribution list/footer — 4800 covers a
// real, representative case with a small margin, without arbitrarily
// blowing up token cost.
export const EVIDENCE_TEXT_MAX_CHARS = 4800;

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

// ============================================================
// Context-Safe Evidence Blocks: a proven, live-observed defect — a
// single source document can contain multiple TRUE provisions
// describing genuinely DIFFERENT scenarios/conditions (e.g. one branch
// for a sale/transfer, a separate branch introduced by "bunlar
// dışındaki hâllerde ise..." for every other case) — and once flattened
// into one undifferentiated evidence string, a real number/deadline
// from the WRONG branch can end up applied to the current topic. This
// is NOT about relevance/selection (deliberately not named that way —
// see below) and NEVER declares a block irrelevant, false, or
// discardable; it only marks where the source itself starts describing
// a distinct condition/exception/scenario, so the model can see the
// boundary the source already draws instead of having to infer it from
// dense, topically-overlapping prose alone. Deliberately domain-generic
// — no TKGM/DASK/real-estate vocabulary — so it applies to any Turkish
// legal/regulatory evidence text, from any current or future source.
// ============================================================

// A short, conservative list of GENERIC Turkish legal/regulatory
// scenario-branch connectives. Prefer false negatives (missing a real
// branch) over false positives (splitting ordinary prose) — this is why
// the list stays short and literal rather than a broader heuristic.
const SCENARIO_BRANCH_CONNECTIVES = [
  "bunlar dışındaki hâllerde",
  "bunlar dışındaki hallerde",
  "diğer hâllerde",
  "diğer hallerde",
  "bu durumun dışında",
  "aksi hâlde",
  "aksi halde",
  "aksi takdirde",
];

// Neutral by design: marks a scenario/condition boundary only — never a
// relevance, truth, or discard judgment. See the block comment above.
export const SCENARIO_BOUNDARY_MARKER = "[AYRI KOŞUL / SENARYO BLOĞU]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Inserts the neutral boundary marker immediately before each detected
// connective — the connective and all surrounding source text are left
// completely unmodified; this only ADDS a short structural cue, it never
// removes, rewrites, or summarizes anything. Ordinary prose with none of
// these connectives is returned byte-for-byte unchanged.
export function markScenarioBoundaries(text: string): string {
  let result = text;
  for (const phrase of SCENARIO_BRANCH_CONNECTIVES) {
    const pattern = new RegExp(escapeRegExp(phrase), "gi");
    result = result.replace(pattern, (match) => `${SCENARIO_BOUNDARY_MARKER} ${match}`);
  }
  return result;
}

// ============================================================
// TKGM Linked-PDF Evidence Extraction: the one small, server-side-only
// helper for text-based PDF bytes. `unpdf` was chosen (verified live
// against a real TKGM circular: correct Turkish diacritics, coherent
// text, zero native binaries — see the investigation this follows) —
// deliberately narrow scope: no DOCX, no images, no OCR. A provider
// still does its own fetch/link-discovery/validation; this only turns
// already-fetched PDF bytes into cleaned, capped text (or undefined).
// ============================================================

// Reasonable safety margin for a text-only government circular/
// announcement PDF — generous relative to the real DASK PDF (140,895
// bytes) without allowing an unbounded download.
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

// Extracts and cleans text from already-fetched PDF bytes. Returns
// undefined — never a partial/garbled fallback, never the title — on
// any parsing failure or if the result isn't long enough to be
// meaningful; the caller's existing safe-fallback path (evidenceText
// left absent, classifyEvidenceSufficiency then sees "none"/"thin" from
// whatever weaker evidence it already had) is unchanged either way.
export async function extractPdfTextOrUndefined(
  pdfBytes: Uint8Array,
  minChars: number = MIN_MEANINGFUL_EVIDENCE_CHARS,
): Promise<string | undefined> {
  try {
    // Lazy import: this module is loaded by every provider, but the PDF
    // library is only ever needed by the (currently one) provider that
    // fetches PDFs — no reason to pay that cost on every request.
    const { getDocumentProxy, extractText } = await import("unpdf");
    const pdf = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const normalized = text.replace(/\s+/g, " ").trim();
    // Context-Safe Evidence Blocks: mark scenario boundaries BEFORE
    // capping, so the cap can never silently cut a marker away from the
    // branch it introduces.
    const withBoundaries = markScenarioBoundaries(normalized);
    const cleaned = capEvidenceText(withBoundaries);
    return cleaned.length >= minChars ? cleaned : undefined;
  } catch {
    return undefined;
  }
}
