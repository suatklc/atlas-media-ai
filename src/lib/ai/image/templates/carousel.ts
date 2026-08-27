import { FONT_STACK, escapeXml, layoutAtSize, parseCanvasDimensions } from "./shared";
import { buildBrandMark, GOLD, GOLD_LIGHT, GOLD_DEEP, BRAND_NAVY } from "./brand";
import { buildCoverImageMarkup, buildPannedCoverImageMarkup, renderSvgToPng } from "../resvg-renderer";

// Real Multi-Slide Carousel: a NEW, independent renderer — hero.ts and
// educational.ts are neither imported from nor modified by this file. It
// reuses only the same shared, already-proven primitives every other
// template reuses (shared.ts's layout/escaping, brand.ts's brand mark,
// resvg-renderer.ts's SVG->PNG pipeline), so the brand system and text
// safety behavior stay identical to the rest of the product.
//
// Deliberately ONE generated AI image for the whole carousel: slides 1-4
// reuse it with a different pan/zoom crop + scrim per slide (editorial
// detail-shot variation, not five unrelated photos); slide 5 is a clean
// branded closing card with no photo at all. This is what keeps carousel
// generation to the same one paid image-generation call the single-image
// path already makes.

const SAFE_PADDING_X = 64;
const SAFE_PADDING_TOP = 56;
const SAFE_PADDING_BOTTOM = 64;
const BRAND_ICON_SIZE = 48;
const SLIDE_COUNT = 5;

export type CarouselSlideText = {
  cover: string;
  whatHappened: string;
  whyItMatters: string;
  considerations: string[];
  closingLine: string;
  fixedCta?: string;
  sourceLabel?: string;
};

function brandMarkup(width: number, height: number) {
  const iconTopY = height - SAFE_PADDING_BOTTOM - BRAND_ICON_SIZE;
  return buildBrandMark(width - SAFE_PADDING_X, iconTopY, "compact", "gold", "right");
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

// Full-height scrim used by the three content slides (2-4): text can sit
// anywhere from just below the top padding to the bottom brand row, so
// contrast is guaranteed top-to-bottom regardless of the photo's own
// brightness or the pan/zoom window chosen for that slide — deterministic
// legibility over a more atmospheric (but riskier) partial gradient.
function contentScrimMarkup(width: number, height: number): string {
  return `<defs>
      <linearGradient id="slideScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0.42" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="0.80" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#slideScrim)" />`;
}

function labelMarkup(x: number, y: number, label: string): string {
  return `<text x="${x}" y="${y}" font-family="${FONT_STACK}" font-size="22" font-weight="700" letter-spacing="2" fill="${GOLD}">${escapeXml(label.toLocaleUpperCase("tr-TR"))}</text>`;
}

// --- Slide 1: Cover ---
// Full, unpanned cover crop (zoom 1) for maximum visual impact; bottom-up
// scrim + headline, same safe-region stacking principle hero.ts uses (each
// element in its own row, brand anchored first) — independently
// implemented here so hero.ts itself is never touched.
function buildCoverSlideSvg(width: number, height: number, baseImage: Buffer, headline: string): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const { lines, fontSize, lineHeight } = wrapTwoTier(headline || "Gayrimenkul İçeriği", availableWidth, 56, 3, 44, 4);
  const brand = brandMarkup(width, height);
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - BRAND_ICON_SIZE;
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
      ${brand.defs}
    </defs>
    ${buildCoverImageMarkup(baseImage, width, height)}
    <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#coverScrim)" />
    ${progressMarkup(width, 1)}
    <text font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" fill="#f4f4f5" letter-spacing="-0.5">${tspans(lines, SAFE_PADDING_X, headlineFirstBaselineY, lineHeight)}</text>
    ${brand.markup}
  </svg>`;
}

// --- Slides 2 & 3: What happened / Why it matters ---
// Same structural template for both — only the pan/zoom window, label, and
// body copy differ, which is exactly the "controlled crop variation from
// one asset" the carousel spec asked for.
function buildBodySlideSvg(
  width: number,
  height: number,
  baseImage: Buffer,
  slideNumber: number,
  label: string,
  body: string,
  zoom: number,
  anchorX: number,
  anchorY: number,
  sourceLabel: string | undefined,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const labelY = SAFE_PADDING_TOP + 140;
  const bodyLayout = wrapTwoTier(body || "", availableWidth, 34, 6, 28, 8);
  const bodyFirstY = labelY + 56;
  const brand = brandMarkup(width, height);
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - BRAND_ICON_SIZE;

  const sourceMarkup = sourceLabel
    ? `<text x="${SAFE_PADDING_X}" y="${brandIconTopY + BRAND_ICON_SIZE / 2 + 6}" font-family="${FONT_STACK}" font-size="20" font-weight="500" fill="#a1a1aa">${escapeXml(sourceLabel)}</text>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>${brand.defs}</defs>
    ${buildPannedCoverImageMarkup(baseImage, width, height, zoom, anchorX, anchorY)}
    ${contentScrimMarkup(width, height)}
    ${progressMarkup(width, slideNumber)}
    ${labelMarkup(SAFE_PADDING_X, labelY, label)}
    <text font-family="${FONT_STACK}" font-size="${bodyLayout.fontSize}" font-weight="600" fill="#f4f4f5">${tspans(bodyLayout.lines, SAFE_PADDING_X, bodyFirstY, bodyLayout.lineHeight)}</text>
    ${sourceMarkup}
    ${brand.markup}
  </svg>`;
}

// --- Slide 4: Considerations ---
// Same numbered-badge visual language as educational.ts's point list
// (circular gold badge + bold title), independently reimplemented here
// since that renderer's own builder isn't exported — kept visually
// consistent (same gold gradient, same FONT_STACK) without importing from
// or modifying educational.ts.
const MAX_CONSIDERATIONS = 4;
const BADGE_SIZE = 46;
const BADGE_TO_TITLE_GAP = 18;

function buildConsiderationsSlideSvg(
  width: number,
  height: number,
  baseImage: Buffer,
  considerations: string[],
  zoom: number,
  anchorX: number,
  anchorY: number,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const labelY = SAFE_PADDING_TOP + 140;
  const items = considerations.slice(0, MAX_CONSIDERATIONS);
  const brand = brandMarkup(width, height);
  const brandIconTopY = height - SAFE_PADDING_BOTTOM - BRAND_ICON_SIZE;

  const zoneTop = labelY + 60;
  const zoneBottom = brandIconTopY - 40;
  const zoneHeight = Math.max(zoneBottom - zoneTop, 1);
  const rowSpacing = items.length > 0 ? zoneHeight / items.length : 0;
  const titleAvailableWidth = availableWidth - BADGE_SIZE - BADGE_TO_TITLE_GAP;
  const badgeCx = SAFE_PADDING_X + BADGE_SIZE / 2;
  const titleX = SAFE_PADDING_X + BADGE_SIZE + BADGE_TO_TITLE_GAP;

  const itemsMarkup = items
    .map((title, index) => {
      const rowCenterY = zoneTop + rowSpacing * (index + 0.5);
      const titleLayout = layoutAtSize(title, titleAvailableWidth, 34, 2);
      const numberLabel = String(index + 1).padStart(2, "0");
      const titleTspans = titleLayout.lines
        .map((line, lineIndex) => {
          const y = rowCenterY + (lineIndex - (titleLayout.lines.length - 1) / 2) * 40;
          return `<tspan x="${titleX}" y="${y}">${escapeXml(line)}</tspan>`;
        })
        .join("");

      return `<circle cx="${badgeCx}" cy="${rowCenterY}" r="${BADGE_SIZE / 2}" fill="url(#carouselBadgeGold)" />
      <text x="${badgeCx}" y="${rowCenterY + 7}" font-family="${FONT_STACK}" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle">${numberLabel}</text>
      <text font-family="${FONT_STACK}" font-size="34" font-weight="700" fill="#f4f4f5">${titleTspans}</text>`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="carouselBadgeGold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${GOLD_LIGHT}" />
        <stop offset="100%" stop-color="${GOLD_DEEP}" />
      </linearGradient>
      ${brand.defs}
    </defs>
    ${buildPannedCoverImageMarkup(baseImage, width, height, zoom, anchorX, anchorY)}
    ${contentScrimMarkup(width, height)}
    ${progressMarkup(width, 4)}
    ${labelMarkup(SAFE_PADDING_X, labelY, "Nelere Dikkat Etmeli?")}
    ${itemsMarkup}
    ${brand.markup}
  </svg>`;
}

// --- Slide 5: Conclusion / CTA ---
// Deliberately no photo — a clean branded closing card (solid navy + a
// subtle gold accent), both for visual variety against slides 1-4 and
// because a closing/CTA card is a standard, expected shape for the last
// slide of a real editorial carousel.
function buildClosingSlideSvg(
  width: number,
  height: number,
  closingLine: string,
  fixedCta: string | undefined,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const closingLayout = wrapTwoTier(closingLine || "", availableWidth, 44, 4, 34, 5);
  const centerY = height * 0.46;
  const closingFirstY = centerY - ((closingLayout.lines.length - 1) * closingLayout.lineHeight) / 2;
  const ctaY = centerY + ((closingLayout.lines.length - 1) * closingLayout.lineHeight) / 2 + 64;
  const brand = brandMarkup(width, height);

  const ctaMarkup = fixedCta
    ? `<text x="${SAFE_PADDING_X}" y="${ctaY}" font-family="${FONT_STACK}" font-size="28" font-weight="700" fill="${GOLD}">${escapeXml(fixedCta)}</text>`
    : "";

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="closingAccent" cx="0.5" cy="0.32" r="0.75">
        <stop offset="0%" stop-color="${GOLD_DEEP}" stop-opacity="0.22" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </radialGradient>
      ${brand.defs}
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_NAVY}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#closingAccent)" />
    ${progressMarkup(width, 5)}
    <text font-family="${FONT_STACK}" font-size="${closingLayout.fontSize}" font-weight="700" fill="#f5f1e8" letter-spacing="-0.3">${tspans(closingLayout.lines, SAFE_PADDING_X, closingFirstY, closingLayout.lineHeight)}</text>
    ${ctaMarkup}
    ${brand.markup}
  </svg>`;
}

// Deterministic pan/zoom windows for slides 2-4 — different enough that
// three crops of the same photo don't read as duplicated, conservative
// enough (max 1.2x) that the source photo's own subject stays recognizable
// in every crop.
const SLIDE_2_CROP = { zoom: 1.18, anchorX: 0.15, anchorY: 0.2 };
const SLIDE_3_CROP = { zoom: 1.18, anchorX: 0.85, anchorY: 0.75 };
const SLIDE_4_CROP = { zoom: 1.14, anchorX: 0.5, anchorY: 0.05 };

// Renders the full 5-slide carousel: exactly 5 separate PNG buffers, each
// exactly the requested dimensionsPx (validated by renderSvgToPng itself,
// same as every other renderer in this pipeline), in deterministic slide
// order (index 0 = slide 1 / cover ... index 4 = slide 5 / closing).
export async function renderCarousel(
  baseImage: Buffer,
  dimensionsPx: string,
  slideText: CarouselSlideText,
): Promise<Buffer[]> {
  const { width, height } = parseCanvasDimensions(dimensionsPx);

  const svgs = [
    buildCoverSlideSvg(width, height, baseImage, slideText.cover),
    buildBodySlideSvg(
      width,
      height,
      baseImage,
      2,
      "Ne Oldu?",
      slideText.whatHappened,
      SLIDE_2_CROP.zoom,
      SLIDE_2_CROP.anchorX,
      SLIDE_2_CROP.anchorY,
      slideText.sourceLabel,
    ),
    buildBodySlideSvg(
      width,
      height,
      baseImage,
      3,
      "Neden Önemli?",
      slideText.whyItMatters,
      SLIDE_3_CROP.zoom,
      SLIDE_3_CROP.anchorX,
      SLIDE_3_CROP.anchorY,
      undefined,
    ),
    buildConsiderationsSlideSvg(
      width,
      height,
      baseImage,
      slideText.considerations,
      SLIDE_4_CROP.zoom,
      SLIDE_4_CROP.anchorX,
      SLIDE_4_CROP.anchorY,
    ),
    buildClosingSlideSvg(width, height, slideText.closingLine, slideText.fixedCta),
  ];

  const buffers: Buffer[] = [];
  for (const svg of svgs) {
    buffers.push(await renderSvgToPng(svg, width, height));
  }
  return buffers;
}
