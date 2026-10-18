import { FONT_STACK, escapeXml, layoutAtSize, parseCanvasDimensions } from "./shared";
import { buildRealLogoMarkup, GOLD, GOLD_LIGHT, GOLD_DEEP, BRAND_NAVY } from "./brand";
import { loadMattedLogoAsset, type MattedLogoAsset } from "./logoAsset";
import { buildCoverImageMarkup, renderSvgToPng } from "../resvg-renderer";

// Atlas Premium carousel — the five-page design system for EXPERT/portfolio
// content (dashboard "Instagram paylaşımı hazırla"). News packages never
// reach this file; they keep carousel.ts's renderCarousel unchanged.
//
// Design system (same chrome on every page, content changes):
//   - navy / warm gold / cream palette, Playfair Display (already bundled
//     for the brand wordmark) for headings, the sans stack for body/labels
//   - gold section label (short rule + letter-spaced caps), slide counter
//   - footer: thin gold hairline running into the real Suat Kılıç logo,
//     rendered clearly larger than the news template's logo
//   - selective gold emphasis on a short phrase of the cover and closing
//     headlines (an explicit phrase when one is set, else the last line)
// Text safety is the same as every other template: two discrete size
// tiers, word-wrapping, an ellipsis instead of overflow — never clipping.

const SLIDE_COUNT = 5;
const PAD_X = 72;
const PAD_TOP = 64;
const PAD_BOTTOM = 60;

const CREAM = "#f5f1e8";
const BODY = "#d9d3c5";
const MUTED = "#a8adb8";
const SERIF = "'Playfair Display'";
// layoutAtSize's glyph-width heuristic is tuned for the sans stack; real
// Playfair Display Bold Turkish text measured ~0.5em per character, so the
// serif budget is widened slightly (still conservative vs. the measured
// width) to avoid needlessly short headline lines.
const SERIF_WIDTH_FACTOR = 1.04;

const LOGO_COVER = 150;
const LOGO_INNER = 120;
const LOGO_CLOSING = 190;

export type PremiumCarouselText = {
  kicker: string;
  cover: { headline: string; emphasis?: string; support?: string };
  diagnosis: { label: string; headline: string; body: string };
  insight: { label: string; headline: string; body: string };
  strategy: { label: string; headline: string; items: string[] };
  closing: { label: string; headline: string; emphasis?: string; body: string; cta?: string };
};

type Layout = { lines: string[]; fontSize: number; lineHeight: number };

function wrap(
  text: string,
  width: number,
  tiers: [number, number, number, number],
  lineHeightRatio: number,
): Layout {
  const [largeSize, largeLines, smallSize, smallLines] = tiers;
  const large = layoutAtSize(text, width, largeSize, largeLines);
  if (!large.truncated) {
    return { lines: large.lines, fontSize: largeSize, lineHeight: Math.round(largeSize * lineHeightRatio) };
  }
  const small = layoutAtSize(text, width, smallSize, smallLines);
  return { lines: small.lines, fontSize: smallSize, lineHeight: Math.round(smallSize * lineHeightRatio) };
}

const normalizeWord = (word: string) => word.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]/gu, "");

// Per-line [text, isGold] segments for a wrapped headline. The gold words
// are the explicit emphasis phrase when it occurs in the headline, else the
// whole last line of a multi-line headline. Any mismatch between the
// wrapped lines and the source words (an ellipsis, a force-broken word)
// renders the headline plainly rather than guessing.
export function emphasisSegments(text: string, lines: string[], emphasis?: string): [string, boolean][][] {
  const plain = lines.map((line): [string, boolean][] => [[line, false]]);
  const words = text.split(/\s+/).filter(Boolean);
  const lineWords = lines.map((line) => line.split(/\s+/).filter(Boolean));
  if (lineWords.flat().join(" ") !== words.join(" ")) return plain;

  const gold = new Array<boolean>(words.length).fill(false);
  const target = (emphasis ?? "").split(/\s+/).map(normalizeWord).filter(Boolean);
  let matched = false;
  if (target.length > 0) {
    const normalized = words.map(normalizeWord);
    for (let start = 0; start + target.length <= normalized.length && !matched; start += 1) {
      if (target.every((word, offset) => normalized[start + offset] === word)) {
        for (let offset = 0; offset < target.length; offset += 1) gold[start + offset] = true;
        matched = true;
      }
    }
  }
  if (!matched) {
    if (lines.length < 2) return plain;
    const lastLineStart = words.length - lineWords[lineWords.length - 1].length;
    for (let index = lastLineStart; index < words.length; index += 1) gold[index] = true;
  }

  let cursor = 0;
  return lineWords.map((wordsOfLine) => {
    const segments: [string, boolean][] = [];
    for (const word of wordsOfLine) {
      const isGold = gold[cursor];
      cursor += 1;
      const last = segments[segments.length - 1];
      if (last && last[1] === isGold) last[0] = `${last[0]} ${word}`;
      else segments.push([segments.length > 0 ? ` ${word}` : word, isGold]);
    }
    return segments;
  });
}

function richText(
  layout: Layout,
  segments: [string, boolean][][],
  x: number,
  firstBaselineY: number,
  fill: string,
  goldFill: string,
): string {
  const tspans = segments
    .map((line, lineIndex) =>
      line
        .map(([text, isGold], segmentIndex) => {
          const position = segmentIndex === 0 ? ` x="${x}" y="${firstBaselineY + lineIndex * layout.lineHeight}"` : "";
          return `<tspan${position} fill="${isGold ? goldFill : fill}">${escapeXml(text)}</tspan>`;
        })
        .join(""),
    )
    .join("");
  return `<text font-family="${SERIF}" font-size="${layout.fontSize}" font-weight="700" letter-spacing="-0.3" xml:space="preserve">${tspans}</text>`;
}

function plainText(layout: Layout, x: number, firstBaselineY: number, family: string, weight: number, fill: string): string {
  const tspans = layout.lines
    .map((line, index) => `<tspan x="${x}" y="${firstBaselineY + index * layout.lineHeight}">${escapeXml(line)}</tspan>`)
    .join("");
  return `<text font-family="${family}" font-size="${layout.fontSize}" font-weight="${weight}" fill="${fill}">${tspans}</text>`;
}

function sectionLabel(y: number, label: string): string {
  return `<rect x="${PAD_X}" y="${y - 8}" width="40" height="2" fill="${GOLD}" />
    <text x="${PAD_X + 56}" y="${y}" font-family="${FONT_STACK}" font-size="22" font-weight="700" letter-spacing="3" fill="${GOLD}">${escapeXml(label.toLocaleUpperCase("tr-TR"))}</text>`;
}

function counter(width: number, slide: number): string {
  const label = `${String(slide).padStart(2, "0")} / ${String(SLIDE_COUNT).padStart(2, "0")}`;
  return `<text x="${width - PAD_X}" y="${PAD_TOP + 8}" text-anchor="end" font-family="${FONT_STACK}" font-size="20" font-weight="600" letter-spacing="2" fill="${MUTED}">${label}</text>`;
}

// Footer signature: gold hairline from the left margin into the logo.
function footer(width: number, height: number, logo: MattedLogoAsset, logoHeight: number, clipId: string): string {
  const logoTop = height - PAD_BOTTOM - logoHeight;
  const logoWidth = (logo.contentBBox.width / logo.contentBBox.height) * logoHeight;
  const lineY = logoTop + logoHeight / 2;
  const lineEnd = width - PAD_X - logoWidth - 36;
  return `<rect x="${PAD_X}" y="${lineY}" width="${Math.max(0, lineEnd - PAD_X)}" height="1.5" fill="${GOLD}" fill-opacity="0.45" />
    ${buildRealLogoMarkup(logo, width - PAD_X, logoTop, logoHeight, clipId)}`;
}

function navyBackground(width: number, height: number, id: string, cx: number, cy: number, strength = 0.2): string {
  return `<defs>
      <radialGradient id="${id}" cx="${cx}" cy="${cy}" r="0.8">
        <stop offset="0%" stop-color="${GOLD_DEEP}" stop-opacity="${strength}" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="${BRAND_NAVY}" />
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#${id})" />`;
}

// Restrained editorial accent: the page number as a large outlined serif
// numeral in the top-right corner, barely visible. Omitted whenever the
// text block starts high enough to reach it (long copy) — never overlaps.
const NUMERAL_BASELINE = PAD_TOP + 190;
const NUMERAL_CLEAR_Y = NUMERAL_BASELINE + 70;
function pageNumeral(width: number, slide: number, blockStartY: number): string {
  if (blockStartY < NUMERAL_CLEAR_Y) return "";
  return `<text x="${width - PAD_X + 6}" y="${NUMERAL_BASELINE}" text-anchor="end" font-family="${SERIF}" font-size="220" font-weight="700" fill="none" stroke="${GOLD}" stroke-opacity="0.18" stroke-width="2">${String(slide).padStart(2, "0")}</text>`;
}

function centeredStart(zoneTop: number, zoneBottom: number, blockHeight: number): number {
  return Math.max(zoneTop, zoneTop + (zoneBottom - zoneTop - blockHeight) * 0.46);
}

function serifWidth(width: number): number {
  return (width - PAD_X * 2) * SERIF_WIDTH_FACTOR;
}

// --- 1. Cover ---
function coverSvg(width: number, height: number, baseImage: Buffer, text: PremiumCarouselText, logo: MattedLogoAsset): string {
  const textWidth = width - PAD_X * 2;
  const headline = text.cover.headline || " ";
  const headlineLayout = wrap(headline, serifWidth(width), [76, 4, 62, 5], 1.1);
  const support = text.cover.support?.trim();
  const supportLayout = support ? wrap(support, textWidth, [30, 3, 26, 4], 1.38) : null;

  const blockBottom = height - PAD_BOTTOM - LOGO_COVER - 52;
  const supportFirstY = supportLayout ? blockBottom - (supportLayout.lines.length - 1) * supportLayout.lineHeight : blockBottom;
  const ruleY = supportLayout ? supportFirstY - supportLayout.fontSize - 34 : blockBottom + 30;
  const headlineLastY = supportLayout ? ruleY - 38 : blockBottom;
  const headlineFirstY = headlineLastY - (headlineLayout.lines.length - 1) * headlineLayout.lineHeight;
  const kickerY = headlineFirstY - headlineLayout.fontSize - 30;
  const scrimTop = Math.max(0, Math.min(height * 0.36, kickerY - 220));

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="premiumCoverScrim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
        <stop offset="40%" stop-color="${BRAND_NAVY}" stop-opacity="0.7" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0.95" />
      </linearGradient>
      <linearGradient id="premiumCoverTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BRAND_NAVY}" stop-opacity="0.6" />
        <stop offset="100%" stop-color="${BRAND_NAVY}" stop-opacity="0" />
      </linearGradient>
    </defs>
    ${buildCoverImageMarkup(baseImage, width, height)}
    <rect x="0" y="0" width="${width}" height="200" fill="url(#premiumCoverTop)" />
    <rect x="0" y="${scrimTop}" width="${width}" height="${height - scrimTop}" fill="url(#premiumCoverScrim)" />
    ${counter(width, 1)}
    ${sectionLabel(kickerY, text.kicker)}
    ${richText(headlineLayout, emphasisSegments(headline, headlineLayout.lines, text.cover.emphasis), PAD_X, headlineFirstY, CREAM, GOLD_LIGHT)}
    ${
      supportLayout
        ? `<rect x="${PAD_X}" y="${ruleY}" width="72" height="3" fill="${GOLD}" />
    ${plainText(supportLayout, PAD_X, supportFirstY, FONT_STACK, 500, BODY)}`
        : ""
    }
    ${footer(width, height, logo, LOGO_COVER, "premiumLogoCover")}
  </svg>`;
}

// Shared top-of-block for slides 2-4: label → serif heading → gold rule.
type HeadBlock = { markup: (startY: number) => string; height: number };
function headBlock(width: number, label: string, heading: string): HeadBlock {
  const layout = wrap(heading || " ", serifWidth(width), [70, 3, 58, 4], 1.14);
  const labelToHeading = 40 + layout.fontSize;
  const headingSpan = (layout.lines.length - 1) * layout.lineHeight;
  const ruleOffset = labelToHeading + headingSpan + 38;
  return {
    height: ruleOffset + 3,
    markup: (startY) => `${sectionLabel(startY, label)}
    ${plainText(layout, PAD_X, startY + labelToHeading, SERIF, 700, CREAM)}
    <rect x="${PAD_X}" y="${startY + ruleOffset}" width="72" height="3" fill="${GOLD}" />`,
  };
}

function splitLeadSentence(body: string): { lead: string; rest: string } {
  const sentences = body.trim().split(/(?<=[.!?…])\s+/u).filter(Boolean);
  if (sentences.length < 2) return { lead: "", rest: body.trim() };
  return { lead: sentences[0], rest: sentences.slice(1).join(" ") };
}

// --- 2. Diagnosis / 3. Expert insight ---
function textSlideSvg(
  width: number,
  height: number,
  slide: 2 | 3,
  content: { label: string; headline: string; body: string },
  logo: MattedLogoAsset,
): string {
  const head = headBlock(width, content.label, content.headline);
  const textWidth = width - PAD_X * 2;
  // Slide 3 is the expert insight: its first sentence becomes a gold serif
  // pull line, the rest supporting body — structure, not one paragraph.
  const { lead, rest } = slide === 3 ? splitLeadSentence(content.body) : { lead: "", rest: content.body };
  const leadLayout = lead ? wrap(lead, serifWidth(width), [42, 4, 36, 5], 1.3) : null;
  const barIndent = slide === 2 ? 30 : 0;
  const bodyLayout = rest ? wrap(rest, textWidth - barIndent, [36, 7, 32, 9], 1.42) : null;

  const headToText = 64;
  const leadHeight = leadLayout ? (leadLayout.lines.length - 1) * leadLayout.lineHeight + leadLayout.fontSize : 0;
  const leadToBody = leadLayout && bodyLayout ? 34 : 0;
  const bodyHeight = bodyLayout ? (bodyLayout.lines.length - 1) * bodyLayout.lineHeight + bodyLayout.fontSize : 0;
  const blockHeight = head.height + headToText + leadHeight + leadToBody + bodyHeight;

  const zoneTop = PAD_TOP + 150;
  const zoneBottom = height - PAD_BOTTOM - LOGO_INNER - 56;
  const startY = centeredStart(zoneTop, zoneBottom, blockHeight);
  const leadFirstY = startY + head.height + headToText + (leadLayout ? leadLayout.fontSize * 0.8 : 0);
  const bodyTop = startY + head.height + headToText + leadHeight + leadToBody;
  const bodyFirstY = bodyTop + (bodyLayout ? bodyLayout.fontSize * 0.8 : 0);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${navyBackground(width, height, `premiumBg${slide}`, slide === 2 ? 0.9 : 0.1, slide === 2 ? 0.05 : 0.9)}
    ${pageNumeral(width, slide, startY)}
    ${counter(width, slide)}
    ${head.markup(startY)}
    ${leadLayout ? plainText(leadLayout, PAD_X, leadFirstY, SERIF, 700, GOLD_LIGHT) : ""}
    ${
      bodyLayout && barIndent
        ? `<rect x="${PAD_X}" y="${bodyTop - 6}" width="3" height="${bodyHeight + 12}" fill="${GOLD}" fill-opacity="0.7" />`
        : ""
    }
    ${bodyLayout ? plainText(bodyLayout, PAD_X + barIndent, bodyFirstY, FONT_STACK, 500, BODY) : ""}
    ${footer(width, height, logo, LOGO_INNER, `premiumLogo${slide}`)}
  </svg>`;
}

// --- 4. Strategy checklist ---
const MAX_ITEMS = 4;
function strategySvg(width: number, height: number, content: PremiumCarouselText["strategy"], logo: MattedLogoAsset): string {
  const head = headBlock(width, content.label, content.headline);
  const items = content.items.filter((item) => item.trim()).slice(0, MAX_ITEMS);
  const numberColumn = 96;
  const itemWidth = width - PAD_X * 2 - numberColumn;
  const itemLayouts = items.map((item) => wrap(item, itemWidth, [33, 2, 29, 3], 1.3));
  const rowPadding = 26;
  const rowHeights = itemLayouts.map((layout) => (layout.lines.length - 1) * layout.lineHeight + layout.fontSize + rowPadding * 2);
  const listHeight = rowHeights.reduce((sum, h) => sum + h, 0);
  const headToList = 40;
  const blockHeight = head.height + headToList + listHeight;

  const zoneTop = PAD_TOP + 150;
  const zoneBottom = height - PAD_BOTTOM - LOGO_INNER - 56;
  const startY = centeredStart(zoneTop, zoneBottom, blockHeight);

  let cursor = startY + head.height + headToList;
  const rows = itemLayouts
    .map((layout, index) => {
      const rowTop = cursor;
      cursor += rowHeights[index];
      const textHeight = (layout.lines.length - 1) * layout.lineHeight + layout.fontSize;
      const firstY = rowTop + rowPadding + layout.fontSize * 0.82;
      const numberY = rowTop + rowPadding + textHeight / 2 + 15;
      const divider =
        index < itemLayouts.length - 1
          ? `<rect x="${PAD_X}" y="${cursor}" width="${width - PAD_X * 2}" height="1" fill="${GOLD}" fill-opacity="0.28" />`
          : "";
      return `<text x="${PAD_X}" y="${numberY}" font-family="${SERIF}" font-size="44" font-weight="700" fill="${GOLD}">${String(index + 1).padStart(2, "0")}</text>
    ${plainText(layout, PAD_X + numberColumn, firstY, FONT_STACK, 600, CREAM)}
    ${divider}`;
    })
    .join("");

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${navyBackground(width, height, "premiumBg4", 0.5, 0.0)}
    ${pageNumeral(width, 4, startY)}
    ${counter(width, 4)}
    ${head.markup(startY)}
    ${rows}
    ${footer(width, height, logo, LOGO_INNER, "premiumLogo4")}
  </svg>`;
}

// --- 5. Closing / CTA ---
function closingSvg(width: number, height: number, content: PremiumCarouselText["closing"], logo: MattedLogoAsset): string {
  const textWidth = width - PAD_X * 2;
  const headline = content.headline || " ";
  const headlineLayout = wrap(headline, serifWidth(width), [74, 4, 60, 5], 1.12);
  const bodyLayout = content.body.trim() ? wrap(content.body.trim(), textWidth, [33, 6, 29, 8], 1.42) : null;
  const cta = content.cta?.trim();
  const ctaPadX = 32;
  const ctaLayout = cta ? wrap(cta, textWidth - ctaPadX * 2, [30, 2, 26, 3], 1.3) : null;

  const labelToHeading = 44 + headlineLayout.fontSize;
  const headlineSpan = (headlineLayout.lines.length - 1) * headlineLayout.lineHeight;
  const ruleOffset = labelToHeading + headlineSpan + 40;
  const bodyTopOffset = ruleOffset + 3 + 56;
  const bodyHeight = bodyLayout ? (bodyLayout.lines.length - 1) * bodyLayout.lineHeight + bodyLayout.fontSize : 0;
  const ctaTextHeight = ctaLayout ? (ctaLayout.lines.length - 1) * ctaLayout.lineHeight + ctaLayout.fontSize : 0;
  const ctaBoxHeight = ctaLayout ? ctaTextHeight + 44 : 0;
  const ctaTopOffset = bodyTopOffset + bodyHeight + (ctaLayout ? 52 : 0);
  const blockHeight = ctaTopOffset + ctaBoxHeight;

  const zoneTop = PAD_TOP + 150;
  const zoneBottom = height - PAD_BOTTOM - LOGO_CLOSING - 56;
  const startY = centeredStart(zoneTop, zoneBottom, blockHeight);

  const longestCtaLine = ctaLayout ? Math.max(...ctaLayout.lines.map((line) => line.length)) : 0;
  const ctaBoxWidth = ctaLayout
    ? Math.min(textWidth, Math.round(longestCtaLine * ctaLayout.fontSize * 0.56) + ctaPadX * 2)
    : 0;

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    ${navyBackground(width, height, "premiumBg5", 0.5, 0.3, 0.26)}
    ${counter(width, 5)}
    ${sectionLabel(startY, content.label)}
    ${richText(headlineLayout, emphasisSegments(headline, headlineLayout.lines, content.emphasis), PAD_X, startY + labelToHeading, CREAM, GOLD_LIGHT)}
    <rect x="${PAD_X}" y="${startY + ruleOffset}" width="72" height="3" fill="${GOLD}" />
    ${bodyLayout ? plainText(bodyLayout, PAD_X, startY + bodyTopOffset + bodyLayout.fontSize * 0.8, FONT_STACK, 500, BODY) : ""}
    ${
      ctaLayout
        ? `<rect x="${PAD_X}" y="${startY + ctaTopOffset}" width="${ctaBoxWidth}" height="${ctaBoxHeight}" rx="4" fill="${GOLD}" fill-opacity="0.08" stroke="${GOLD}" stroke-width="1.5" />
    ${plainText(ctaLayout, PAD_X + ctaPadX, startY + ctaTopOffset + 22 + ctaLayout.fontSize * 0.8, FONT_STACK, 600, GOLD_LIGHT)}`
        : ""
    }
    ${footer(width, height, logo, LOGO_CLOSING, "premiumLogo5")}
  </svg>`;
}

// Same contract as renderCarousel: exactly five PNG buffers in slide order,
// the one base image used for the cover only.
export async function renderPremiumCarousel(baseImage: Buffer, dimensionsPx: string, text: PremiumCarouselText): Promise<Buffer[]> {
  const { width, height } = parseCanvasDimensions(dimensionsPx);
  const logo = await loadMattedLogoAsset();
  const svgs = [
    coverSvg(width, height, baseImage, text, logo),
    textSlideSvg(width, height, 2, text.diagnosis, logo),
    textSlideSvg(width, height, 3, text.insight, logo),
    strategySvg(width, height, text.strategy, logo),
    closingSvg(width, height, text.closing, logo),
  ];
  const buffers: Buffer[] = [];
  for (const svg of svgs) {
    buffers.push(await renderSvgToPng(svg, width, height));
  }
  return buffers;
}
