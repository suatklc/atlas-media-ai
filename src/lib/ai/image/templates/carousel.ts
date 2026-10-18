import { FONT_STACK, escapeXml, layoutAtSize, parseCanvasDimensions } from "./shared";
import { buildRealLogoMarkup, GOLD, GOLD_LIGHT, GOLD_DEEP, BRAND_NAVY } from "./brand";
import { loadMattedLogoAsset, type MattedLogoAsset } from "./logoAsset";
import { buildCoverImageMarkup, renderSvgToPng } from "../resvg-renderer";

// Real Multi-Slide Carousel: a NEW, independent renderer — hero.ts and
// educational.ts are neither imported from nor modified by this file. It
// reuses only the same shared, already-proven primitives every other
// template reuses (shared.ts's layout/escaping, resvg-renderer.ts's
// SVG->PNG pipeline), so text-safety behavior stays identical to the
// rest of the product.
//
// Gold Standard V1 revision: still deliberately ONE generated AI image
// per carousel (same one paid image-generation call as before) — but it
// is now used for slide 1 (hook/cover) ONLY. Slides 2-4 are "primarily
// professional information design" (typography, big-number emphasis,
// checklist badges, structured layouts) on a solid branded background —
// the explicit fix for "one villa photo cropped five times." Slide 5
// keeps its existing photo-free branded closing treatment, unchanged.
// The brand mark on every slide is now the REAL Suat Kılıç logo asset
// (see logoAsset.ts/brand.ts's buildRealLogoMarkup) — the old procedural
// villa-icon mark function is no longer called anywhere in this file;
// hero.ts/educational.ts still use it, untouched.

const SAFE_PADDING_X = 64;
const SAFE_PADDING_TOP = 56;
const SAFE_PADDING_BOTTOM = 64;
const SLIDE_COUNT = 5;

// Two size tiers, per the Gold Standard brief: "For cover and CTA:
// stronger brand presence is acceptable. For information-heavy slides:
// smaller but still clearly readable." Both preserve the source logo's
// own proportions (buildRealLogoMarkup scales uniformly) — only the
// rendered height differs.
const LOGO_HEIGHT_LARGE = 92;
const LOGO_HEIGHT_SMALL = 52;

export type CarouselSlideText = {
  cover: string;
  whatHappened: string;
  whyItMatters: string;
  considerations: string[];
  closingLine: string;
  fixedCta?: string;
  sourceLabel?: string;
  // Optional (Gold Standard V1): a short, already-fact-checked number or
  // headline figure for slide 2's "editorial information layout, key
  // fact/number" requirement — e.g. "150.000 TL". Undefined renders slide
  // 2 exactly as before (label + body only), never a fabricated number.
  keyFact?: string;
  // Optional (expert/portfolio content mode): content-specific section
  // labels replacing the news template's fixed "Ne Oldu?" / "Neden
  // Önemli?" / "Nelere Dikkat Etmeli?". Absent = exactly the news labels.
  sectionLabels?: { whatHappened?: string; whyItMatters?: string; considerations?: string };
  // Optional (expert/portfolio content mode only): each slide's own headline
  // rendered as a large heading between the gold section label and the
  // body — the editorial hierarchy (label → heading → body) a production
  // review found missing (a lone body block floating in an empty slide).
  // Absent = the news layout, byte-for-byte unchanged.
  headings?: { whatHappened?: string; whyItMatters?: string; considerations?: string; closing?: string };
};

const DEFAULT_SECTION_LABELS = {
  whatHappened: "Ne Oldu?",
  whyItMatters: "Neden Önemli?",
  considerations: "Nelere Dikkat Etmeli?",
};

function logoMarkup(width: number, height: number, logo: MattedLogoAsset, size: "large" | "small", clipId: string) {
  const targetHeight = size === "large" ? LOGO_HEIGHT_LARGE : LOGO_HEIGHT_SMALL;
  return buildRealLogoMarkup(logo, width - SAFE_PADDING_X, height - SAFE_PADDING_BOTTOM - targetHeight, targetHeight, clipId);
}

function progressMarkup(width: number, slideNumber: number): string {
  const label = `${String(slideNumber).padStart(2, "0")} / ${String(SLIDE_COUNT).padStart(2, "0")}`;
  return `<text x="${width - SAFE_PADDING_X}" y="${SAFE_PADDING_TOP}" text-anchor="end" font-family="${FONT_STACK}" font-size="20" font-weight="600" letter-spacing="1" fill="#d4d4d8">${escapeXml(label)}</text>`;
}

// Two discrete size tiers (never indefinite shrinking), same principle
// hero.ts/educational.ts already use for their own headline text — a
// realistically long Turkish headline still ends in a clean ellipsis
// rather than shrinking type to the point of illegibility.
function wrapTwoTier(
  text: string,
  availableWidth: number,
  largeSize: number,
  largeLines: number,
  smallSize: number,
  smallLines: number,
): { lines: string[]; fontSize: number; lineHeight: number } {
  const large = layoutAtSize(text, availableWidth, largeSize, largeLines);
  if (!large.truncated) {
    return { lines: large.lines, fontSize: largeSize, lineHeight: Math.round(largeSize * 1.16) };
  }
  const small = layoutAtSize(text, availableWidth, smallSize, smallLines);
  return { lines: small.lines, fontSize: smallSize, lineHeight: Math.round(smallSize * 1.16) };
}

function tspans(lines: string[], x: number, startY: number, lineHeight: number): string {
  return lines
    .map((line, index) => `<tspan x="${x}" y="${startY + index * lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
}

function labelMarkup(x: number, y: number, label: string): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="22" font-weight="700" letter-spacing="2" fill="${GOLD}">${escapeXml(label.toLocaleUpperCase("tr-TR"))}</text>`;
}

// Carousel Final Quality: the real ContentPackage pipeline (Job 2) writes
// full editorial sentences into Slide.facts[], not the short punchy
// figures ("150.000 TL") the keyFact/considerations treatments below were
// originally tuned for. Centering a text block inside its available zone
// — instead of pinning it to a fixed offset below the label and leaving
// whatever's left as dead space — is what lets a slide look properly
// composed whether the real content is one short line or several.
// "Span" here means the baseline-to-baseline distance from the first to
// the last line (lineCount-1)*lineHeight — the same measure
// buildClosingSlideSvg already centers on; treating that span's midpoint
// as the zone's visual center is a proven-enough approximation (ascent/
// descent above the first and below the last baseline are close enough
// to symmetric for this font) without inventing a new metric.
// biasRatio shifts the reference point used as "center" toward the top
// of the zone (0.5 = true midpoint, lower = closer to zoneTop) — pure
// midpoint centering left an empty gap both above AND below a short
// text block (nothing visually anchors it to the label right above the
// zone), which read as the text "floating" rather than composed. A
// mild upward bias keeps content close to its label while still
// guaranteeing it never collides with the logo/footer below.
function centeredFirstBaselineY(
  zoneTop: number,
  zoneBottom: number,
  totalSpan: number,
  minFirstBaselineY: number,
  biasRatio = 0.5,
): number {
  const referenceY = zoneTop + (zoneBottom - zoneTop) * biasRatio;
  return Math.max(referenceY - totalSpan / 2, minFirstBaselineY);
}

// Shared "information design" background for slides 2-4 — a solid navy
// panel plus a positioned radial gold accent, same visual language
// buildClosingSlideSvg's own closingAccent already established for slide
// 5 (so every no-photo slide reads as one coherent design system), varied
// only by accent position/id so slides 2/3/4 aren't visually identical to
// each other. No photo at all — this is the direct fix for "one villa
// photo cropped five times": these three slides are typography/data-card
// layouts, not photo crops.
type AccentVariant = { id: string; cx: number; cy: number };
const ACCENT_VARIANTS: Record<"what-happened" | "why-it-matters" | "what-to-do", AccentVariant> = {
  "what-happened": { id: "infoAccentA", cx: 0.85, cy: 0.08 },
  "why-it-matters": { id: "infoAccentB", cx: 0.1, cy: 0.85 },
  "what-to-do": { id: "infoAccentC", cx: 0.5, cy: 0.02 },
};

function infoCardBackgroundMarkup(width: number, height: number, variant: AccentVariant): string {
  return `<defs>
      <radialGradient id="${variant.id}" cx="${variant.cx}" cy="${variant.cy}" r="0.7">
        <stop offset="0%" stop-color="${GOLD_DEEP}" stop-opacity="0.18" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_NAVY}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#${variant.id})" />`;
}

// --- Slide 1: Cover ---
// Full-bleed hero photo (the one AI-generated base image) + bottom-up
// scrim + headline, same safe-region stacking principle hero.ts uses
// (each element in its own row, brand anchored first) — independently
// implemented here so hero.ts itself is never touched.
function buildCoverSlideSvg(width: number, height: number, baseImage: Buffer, headline: string, logo: MattedLogoAsset): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const { lines, fontSize, lineHeight } = wrapTwoTier(headline || "Gayrimenkul İçeriği", availableWidth, 56, 3, 44, 4);
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_LARGE;
  const headlineLastBaselineY = brandIconTopY - 60;
  const headlineFirstBaselineY = headlineLastBaselineY - (lines.length - 1) * lineHeight;
  const scrimTop = Math.max(height * 0.42, headlineFirstBaselineY - fontSize - 120);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="coverScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0" />
        <stop offset="55%" stop-color="#09090b" stop-opacity="0.36" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="0.78" />
      </linearGradient>
    </defs>
    ${buildCoverImageMarkup(baseImage, width, height)}
    <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#coverScrim)" />
    ${progressMarkup(width, 1)}
    <text font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" fill="#f4f4f5" letter-spacing="-0.5">${tspans(lines, SAFE_PADDING_X, headlineFirstBaselineY, lineHeight)}</text>
    ${logoMarkup(width, height, logo, "large", "logoClipCover")}
  </svg>`;
}

// --- Slide 2: What happened? ---
// Editorial information layout, no photo: label + optional big-number/key-
// fact callout (only when the caller actually supplied one — never
// fabricated here) + body text, on the shared info-card background.
const KEY_FACT_Y_GAP = 30;
// The 72px gold callout below is a "big number" treatment (e.g.
// "150.000 TL") — a real editorial sentence ("Zorunlu Deprem Sigortası
// Genel Şartlarında değişikliğe dair Tebliğin 1'inci maddesi...") does
// not fit that treatment at any line count without being chopped into an
// unreadable fragment. Rather than truncating a long fact into a giant,
// broken headline, a keyFact over this length is treated exactly like no
// keyFact was supplied — body text alone, never a fabricated shorter
// fact in its place.
const MAX_KEY_FACT_CHARS = 60;

function buildWhatHappenedSlideSvg(
  width: number,
  height: number,
  body: string,
  keyFact: string | undefined,
  sourceLabel: string | undefined,
  logo: MattedLogoAsset,
  label: string = DEFAULT_SECTION_LABELS.whatHappened,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const labelY = SAFE_PADDING_TOP + 140;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_SMALL;
  const sourceReserve = sourceLabel ? 50 : 0;
  const zoneTop = labelY + 56;
  const zoneBottom = brandIconTopY - 40 - sourceReserve;

  const usableKeyFact = keyFact && keyFact.length <= MAX_KEY_FACT_CHARS ? keyFact : undefined;
  const keyFactLayout = usableKeyFact ? layoutAtSize(usableKeyFact, availableWidth, 72, 2) : null;
  const keyFactLineHeight = 78;

  const bodyMaxLines = keyFactLayout ? 5 : 8;
  const bodyLayout = wrapTwoTier(body || "", availableWidth, 32, bodyMaxLines, 25, bodyMaxLines + 3);

  const keyFactSpan = keyFactLayout ? (keyFactLayout.lines.length - 1) * keyFactLineHeight : 0;
  const bodySpan = (bodyLayout.lines.length - 1) * bodyLayout.lineHeight;
  const gapBetween = keyFactLayout ? KEY_FACT_Y_GAP + 40 : 0;
  const totalSpan = keyFactSpan + gapBetween + bodySpan;

  const keyFactFirstY = centeredFirstBaselineY(zoneTop, zoneBottom, totalSpan, zoneTop + 40, 0.4);
  const bodyFirstY = keyFactLayout ? keyFactFirstY + keyFactSpan + gapBetween : keyFactFirstY;

  const keyFactMarkup = keyFactLayout
    ? `<text font-family="${FONT_STACK}" font-size="72" font-weight="800" fill="${GOLD}" letter-spacing="-1">${tspans(keyFactLayout.lines, SAFE_PADDING_X, keyFactFirstY, keyFactLineHeight)}</text>`
    : "";

  const sourceMarkup = sourceLabel
    ? `<text x="${SAFE_PADDING_X}" y="${brandIconTopY + LOGO_HEIGHT_SMALL / 2 + 6}" font-family="${FONT_STACK}" font-size="19" font-weight="500" fill="#a1a1aa">${escapeXml(sourceLabel)}</text>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${infoCardBackgroundMarkup(width, height, ACCENT_VARIANTS["what-happened"])}
    ${progressMarkup(width, 2)}
    ${labelMarkup(SAFE_PADDING_X, labelY, label)}
    ${keyFactMarkup}
    <text font-family="${FONT_STACK}" font-size="${bodyLayout.fontSize}" font-weight="600" fill="#f4f4f5">${tspans(bodyLayout.lines, SAFE_PADDING_X, bodyFirstY, bodyLayout.lineHeight)}</text>
    ${sourceMarkup}
    ${logoMarkup(width, height, logo, "small", "logoClipWhatHappened")}
  </svg>`;
}

// --- Slide 3: Why does it matter? ---
// Same information-design principle as slide 2, without the key-fact
// callout (this slide is interpretation/significance, not a number) — a
// different accent position keeps it visually distinct from slide 2.
function buildWhyItMattersSlideSvg(
  width: number,
  height: number,
  body: string,
  logo: MattedLogoAsset,
  label: string = DEFAULT_SECTION_LABELS.whyItMatters,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const labelY = SAFE_PADDING_TOP + 140;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_SMALL;
  const zoneTop = labelY + 56;
  const zoneBottom = brandIconTopY - 40;
  const bodyLayout = wrapTwoTier(body || "", availableWidth, 34, 7, 28, 9);
  const bodySpan = (bodyLayout.lines.length - 1) * bodyLayout.lineHeight;
  const bodyFirstY = centeredFirstBaselineY(zoneTop, zoneBottom, bodySpan, zoneTop + 40, 0.4);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${infoCardBackgroundMarkup(width, height, ACCENT_VARIANTS["why-it-matters"])}
    ${progressMarkup(width, 3)}
    ${labelMarkup(SAFE_PADDING_X, labelY, label)}
    <text font-family="${FONT_STACK}" font-size="${bodyLayout.fontSize}" font-weight="600" fill="#f4f4f5">${tspans(bodyLayout.lines, SAFE_PADDING_X, bodyFirstY, bodyLayout.lineHeight)}</text>
    ${logoMarkup(width, height, logo, "small", "logoClipWhyItMatters")}
  </svg>`;
}

// --- Slide 4: What should the audience do? ---
// Same numbered-badge checklist language as before (circular gold badge +
// bold title) — already well-suited to "practical checklist" per the Gold
// Standard brief; only its background changed (solid info-card instead of
// a photo pan/crop).
const MAX_CONSIDERATIONS = 4;
const BADGE_SIZE = 46;
const BADGE_TO_TITLE_GAP = 18;

// Carousel Final Quality: real considerations are often full sentences
// (the editorial pipeline writes supporting facts, not punchy checklist
// phrases), so each item gets up to 3 lines instead of 2. Row height is
// now driven by each item's OWN line count — summed and centered in the
// zone — instead of evenly stretching every item across the whole zone
// regardless of count, which is what produced huge dead gaps for a
// 2-item list. Falls back to even distribution only if the natural
// total genuinely can't fit (kept purely as an overlap safety net).
const TITLE_LINE_HEIGHT = 40;
const CONSIDERATION_ROW_GAP = 40;

function buildConsiderationsSlideSvg(
  width: number,
  height: number,
  considerations: string[],
  logo: MattedLogoAsset,
  label: string = DEFAULT_SECTION_LABELS.considerations,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const labelY = SAFE_PADDING_TOP + 140;
  const items = considerations.slice(0, MAX_CONSIDERATIONS);
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_SMALL;

  const zoneTop = labelY + 60;
  const zoneBottom = brandIconTopY - 40;
  const zoneHeight = Math.max(zoneBottom - zoneTop, 1);
  const titleAvailableWidth = availableWidth - BADGE_SIZE - BADGE_TO_TITLE_GAP;
  const badgeCx = SAFE_PADDING_X + BADGE_SIZE / 2;
  const titleX = SAFE_PADDING_X + BADGE_SIZE + BADGE_TO_TITLE_GAP;

  const titleLayouts = items.map((title) => layoutAtSize(title, titleAvailableWidth, 34, 3));
  const rowHeights = titleLayouts.map((layout) => Math.max(BADGE_SIZE, layout.lines.length * TITLE_LINE_HEIGHT));
  const naturalTotalHeight =
    rowHeights.reduce((sum, h) => sum + h, 0) + CONSIDERATION_ROW_GAP * Math.max(items.length - 1, 0);

  const rowCenters: number[] = [];
  if (items.length > 0) {
    if (naturalTotalHeight <= zoneHeight) {
      // Same upward bias as centeredFirstBaselineY (0.4 vs a true 0.5
      // midpoint) — keeps a short item list close to its label instead
      // of floating in the middle of empty space.
      let cursor = zoneTop + Math.max(zoneHeight * 0.4 - naturalTotalHeight / 2, 0);
      for (const rowHeight of rowHeights) {
        rowCenters.push(cursor + rowHeight / 2);
        cursor += rowHeight + CONSIDERATION_ROW_GAP;
      }
    } else {
      const rowSpacing = zoneHeight / items.length;
      for (let i = 0; i < items.length; i++) rowCenters.push(zoneTop + rowSpacing * (i + 0.5));
    }
  }

  const itemsMarkup = items
    .map((title, index) => {
      const rowCenterY = rowCenters[index];
      const titleLayout = titleLayouts[index];
      const numberLabel = String(index + 1).padStart(2, "0");
      const titleTspans = titleLayout.lines
        .map((line, lineIndex) => {
          const y = rowCenterY + (lineIndex - (titleLayout.lines.length - 1) / 2) * TITLE_LINE_HEIGHT;
          return `<tspan x="${titleX}" y="${y}">${escapeXml(line)}</tspan>`;
        })
        .join("");

      return `<circle cx="${badgeCx}" cy="${rowCenterY}" r="${BADGE_SIZE / 2}" fill="url(#carouselBadgeGold)" />
      <text x="${badgeCx}" y="${rowCenterY + 7}" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${numberLabel}</text>
      <text font-family="${FONT_STACK}" font-size="34" font-weight="700" fill="#f4f4f5">${titleTspans}</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${infoCardBackgroundMarkup(width, height, ACCENT_VARIANTS["what-to-do"])}
    <defs>
      <linearGradient id="carouselBadgeGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GOLD_LIGHT}" />
        <stop offset="100%" stop-color="${GOLD_DEEP}" />
      </linearGradient>
    </defs>
    ${progressMarkup(width, 4)}
    ${labelMarkup(SAFE_PADDING_X, labelY, label)}
    ${itemsMarkup}
    ${logoMarkup(width, height, logo, "small", "logoClipConsiderations")}
  </svg>`;
}

// ============================================================
// EXPERT / portfolio editorial layout (slides 2-5, only when the caller
// passes `headings` — news content never does). Same navy/gold system,
// same safe paddings, logo, progress indicator and ellipsis-based no-
// clipping layout as the news slides; only the hierarchy changes:
//   gold eyebrow label → large white heading → short gold rule → body
// laid out as ONE composed block (the eyebrow travels with the heading,
// the whole group centered in the slide) instead of a small body
// paragraph floating in a mostly empty slide.
// ============================================================
const EDITORIAL_HEADING_TIER = { large: 60, largeLines: 3, small: 48, smallLines: 4 } as const;
const EDITORIAL_BODY_TIER = { large: 36, largeLines: 8, small: 30, smallLines: 11 } as const;
const EDITORIAL_HEADING_TO_RULE = 34;
const EDITORIAL_RULE_TO_BODY = 64;
const EDITORIAL_BODY_COLOR = "#d4d4d8";
// Eyebrow baseline sits this far above the heading's first-line top.
const EDITORIAL_LABEL_TO_HEADING_TOP = 44;
const EDITORIAL_GROUP_BIAS = 0.5;

type EditorialBlock = { markup: string; bottomY: number };

// (Optional) eyebrow label + heading + gold rule + (optional) body as one
// block, positioned in the zone
// [zoneTop, zoneBottom]. Returns the markup and the last baseline used, so a
// checklist can be laid out directly underneath.
function editorialBlock(
  heading: string,
  body: string | undefined,
  availableWidth: number,
  zoneTop: number,
  zoneBottom: number,
  extraBelowHeight = 0,
  label?: string,
): EditorialBlock {
  const headingLayout = wrapTwoTier(
    heading,
    availableWidth,
    EDITORIAL_HEADING_TIER.large,
    EDITORIAL_HEADING_TIER.largeLines,
    EDITORIAL_HEADING_TIER.small,
    EDITORIAL_HEADING_TIER.smallLines,
  );
  const bodyLayout = body
    ? wrapTwoTier(
        body,
        availableWidth,
        EDITORIAL_BODY_TIER.large,
        EDITORIAL_BODY_TIER.largeLines,
        EDITORIAL_BODY_TIER.small,
        EDITORIAL_BODY_TIER.smallLines,
      )
    : null;

  const headingSpan = (headingLayout.lines.length - 1) * headingLayout.lineHeight;
  const ruleOffset = headingSpan + EDITORIAL_HEADING_TO_RULE;
  const bodyOffset = ruleOffset + EDITORIAL_RULE_TO_BODY;
  const bodySpan = bodyLayout ? (bodyLayout.lines.length - 1) * bodyLayout.lineHeight : 0;
  const labelOffset = label ? headingLayout.fontSize + EDITORIAL_LABEL_TO_HEADING_TOP : 0;
  const totalSpan = labelOffset + (bodyLayout ? bodyOffset + bodySpan : ruleOffset) + extraBelowHeight;

  const groupFirstY = centeredFirstBaselineY(zoneTop, zoneBottom, totalSpan, zoneTop + (label ? 22 : headingLayout.fontSize), EDITORIAL_GROUP_BIAS);
  const headingFirstY = groupFirstY + labelOffset;
  const ruleY = headingFirstY + ruleOffset;
  const bodyFirstY = headingFirstY + bodyOffset;

  const markup = `${label ? labelMarkup(SAFE_PADDING_X, groupFirstY, label) : ""}
    <text font-family="${FONT_STACK}" font-size="${headingLayout.fontSize}" font-weight="800" fill="#f4f4f5" letter-spacing="-0.5">${tspans(headingLayout.lines, SAFE_PADDING_X, headingFirstY, headingLayout.lineHeight)}</text>
    <rect x="${SAFE_PADDING_X}" y="${ruleY}" width="72" height="4" rx="2" fill="${GOLD}" />
    ${
      bodyLayout
        ? `<text font-family="${FONT_STACK}" font-size="${bodyLayout.fontSize}" font-weight="500" fill="${EDITORIAL_BODY_COLOR}">${tspans(bodyLayout.lines, SAFE_PADDING_X, bodyFirstY, bodyLayout.lineHeight)}</text>`
        : ""
    }`;
  return { markup, bottomY: bodyLayout ? bodyFirstY + bodySpan : ruleY };
}

function buildEditorialTextSlideSvg(
  width: number,
  height: number,
  slideNumber: number,
  accent: AccentVariant,
  label: string,
  heading: string,
  body: string,
  logo: MattedLogoAsset,
  clipId: string,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_SMALL;
  const block = editorialBlock(heading, body, availableWidth, SAFE_PADDING_TOP + 80, brandIconTopY - 50, 0, label);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${infoCardBackgroundMarkup(width, height, accent)}
    ${progressMarkup(width, slideNumber)}
    ${block.markup}
    ${logoMarkup(width, height, logo, "small", clipId)}
  </svg>`;
}

const EDITORIAL_ITEM_FONT = 34;
const EDITORIAL_ITEM_LINE_HEIGHT = 42;
const EDITORIAL_ITEM_GAP = 34;

function buildEditorialChecklistSlideSvg(
  width: number,
  height: number,
  label: string,
  heading: string,
  considerations: string[],
  logo: MattedLogoAsset,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_SMALL;
  const items = considerations.slice(0, MAX_CONSIDERATIONS);
  const titleAvailableWidth = availableWidth - BADGE_SIZE - BADGE_TO_TITLE_GAP;
  const badgeCx = SAFE_PADDING_X + BADGE_SIZE / 2;
  const titleX = SAFE_PADDING_X + BADGE_SIZE + BADGE_TO_TITLE_GAP;

  const itemLayouts = items.map((title) => layoutAtSize(title, titleAvailableWidth, EDITORIAL_ITEM_FONT, 3));
  const rowHeights = itemLayouts.map((layout) => Math.max(BADGE_SIZE, layout.lines.length * EDITORIAL_ITEM_LINE_HEIGHT));
  const listHeight = rowHeights.reduce((sum, h) => sum + h, 0) + EDITORIAL_ITEM_GAP * Math.max(items.length - 1, 0);
  const listTopGap = 56;

  const block = editorialBlock(heading, undefined, availableWidth, SAFE_PADDING_TOP + 80, brandIconTopY - 50, listTopGap + listHeight, label);

  let cursor = block.bottomY + listTopGap;
  const itemsMarkup = items
    .map((_, index) => {
      const rowHeight = rowHeights[index];
      const rowCenterY = cursor + rowHeight / 2;
      cursor += rowHeight + EDITORIAL_ITEM_GAP;
      const layout = itemLayouts[index];
      const titleTspans = layout.lines
        .map((line, lineIndex) => {
          const y = rowCenterY + (lineIndex - (layout.lines.length - 1) / 2) * EDITORIAL_ITEM_LINE_HEIGHT + 11;
          return `<tspan x="${titleX}" y="${y}">${escapeXml(line)}</tspan>`;
        })
        .join("");
      return `<circle cx="${badgeCx}" cy="${rowCenterY}" r="${BADGE_SIZE / 2}" fill="url(#editorialBadgeGold)" />
      <text x="${badgeCx}" y="${rowCenterY + 7}" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${String(index + 1).padStart(2, "0")}</text>
      <text font-family="${FONT_STACK}" font-size="${EDITORIAL_ITEM_FONT}" font-weight="600" fill="#f4f4f5">${titleTspans}</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${infoCardBackgroundMarkup(width, height, ACCENT_VARIANTS["what-to-do"])}
    <defs>
      <linearGradient id="editorialBadgeGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GOLD_LIGHT}" />
        <stop offset="100%" stop-color="${GOLD_DEEP}" />
      </linearGradient>
    </defs>
    ${progressMarkup(width, 4)}
    ${block.markup}
    ${itemsMarkup}
    ${logoMarkup(width, height, logo, "small", "logoClipEditorialChecklist")}
  </svg>`;
}

// Expert closing card: heading + the closing paragraph (which carries the
// package's ONE CTA). Never a fixed second CTA.
function buildEditorialClosingSlideSvg(
  width: number,
  height: number,
  heading: string,
  closingLine: string,
  logo: MattedLogoAsset,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_LARGE;
  const block = editorialBlock(heading, closingLine, availableWidth, SAFE_PADDING_TOP + 80, brandIconTopY - 60);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="editorialClosingAccent" cx="0.5" cy="0.32" r="0.75">
        <stop offset="0%" stop-color="${GOLD_DEEP}" stop-opacity="0.22" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_NAVY}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#editorialClosingAccent)" />
    ${progressMarkup(width, 5)}
    ${block.markup}
    ${logoMarkup(width, height, logo, "large", "logoClipEditorialClosing")}
  </svg>`;
}

// --- Slide 5: Conclusion / CTA ---
// Deliberately no photo — a clean branded closing card (solid navy + a
// subtle gold accent), both for visual variety against slide 1 and
// because a closing/CTA card is a standard, expected shape for the last
// slide of a real editorial carousel. Unchanged from the original Carousel
// V1 treatment except the brand mark, per the Gold Standard brief's
// "optional controlled alternate crop/background use" — keeping this
// slide's already-approved photo-free treatment as-is is the smallest
// safe choice, and stronger brand presence (LOGO_HEIGHT_LARGE) applies
// here too.
// Carousel Final Quality: the real editorial closing paragraph (Job 2's
// CTA-slide body) runs 2-3 full sentences, not the one-liner the
// original (44,4)/(34,5) budget assumed — that combination truncated a
// real closing mid-sentence. The larger line counts below give room for
// the genuine content length; wrapTwoTier still only falls to the
// smaller tier when the larger one would truncate, so a short closing
// line still renders at the bigger, more impactful size exactly as
// before. Centering within the full zone (progress indicator to logo)
// — instead of a fixed height*0.46 — also closes the large dead-space
// gap a short closing line previously left at the bottom of the slide.
function buildClosingSlideSvg(width: number, height: number, closingLine: string, fixedCta: string | undefined, logo: MattedLogoAsset): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - LOGO_HEIGHT_LARGE;
  const zoneTop = SAFE_PADDING_TOP + 80;
  const zoneBottom = brandIconTopY - 60;

  const closingLayout = wrapTwoTier(closingLine || "", availableWidth, 42, 5, 32, 8);
  const closingSpan = (closingLayout.lines.length - 1) * closingLayout.lineHeight;
  const gapToCta = fixedCta ? 64 : 0;

  const closingFirstY = centeredFirstBaselineY(zoneTop, zoneBottom, closingSpan + gapToCta, zoneTop + 20);
  const ctaY = closingFirstY + closingSpan + 64;

  const ctaMarkup = fixedCta
    ? `<text x="${SAFE_PADDING_X}" y="${ctaY}" font-family="${FONT_STACK}" font-size="28" font-weight="700" fill="${GOLD}">${escapeXml(fixedCta)}</text>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="closingAccent" cx="0.5" cy="0.32" r="0.75">
        <stop offset="0%" stop-color="${GOLD_DEEP}" stop-opacity="0.22" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_NAVY}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#closingAccent)" />
    ${progressMarkup(width, 5)}
    <text font-family="${FONT_STACK}" font-size="${closingLayout.fontSize}" font-weight="700" fill="#f5f1e8" letter-spacing="-0.3">${tspans(closingLayout.lines, SAFE_PADDING_X, closingFirstY, closingLayout.lineHeight)}</text>
    ${ctaMarkup}
    ${logoMarkup(width, height, logo, "large", "logoClipClosing")}
  </svg>`;
}

// Renders the full 5-slide carousel: exactly 5 separate PNG buffers, each
// exactly the requested dimensionsPx (validated by renderSvgToPng itself,
// same as every other renderer in this pipeline), in deterministic slide
// order (index 0 = slide 1 / cover ... index 4 = slide 5 / closing). Only
// ONE base AI image is used — for slide 1 only; slides 2-4 render zero
// photos (information design only) and slide 5 keeps its existing
// photo-free treatment — so this makes exactly the same one paid
// image-generation call as before, never more.
export async function renderCarousel(
  baseImage: Buffer,
  dimensionsPx: string,
  slideText: CarouselSlideText,
): Promise<Buffer[]> {
  const { width, height } = parseCanvasDimensions(dimensionsPx);
  const logo = await loadMattedLogoAsset();

  const labels = {
    whatHappened: slideText.sectionLabels?.whatHappened ?? DEFAULT_SECTION_LABELS.whatHappened,
    whyItMatters: slideText.sectionLabels?.whyItMatters ?? DEFAULT_SECTION_LABELS.whyItMatters,
    considerations: slideText.sectionLabels?.considerations ?? DEFAULT_SECTION_LABELS.considerations,
  };
  // Expert/portfolio editorial layout only where a heading was supplied;
  // news content passes no headings and renders exactly as before.
  const headings = slideText.headings ?? {};

  const svgs = [
    buildCoverSlideSvg(width, height, baseImage, slideText.cover, logo),
    headings.whatHappened
      ? buildEditorialTextSlideSvg(
          width,
          height,
          2,
          ACCENT_VARIANTS["what-happened"],
          labels.whatHappened,
          headings.whatHappened,
          slideText.whatHappened,
          logo,
          "logoClipEditorialWhatHappened",
        )
      : buildWhatHappenedSlideSvg(
          width,
          height,
          slideText.whatHappened,
          slideText.keyFact,
          slideText.sourceLabel,
          logo,
          labels.whatHappened,
        ),
    headings.whyItMatters
      ? buildEditorialTextSlideSvg(
          width,
          height,
          3,
          ACCENT_VARIANTS["why-it-matters"],
          labels.whyItMatters,
          headings.whyItMatters,
          slideText.whyItMatters,
          logo,
          "logoClipEditorialWhyItMatters",
        )
      : buildWhyItMattersSlideSvg(width, height, slideText.whyItMatters, logo, labels.whyItMatters),
    headings.considerations
      ? buildEditorialChecklistSlideSvg(
          width,
          height,
          labels.considerations,
          headings.considerations,
          slideText.considerations,
          logo,
        )
      : buildConsiderationsSlideSvg(width, height, slideText.considerations, logo, labels.considerations),
    headings.closing
      ? buildEditorialClosingSlideSvg(width, height, headings.closing, slideText.closingLine, logo)
      : buildClosingSlideSvg(width, height, slideText.closingLine, slideText.fixedCta, logo),
  ];

  const buffers: Buffer[] = [];
  for (const svg of svgs) {
    buffers.push(await renderSvgToPng(svg, width, height));
  }
  return buffers;
}
