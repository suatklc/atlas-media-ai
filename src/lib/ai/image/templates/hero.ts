import sharp from "sharp";
import type { CompositionInput } from "./types";
import { FONT_STACK, escapeXml, layoutAtSize, buildBrandBadgeMarkup, parseCanvasDimensions } from "./shared";

const SAFE_PADDING_X = 64;
const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";

// Fixed pixel margin from the canvas bottom edge, same convention as
// SAFE_PADDING_X's fixed horizontal margin — not proportional to height, so
// the CTA sits a consistent distance from the edge on any canvas size.
// 1350 - 80 = 1270, the exact previous hardcoded ctaBaselineY.
const CTA_BOTTOM_MARGIN = 80;
const HEADLINE_GAP = 56; // widened slightly to give the larger CTA room to breathe

// Minimum scrim coverage as a fraction of canvas height, not a fixed pixel
// value — the previous hardcoded floor (700px) was tuned specifically for
// the 1350px-tall Instagram canvas (1350 - 700 = 650px of guaranteed
// coverage, ~48% of the canvas). Expressing it as a fraction reproduces
// that same ~48% coverage on any canvas height instead of over- or
// under-covering a shorter/taller one.
const SCRIM_MIN_COVERAGE_FRACTION = 0.48;

type HeroRenderInput = CompositionInput & {
  baseImage: Buffer;
};

type HeadlineLayout = { lines: string[]; fontSize: number; lineHeight: number };

// Two discrete size tiers, not indefinite shrinking: try the larger, more
// readable size at up to 2 lines first; only step down to the smaller size
// (up to 3 lines) if the headline doesn't fit there. Readability over fitting
// every character — a very long headline still ends in a clean ellipsis.
function wrapHeadline(rawHeadline: string, availableWidth: number): HeadlineLayout {
  const headline = (rawHeadline || "").trim() || FALLBACK_HEADLINE;

  const large = layoutAtSize(headline, availableWidth, 54, 2);
  if (!large.truncated) {
    return { lines: large.lines, fontSize: 54, lineHeight: 64 };
  }

  const small = layoutAtSize(headline, availableWidth, 44, 3);
  return { lines: small.lines, fontSize: 44, lineHeight: 54 };
}

function buildHeroOverlaySvg(
  width: number,
  height: number,
  rawHeadline: string,
  rawCta: string | undefined,
): string {
  const availableWidth = width - SAFE_PADDING_X * 2;
  const { lines, fontSize, lineHeight } = wrapHeadline(rawHeadline, availableWidth);
  const cta = (rawCta || "").trim();

  // Bottom-anchored layout: the CTA's position is constant regardless of
  // headline length; the headline block grows upward from a fixed gap above
  // it. This keeps the composition stable across 1-3 line headlines instead
  // of shifting the CTA/brand row around.
  const ctaBaselineY = height - CTA_BOTTOM_MARGIN;
  const headlineLastBaselineY = ctaBaselineY - HEADLINE_GAP;
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
    ? `<text x="${SAFE_PADDING_X}" y="${ctaBaselineY}" font-family="${FONT_STACK}" font-size="36" font-weight="700" fill="#c7d2fe">${escapeXml(cta)}</text>`
    : "";

  const brandBadgeMarkup = buildBrandBadgeMarkup(SAFE_PADDING_X, 56);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#09090b" stop-opacity="0" />
        <stop offset="100%" stop-color="#09090b" stop-opacity="0.88" />
      </linearGradient>
      <linearGradient id="brandGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="100%" stop-color="#7c3aed" />
      </linearGradient>
    </defs>

    <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#scrim)" />

    ${brandBadgeMarkup}

    <text font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700" fill="#f4f4f5" letter-spacing="-0.5">${headlineTspans}</text>

    ${ctaMarkup}
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
export async function renderHero({ baseImage, headline, cta, dimensionsPx }: HeroRenderInput): Promise<Buffer> {
  const { width, height } = parseCanvasDimensions(dimensionsPx);

  const resizedBase = await sharp(baseImage)
    .resize(width, height, {
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .toBuffer();

  const overlaySvg = buildHeroOverlaySvg(width, height, headline, cta);

  return sharp(resizedBase)
    .composite([{ input: Buffer.from(overlaySvg, "utf-8"), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
