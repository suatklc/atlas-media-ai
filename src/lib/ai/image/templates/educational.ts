import type { CompositionInput } from "./types";
import { FONT_STACK, escapeXml, layoutAtSize, parseCanvasDimensions } from "./shared";
import { buildBrandMark, GOLD, GOLD_LIGHT, GOLD_DEEP } from "./brand";
import { buildCoverImageMarkup, renderSvgToPng } from "../resvg-renderer";

const SAFE_PADDING_X = 64;
const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";

// supportingText still has NO structured source in the pipeline (see
// Package 5B-2 report) — kept as a local-only, always-absent-in-production
// optional field for the same reason as before. Real points come from the
// shared CompositionInput.educationalPoints (Package 5C, plain strings,
// sourced from the [[EDUCATIONAL_POINTS: ...]] marker) — rendered directly
// as titles below (Educational Visual Polish dropped the unused
// title/description object shape since description was never populated).
type EducationalRenderInput = CompositionInput & {
  baseImage: Buffer;
  supportingText?: string;
};

// --- Educational Visual Polish: narrow headline/point-count normalization ---
//
// Claude sometimes states a count in the headline ("5 Başlık") that doesn't
// match how many points this renderer actually displays (density limits:
// max 4 for 4:5, max 3 for 1:1). Left alone, that reads as a factual error
// on the published image. This is a DISPLAY-ONLY transform applied to the
// on-image headline text only — the stored visualHeadline, caption, and
// marker output are never touched.
//
// Deliberately narrow: only fires for a fixed, explicit set of count nouns,
// either immediately after the mismatched digit or after one fixed list
// qualifier ("kritik"/"temel") — never a general number rewrite, which
// would also damage unrelated numbers like
// "5 Yıllık Yatırım Planı", "2026 Gayrimenkul Beklentileri", or
// "3+1 Ev Alırken Dikkat Edilecekler". Only the digit is replaced; the
// noun's original surface form/casing is preserved exactly.
const COUNT_NOUNS = new Set(["başlık", "konu", "madde", "nokta", "adım", "kontrol", "kriter", "ipucu", "detay"]);
const COUNT_QUALIFIERS = new Set(["kritik", "temel"]);

function nextNonWhitespaceTokenIndex(tokens: string[], fromIndex: number): number | undefined {
  for (let index = fromIndex + 1; index < tokens.length; index += 1) {
    if (!/^\s+$/.test(tokens[index])) {
      return index;
    }
  }
  return undefined;
}

function normalizedWord(token: string): string {
  return token.replace(/[.,!?:;]+$/, "").toLocaleLowerCase("tr-TR");
}

export function normalizeHeadlineForDisplayedPointCount(
  rawHeadline: string,
  displayedPointCount: number,
): string {
  if (displayedPointCount < 1) {
    return rawHeadline;
  }

  const tokens = rawHeadline.split(/(\s+)/);

  for (let index = 0; index < tokens.length; index += 1) {
    const digitToken = tokens[index];
    if (!/^[2-9]$/.test(digitToken) || Number(digitToken) <= displayedPointCount) {
      continue;
    }

    const followingIndex = nextNonWhitespaceTokenIndex(tokens, index);
    if (followingIndex === undefined) continue;

    let nounIndex = followingIndex;
    if (COUNT_QUALIFIERS.has(normalizedWord(tokens[followingIndex]))) {
      const afterQualifierIndex = nextNonWhitespaceTokenIndex(tokens, followingIndex);
      if (afterQualifierIndex === undefined) continue;
      nounIndex = afterQualifierIndex;
    }

    if (COUNT_NOUNS.has(normalizedWord(tokens[nounIndex]))) {
      tokens[index] = String(displayedPointCount);
      return tokens.join("");
    }
  }

  return rawHeadline;
}

type HeadlineLayout = { lines: string[]; fontSize: number; lineHeight: number };

// Educational Visual Polish: bumped from 46/36 to 50/38 for stronger
// headline presence relative to the (now larger) point typography below —
// still the same two-discrete-tiers-not-indefinite-shrinking approach as
// hero: try the larger readable size first, step down once if needed.
function wrapEducationalHeadline(rawHeadline: string, availableWidth: number): HeadlineLayout {
  const headline = (rawHeadline || "").trim() || FALLBACK_HEADLINE;

  const large = layoutAtSize(headline, availableWidth, 50, 2);
  if (!large.truncated) {
    return { lines: large.lines, fontSize: 50, lineHeight: 58 };
  }

  const small = layoutAtSize(headline, availableWidth, 38, 3);
  return { lines: small.lines, fontSize: 38, lineHeight: 46 };
}

// Reduced density for square canvases, per the Package 5 audit (Part
// D/F/G): a 1:1 educational post has less vertical room than 4:5, so it
// caps at 3 points instead of 4 rather than shrinking type to fit more.
const MAX_POINTS_PORTRAIT = 4; // 4:5
const MAX_POINTS_SQUARE = 3; // 1:1

// Educational Visual Polish (final tuning pass): point titles bumped again
// to 38px (4:5) / 36px (1:1) — still comfortably legible once scaled down
// to typical in-feed/mobile preview.
const POINT_FONT_SIZE_PORTRAIT = 38;
const POINT_FONT_SIZE_SQUARE = 36;

// Deterministic SVG-drawn number badge (circle + text) — reuses the same
// brandGradient already defined for the Atlas badge, no new colors. Gives
// each point a strong non-text visual anchor so the list reads as
// intentional takeaways rather than plain stacked lines. Bumped from 36px
// to 46px so it reads as a real information anchor rather than a dot.
const NUMBER_BADGE_SIZE = 46;
const NUMBER_BADGE_FONT_SIZE = 22;
const NUMBER_TO_TITLE_GAP = 18;

const CTA_LINE_HEIGHT = 30;

// --- Adaptive point-zone geometry (canvas-shape-driven, not platform-driven) ---
//
// Previous version stacked rows with a fixed per-row height, tightly
// bottom-packed regardless of how many points there were — 3 points in a
// tall 4:5 canvas looked just as compressed as 4. This version instead
// reserves a zone sized as a FRACTION of the canvas's own height, then
// evenly distributes whatever number of points is actually displayed
// across that zone — fewer points get visibly more breathing room, more
// points still fit comfortably, and a differently-proportioned canvas
// (future platform presets) adapts automatically since every input here is
// canvas height / margins / displayed count, never a named platform.
const ZONE_HEIGHT_FRACTION = 0.5; // bottom half of the canvas, reserved for points/CTA
const ZONE_BOTTOM_MARGIN = 56; // safe gap from the zone's own content to the canvas edge
const ZONE_MIN_GAP_BELOW_HEADLINE = 20; // never let the zone rise above the headline block
const ZONE_GRADIENT_LEAD_IN = 40; // how far above the zone's top the gradient rect begins
const ZONE_GRADIENT_FADE_DISTANCE = 100; // px over which the gradient reaches target opacity
const SCRIM_TARGET_OPACITY = 0.78;

function buildEducationalOverlaySvg(
  width: number,
  height: number,
  rawHeadline: string,
  rawSupportingText: string | undefined,
  rawPoints: string[],
  rawCta: string | undefined,
  baseImage: Buffer,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const badgeY = 56;
  const isSquare = height <= width;
  const maxPoints = isSquare ? MAX_POINTS_SQUARE : MAX_POINTS_PORTRAIT;
  const pointFontSize = isSquare ? POINT_FONT_SIZE_SQUARE : POINT_FONT_SIZE_PORTRAIT;

  // Priority order assumed to be the caller's array order — lowest-priority
  // (trailing) points are dropped first when over budget, never shrunk.
  const points = rawPoints.slice(0, maxPoints);

  // Compute the *displayed* count first so headline normalization reacts to
  // what actually renders, not how many points Claude originally supplied.
  const normalizedHeadline = normalizeHeadlineForDisplayedPointCount(rawHeadline, points.length);
  const headlineLayout = wrapEducationalHeadline(normalizedHeadline, availableWidth);
  const headlineTop = badgeY + 40 + 60;
  const headlineTspans = headlineLayout.lines
    .map((line, index) => {
      const y = headlineTop + index * headlineLayout.lineHeight;
      return `<tspan x="${SAFE_PADDING_X}" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  const headlineBottom = headlineTop + (headlineLayout.lines.length - 1) * headlineLayout.lineHeight;

  // Optional supporting line — no structured source today (see file-level
  // comment); only renders when a caller explicitly supplies one.
  let supportingMarkup = "";
  let contentTop = headlineBottom + 50;
  const trimmedSupporting = (rawSupportingText || "").trim();
  if (trimmedSupporting) {
    const supportLayout = layoutAtSize(trimmedSupporting, availableWidth, 28, 2);
    const supportLineHeight = 34;
    const supportTspans = supportLayout.lines
      .map((line, index) => `<tspan x="${SAFE_PADDING_X}" y="${contentTop + index * supportLineHeight}">${escapeXml(line)}</tspan>`)
      .join("");
    supportingMarkup = `<text font-family="${FONT_STACK}" font-size="28" font-weight="500" fill="#d4d4d8">${supportTspans}</text>`;
    contentTop += (supportLayout.lines.length - 1) * supportLineHeight + 44;
  }

  const cta = (rawCta || "").trim();
  const ctaLayout = cta ? layoutAtSize(cta, availableWidth, 24, 2) : null;
  const ctaLines = ctaLayout ? ctaLayout.lines : [];

  const hasPanelContent = points.length > 0 || ctaLines.length > 0;

  let panelMarkup = "";
  if (hasPanelContent) {
    // Adaptive information zone: a fixed fraction of the canvas's own
    // height, clamped so it never rises above the headline/supporting
    // block. Every input is canvas geometry (height, margins, displayed
    // count) — never a named platform — so this stays reusable for future
    // aspect ratios/platform presets without touching this renderer again.
    const zoneTop = Math.max(height * (1 - ZONE_HEIGHT_FRACTION), contentTop + ZONE_MIN_GAP_BELOW_HEADLINE);
    const zoneBottom = height - ZONE_BOTTOM_MARGIN;
    const zoneHeight = Math.max(zoneBottom - zoneTop, 1);

    // CTA (when present) reserves its own room at the foot of the zone
    // first; whatever remains is what the points distribute across.
    const ctaBlockHeight = ctaLines.length > 0 ? ctaLines.length * CTA_LINE_HEIGHT + 30 : 0;
    const pointsZoneHeight = Math.max(zoneHeight - ctaBlockHeight, 1);

    // Even distribution across the usable zone: each point is centered in
    // its own equal share of pointsZoneHeight (space-around, not
    // edge-anchored), so a single point centers itself in the whole zone
    // and 3/4 points spread out proportionally to however tall the zone is
    // — never a fixed row height regardless of count.
    const rowSpacing = points.length > 0 ? pointsZoneHeight / points.length : 0;

    const titleAvailableWidth = availableWidth - NUMBER_BADGE_SIZE - NUMBER_TO_TITLE_GAP;
    const badgeCx = SAFE_PADDING_X + NUMBER_BADGE_SIZE / 2;
    const titleX = SAFE_PADDING_X + NUMBER_BADGE_SIZE + NUMBER_TO_TITLE_GAP;

    const pointsMarkup = points
      .map((title, index) => {
        const rowCenterY = zoneTop + rowSpacing * (index + 0.5);
        const titleLayout = layoutAtSize(title, titleAvailableWidth, pointFontSize, 1);
        const titleText = escapeXml(titleLayout.lines[0] || "");
        const numberLabel = String(index + 1).padStart(2, "0");

        return `<circle cx="${badgeCx}" cy="${rowCenterY}" r="${NUMBER_BADGE_SIZE / 2}" fill="url(#pointBadgeGold)" />
    <text x="${badgeCx}" y="${rowCenterY + NUMBER_BADGE_FONT_SIZE * 0.35}" font-family="${FONT_STACK}" font-size="${NUMBER_BADGE_FONT_SIZE}" font-weight="700" fill="#ffffff" text-anchor="middle">${numberLabel}</text>
    <text x="${titleX}" y="${rowCenterY + pointFontSize * 0.35}" font-family="${FONT_STACK}" font-size="${pointFontSize}" font-weight="700" fill="#ffffff">${titleText}</text>`;
      })
      .join("");

    const ctaTop = zoneTop + pointsZoneHeight + (points.length > 0 ? 24 : 0);
    const ctaTspans = ctaLines
      .map((line, index) => `<tspan x="${SAFE_PADDING_X}" y="${ctaTop + index * CTA_LINE_HEIGHT}">${escapeXml(line)}</tspan>`)
      .join("");
    const ctaMarkup = ctaLines.length > 0
      ? `<text font-family="${FONT_STACK}" font-size="24" font-weight="600" fill="${GOLD}">${ctaTspans}</text>`
      : "";

    // Gradient rect spans from just above the zone's top down to the
    // canvas bottom, fading in over ZONE_GRADIENT_FADE_DISTANCE (as a
    // fraction of its own height, capped so a short gradient still reaches
    // full target opacity) so contrast is already established above the
    // first row. Geometry-driven by the zone's own position/height — no
    // hard edge, no fixed platform-shaped panel.
    const gradientTop = Math.max(zoneTop - ZONE_GRADIENT_LEAD_IN, contentTop);
    const gradientHeight = Math.max(height - gradientTop, 1);
    const fadeFraction = Math.min(0.9, ZONE_GRADIENT_FADE_DISTANCE / gradientHeight);

    panelMarkup = `
    <defs>
      <linearGradient id="pointScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0" />
        <stop offset="${(fadeFraction * 100).toFixed(2)}%" stop-color="#09090b" stop-opacity="${SCRIM_TARGET_OPACITY}" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="${SCRIM_TARGET_OPACITY}" />
      </linearGradient>
    </defs>
    <rect x="0" y="${gradientTop}" width="${width}" height="${gradientHeight}" fill="url(#pointScrim)" />
    ${pointsMarkup}
    ${ctaMarkup}`;
  }

  const brand = buildBrandMark(SAFE_PADDING_X, badgeY);
  // Headline sits directly over the base photo (no panel above it) — a
  // dedicated top scrim keeps it deterministically readable regardless of
  // image brightness, the same principle the bottom scrim applies below.
  const topScrimHeight = Math.max(headlineBottom + 60, 260);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="pointBadgeGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GOLD_LIGHT}" />
        <stop offset="100%" stop-color="${GOLD_DEEP}" />
      </linearGradient>
      <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0.55" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="0" />
      </linearGradient>
      ${brand.defs}
    </defs>

    ${buildCoverImageMarkup(baseImage, width, height)}

    <rect x="0" y="0" width="${width}" height="${topScrimHeight}" fill="url(#topScrim)" />

    ${brand.markup}

    <text font-family="${FONT_STACK}" font-size="${headlineLayout.fontSize}" font-weight="700" fill="#f4f4f5" letter-spacing="-0.5">${headlineTspans}</text>

    ${supportingMarkup}

    ${panelMarkup}
  </svg>`;
}

// Package 5B-2/5C + Educational Visual Polish: dedicated educational
// renderer. Top-anchored headline (over a deterministic scrim) instead of
// hero's bottom-anchored treatment, plus a soft gradient scrim (not a flat
// opaque panel) reserved for up to 4 (4:5) or 3 (1:1) numbered points —
// rendered only when there is real content (points and/or CTA) to show.
// Points come from the shared CompositionInput.educationalPoints (Package
// 5C) rendered directly as titles — never a fabricated description.
// supportingText still has no structured source, so it stays absent in
// production. With no points/CTA available (non-educational content, or an
// older/malformed response), this produces a clean headline+badge
// composition on the correctly-sized (4:5 or 1:1) canvas — never a
// fabricated or emptily decorative panel.
//
// Sharp removal (Handoff — production recovery): same single-pass
// SVG+resvg-wasm compositing as renderHero — see that function's comment
// and resvg-renderer.ts for the cover-crop equivalence and its one known
// behavior difference (center crop, not saliency-based).
export async function renderEducational(input: EducationalRenderInput): Promise<Buffer> {
  const { baseImage, headline, cta, supportingText, educationalPoints } = input;
  const { width, height } = parseCanvasDimensions(input.dimensionsPx);

  const overlaySvg = buildEducationalOverlaySvg(
    width,
    height,
    headline,
    supportingText,
    educationalPoints ?? [],
    cta,
    baseImage,
  );

  return renderSvgToPng(overlaySvg, width, height);
}
