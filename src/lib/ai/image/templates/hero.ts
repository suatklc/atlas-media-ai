import type { CompositionInput } from "./types";
import { FONT_STACK, escapeXml, layoutAtSize, parseCanvasDimensions } from "./shared";
import { buildBrandMark, GOLD } from "./brand";
import { buildCoverImageMarkup, renderSvgToPng } from "../resvg-renderer";

const SAFE_PADDING_X = 64;
const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";

// Brand hierarchy (Handoff — brand placement + premium overlay): the mark
// now anchors the BOTTOM-RIGHT corner, never the top — the upper portion
// of the photo stays completely clean. Headline and CTA stack above it,
// left-aligned, on their own rows — never sharing a row with the brand —
// so no collision math is ever needed between them; a safe vertical gap
// alone guarantees separation regardless of headline length or brand
// wordmark width. This is the reusable safe-region geometry requirement:
// every offset below is a named gap/margin, not a one-off pixel hack, and
// every one of them is expressed relative to the canvas's own edges so a
// future non-4:5 canvas derives the same safe layout automatically.
const SAFE_PADDING_BOTTOM = 64;
// Micro-polish (Handoff): matches brand.ts's compact-right icon, which
// grew from 36 to 48 (~33%) for mobile legibility — kept as its own
// constant here (rather than imported) since this file's own bottom-up
// layout math needs the icon's reserved height, and brand.ts's internal
// sizing is otherwise an implementation detail this file shouldn't reach
// into.
const BRAND_ICON_SIZE = 48;
const BRAND_TO_CTA_GAP = 34;
// Widened from 40 for a touch more breathing room between headline and
// CTA (Handoff micro-polish) — brand's own gap (BRAND_TO_CTA_GAP) is
// unaffected, since the task asked specifically for headline/CTA spacing.
const CTA_TO_HEADLINE_GAP = 50;

// Minimum scrim coverage as a fraction of canvas height, not a fixed pixel
// value — a safety net for a shorter/taller canvas than the 1080x1350
// default (on this canvas, the content-based term below always wins in
// practice for a normal 1-3 line headline; this only binds if content
// ever needed less room than a sane visual minimum).
const SCRIM_MIN_COVERAGE_FRACTION = 0.48;

type HeroRenderInput = CompositionInput & {
  baseImage: Buffer;
};

type HeadlineLayout = { lines: string[]; fontSize: number; lineHeight: number };

// --- Balanced headline wrapping (Handoff micro-polish) ---
//
// shared.ts's layoutAtSize (still used everywhere else — educational.ts,
// this file's own CTA/supporting text) wraps GREEDILY: it fills each line
// to the character budget before moving to the next word, which for a
// headline like "Villa Almadan Önce Kontrol Listesi" produces "Villa
// Almadan Önce Kontrol" / "Listesi" — a long line followed by a short
// orphan word. This block is a headline-specific alternative that instead
// finds the word-boundary split whose lines are most EVENLY sized, kept
// local to this file (not added to shared.ts) since nothing else in the
// pipeline asked for this behavior and shared.ts also drives
// educational.ts's layout, which this task does not touch.
//
// estimateMaxCharsPerLine mirrors shared.ts's own layoutAtSize formula
// exactly (same heuristic average-glyph-width constant) — duplicated
// rather than imported/exported, to keep every change in this task
// contained to this one file. No real font-metrics engine is available in
// resvg-wasm ahead of a full render pass, and none is needed: like the
// original, this only has to stay proportionally correct across headline
// lengths, not be pixel-exact — and it operates on the exact same width
// budget as the rest of this pipeline, not a browser text-layout API.
function estimateMaxCharsPerLine(availableWidth: number, fontSize: number): number {
  return Math.max(6, Math.floor(availableWidth / (fontSize * 0.56)));
}

function wordGroupLength(words: string[], start: number, end: number): number {
  let total = 0;
  for (let k = start; k < end; k += 1) {
    total += words[k].length + (k > start ? 1 : 0);
  }
  return total;
}

// Every 1..3-line grouping of `words` whose EVERY line fits within
// maxCharsPerLine, ranked by (fewest lines, then most balanced — smallest
// gap between the longest and shortest line). Explicit 1/2/3-line cases
// only, not a generic N-line search: headline wrapping in this codebase
// is already capped at 3 lines (maxLines), so there's no reason to
// generalize further. Returns null when no such grouping exists — the
// caller falls back to the existing greedy layoutAtSize in that case, so
// a pathological headline still never overflows or loses a word
// mid-line.
function findBalancedWrap(words: string[], maxCharsPerLine: number, maxLines: number): string[] | null {
  const wholeLength = wordGroupLength(words, 0, words.length);
  if (wholeLength <= maxCharsPerLine) {
    return [words.join(" ")];
  }
  if (maxLines < 2) {
    return null;
  }

  let best2: { lines: string[]; spread: number } | null = null;
  for (let i = 1; i < words.length; i += 1) {
    const lengths = [wordGroupLength(words, 0, i), wordGroupLength(words, i, words.length)];
    if (lengths.some((len) => len > maxCharsPerLine)) continue;
    const spread = Math.max(...lengths) - Math.min(...lengths);
    if (!best2 || spread < best2.spread) {
      best2 = { lines: [words.slice(0, i).join(" "), words.slice(i).join(" ")], spread };
    }
  }
  if (best2) {
    return best2.lines;
  }
  if (maxLines < 3) {
    return null;
  }

  let best3: { lines: string[]; spread: number } | null = null;
  for (let i = 1; i < words.length - 1; i += 1) {
    for (let j = i + 1; j < words.length; j += 1) {
      const lengths = [wordGroupLength(words, 0, i), wordGroupLength(words, i, j), wordGroupLength(words, j, words.length)];
      if (lengths.some((len) => len > maxCharsPerLine)) continue;
      const spread = Math.max(...lengths) - Math.min(...lengths);
      if (!best3 || spread < best3.spread) {
        best3 = {
          lines: [words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")],
          spread,
        };
      }
    }
  }
  return best3 ? best3.lines : null;
}

function wrapBalancedHeadline(
  text: string,
  availableWidth: number,
  fontSize: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: [text], truncated: false };
  }

  const maxCharsPerLine = estimateMaxCharsPerLine(availableWidth, fontSize);
  const balanced = findBalancedWrap(words, maxCharsPerLine, maxLines);
  if (balanced) {
    return { lines: balanced, truncated: false };
  }

  // No word-boundary grouping keeps every line within budget at maxLines
  // lines — fall back to shared.ts's own greedy-fill + ellipsis-truncate
  // layoutAtSize (proven, already used everywhere else in this pipeline)
  // rather than reimplementing that same truncation behavior here.
  return layoutAtSize(text, availableWidth, fontSize, maxLines);
}

// Two discrete size tiers, not indefinite shrinking: try the larger, more
// readable size at up to 2 lines first; only step down to the smaller size
// (up to 3 lines) if the headline doesn't fit there. Readability over fitting
// every character — a very long headline still ends in a clean ellipsis.
// Tier-selection logic itself is unchanged; only the underlying wrapping
// (wrapBalancedHeadline vs. the old direct layoutAtSize call) changed, so
// this never shrinks the font more aggressively than before to force two
// lines — a balanced 2-line fit is exactly as likely to succeed as the
// old greedy one was (often more so, since every split is considered).
function wrapHeadline(rawHeadline: string, availableWidth: number): HeadlineLayout {
  const headline = (rawHeadline || "").trim() || FALLBACK_HEADLINE;

  const large = wrapBalancedHeadline(headline, availableWidth, 54, 2);
  if (!large.truncated) {
    return { lines: large.lines, fontSize: 54, lineHeight: 64 };
  }

  const small = wrapBalancedHeadline(headline, availableWidth, 44, 3);
  return { lines: small.lines, fontSize: 44, lineHeight: 54 };
}

function buildHeroOverlaySvg(
  width: number,
  height: number,
  rawHeadline: string,
  rawCta: string | undefined,
  baseImage: Buffer,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const { lines, fontSize, lineHeight } = wrapHeadline(rawHeadline, availableWidth);
  const cta = (rawCta || "").trim();

  // Bottom-up safe-region stack, brand row anchored first: brand sits in
  // its own row, its safe margins fixed to the canvas edges; CTA sits a
  // fixed gap above the brand row's TOP (never its baseline — using the
  // icon's own top edge as the boundary means CTA can never visually
  // touch the icon even though the wordmark itself is shorter); headline
  // sits a fixed gap above the CTA baseline and grows upward with line
  // count. Every element is on its own row — headline/CTA never share a
  // row with the brand — so no horizontal collision math is needed at
  // all; a vertical gap alone guarantees separation regardless of
  // headline length or brand wordmark width. Reusable across canvas
  // sizes: every offset is a named margin/gap relative to width/height,
  // never a value tuned for one specific render.
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - BRAND_ICON_SIZE;
  const ctaBaselineY = brandIconTopY - BRAND_TO_CTA_GAP;
  const headlineLastBaselineY = ctaBaselineY - CTA_TO_HEADLINE_GAP;
  const headlineFirstBaselineY = headlineLastBaselineY - (lines.length - 1) * lineHeight;
  const scrimTop = Math.max(
    height * (1 - SCRIM_MIN_COVERAGE_FRACTION),
    headlineFirstBaselineY - fontSize - 120,
  );

  const headlineTspans = lines
    .map((line, index) => {
      const y = headlineFirstBaselineY + index * lineHeight;
      return `<tspan x="${SAFE_PADDING_X}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");

  // Comfortably readable on a phone feed while staying clearly secondary to
  // the headline (still smaller/lighter weight than the 44-54px headline).
  const ctaMarkup = cta
    ? `<text x="${SAFE_PADDING_X}" y="${ctaBaselineY}" font-family="${FONT_STACK}" font-size="36" font-weight="700" fill="${GOLD}">${escapeXml(cta)}</text>`
    : "";

  // Bottom-right corner, never top — see the brand-hierarchy comment above
  // the safe-region constants. align="right" anchors the mark's own right
  // edge at the safe margin regardless of "SUAT KILIÇ"'s rendered width.
  const brand = buildBrandMark(width - SAFE_PADDING_X, brandIconTopY, "compact", "gold", "right");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Three stops, not two: a longer, more gradual fade (and a lower
           peak opacity than the previous 0.88) reads as an atmospheric
           photographic vignette rather than a flat dark panel dropped onto
           the photo — the "premium editorial, not a UI block" requirement.
           Still reaches enough contrast at the very bottom for the
           headline/CTA/brand text sitting on top of it. -->
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0" />
        <stop offset="55%" stop-color="#09090b" stop-opacity="0.34" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="0.74" />
      </linearGradient>
      ${brand.defs}
    </defs>

    ${buildCoverImageMarkup(baseImage, width, height)}

    <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#scrim)" />

    <text font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" fill="#f4f4f5" letter-spacing="-0.5">${headlineTspans}</text>

    ${ctaMarkup}

    ${brand.markup}
  </svg>`;
}

// Package 5B-1: moved verbatim from compose.ts's previous single
// implementation. Canvas resize, gradient, headline layout/wrapping, font
// sizes, CTA rendering, badge rendering, margins, SVG order, and PNG output
// are all unchanged in style — this package (Handoff 6, Step 1B) made only
// the canvas width/height and the geometry that genuinely depends on them
// (CTA/headline/scrim vertical position) derive from dimensionsPx instead
// of a hardcoded 1080x1350, so platform-selected formats other than
// Instagram's own default render at their own correct final size.
//
// Sharp removal (Handoff — production recovery): the base image and the
// text/scrim/badge overlay are now composited in a single pass by
// embedding the base image as a data: URI <image> element directly inside
// the same SVG string the overlay markup already builds, rasterized once
// by resvg-wasm — rather than sharp's previous two-step resize-then-
// composite. See resvg-renderer.ts's buildCoverImageMarkup for the cover-
// crop equivalence and its one known behavior difference (center crop,
// not saliency-based).
export async function renderHero({ baseImage, headline, cta, dimensionsPx }: HeroRenderInput): Promise<Buffer> {
  const { width, height } = parseCanvasDimensions(dimensionsPx);

  const overlaySvg = buildHeroOverlaySvg(width, height, headline, cta, baseImage);

  return renderSvgToPng(overlaySvg, width, height);
}
