import { FONT_STACK, escapeXml } from "./shared";

// Deterministic, reusable Suat Kılıç brand mark for customer-facing
// generated visuals — replaces the previous "Atlas AI" placeholder badge
// (shared.ts's old buildBrandBadgeMarkup, now removed). Atlas is the
// product generating this content; it is not the personal/agency brand
// that belongs on the published post, so nothing here ever renders the
// word "Atlas" — see hero.ts/educational.ts for the only call sites.
//
// Deliberately NOT AI-generated per-post: a brand mark must be pixel-
// identical across every single post, which only a deterministic SVG
// asset guarantees. Built as one parameterized function (variant + tone)
// rather than three near-duplicate ones, so it stays a single reusable
// component rather than copy-pasted markup — the seam a future account/
// tenant-configurable branding layer would extend (BRAND_NAME/
// BRAND_DESCRIPTOR/colors becoming per-tenant inputs instead of module
// constants) without needing to touch hero.ts/educational.ts again.

export const BRAND_NAME = "SUAT KILIÇ";
export const BRAND_DESCRIPTOR = "GAYRİMENKUL YATIRIM DANIŞMANLIĞI";

// "Elegant high-contrast serif typography" for the name — Playfair
// Display is a genuine high-contrast display serif (thick/thin stroke
// contrast), loaded into the renderer alongside Inter (see
// ../resvg-renderer.ts). Referenced directly by its own family name;
// FONT_STACK (Inter, via sansSerifFamily) still covers the descriptor and
// every other on-image text element.
const SERIF_FONT_FAMILY = "'Playfair Display'";

// Warm metallic gold — the brand's primary accent. A flat fill/stroke
// color (not a gradient) for the icon's thin lines and the descriptor,
// since a gradient doesn't read cleanly at 1.4px stroke widths; a subtle
// two-stop gradient is used only for the larger "SUAT KILIÇ" wordmark
// text, where it's actually visible enough to register as "metallic"
// rather than muddy.
// Exported (not just module-local) so other on-image accent elements that
// aren't part of the brand mark itself — e.g. educational.ts's numbered
// point badges — can stay visually consistent with the brand's own gold
// rather than an unrelated color.
export const GOLD = "#c9a568";
export const GOLD_LIGHT = "#e8cf9e";
export const GOLD_DEEP = "#a9793e";
// Deep navy — not used by the compact mark itself (no background chip;
// see the "avoid boxy/UI-looking elements" note below), but exported for
// a future full-lockup/solid-panel context (e.g. a carousel cover slide)
// that wants the brand's own background color rather than a photo scrim.
export const BRAND_NAVY = "#0a1a2f";
const OFF_WHITE = "#f5f1e8";

export type BrandMarkVariant = "compact" | "full";
// "gold" is the default brand tone; "light" is a flat off-white
// monochrome fallback for a scrim/background too warm or busy for gold to
// stay legible against.
export type BrandMarkTone = "gold" | "light";
// "left" (default) is the original icon-then-text lockup, anchored by its
// own left edge — used as-is by educational.ts's top placement. "right" is
// a mirrored lockup (text-then-icon, reading order unchanged) anchored by
// its own RIGHT edge, for a corner placement where the mark's right edge
// must land at a fixed safe margin regardless of "SUAT KILIÇ"'s rendered
// text width — used by hero.ts's bottom-right placement. Achieved with
// SVG's own text-anchor="end" rather than estimating text width.
export type BrandMarkAlign = "left" | "right";

// Splice into the enclosing <svg>'s own <defs> block — the caller's
// responsibility, same pattern hero.ts/educational.ts already use for
// their own scrim gradients. One brand mark per document today, so no
// duplicate-id guard is needed; if a future caller ever placed two marks
// in the same document, a repeated identical id is harmless (SVG uses the
// last/any matching definition either way).
function goldGradientDefsMarkup(): string {
  return `<linearGradient id="brandGoldWordmark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${GOLD_LIGHT}" />
      <stop offset="100%" stop-color="${GOLD_DEEP}" />
    </linearGradient>`;
}

// Minimal geometric villa/building line icon: a gable roofline over a
// rectangular body with a 2x2 grid of four window squares — stroke only,
// no fill, per the "line symbol" brief. Drawn in a fixed 36x36 local box,
// then translated to (x, y) via a <g transform>, so callers never need to
// know its internal coordinate math.
function buildVillaIconMarkup(strokeColor: string): string {
  return `<g stroke="${strokeColor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" fill="none">
      <path d="M3,17 L18,4 L33,17" />
      <rect x="7" y="17" width="22" height="16" />
      <rect x="10.5" y="21" width="4.5" height="4.5" />
      <rect x="21" y="21" width="4.5" height="4.5" />
      <rect x="10.5" y="27.5" width="4.5" height="4.5" />
      <rect x="21" y="27.5" width="4.5" height="4.5" />
    </g>`;
}

type BrandColors = { icon: string; name: string; nameIsGradient: boolean; descriptor: string };

function resolveColors(tone: BrandMarkTone): BrandColors {
  if (tone === "light") {
    return { icon: OFF_WHITE, name: OFF_WHITE, nameIsGradient: false, descriptor: OFF_WHITE };
  }
  return { icon: GOLD, name: "url(#brandGoldWordmark)", nameIsGradient: true, descriptor: GOLD };
}

// Left-aligned lockup — educational.ts's top placement, unchanged since
// its introduction: icon at the given left edge, the two-line wordmark
// (name + descriptor) beside it, vertically centered against the icon.
// Deliberately no background chip/rounded-rect panel behind it (unlike
// the old Atlas AI badge) — the existing scrim already provides contrast,
// and a boxed badge reads as an app UI element rather than a logo lockup
// sitting naturally on the image, which the brand's editorial/premium
// standard calls for.
function buildCompactLeftMarkup(x: number, y: number, colors: BrandColors): string {
  const iconSize = 36;
  const textX = x + iconSize + 14;
  const nameBaselineY = y + 17;
  const descriptorBaselineY = y + 31;

  return `<g transform="translate(${x}, ${y})">${buildVillaIconMarkup(colors.icon)}</g>
    <text x="${textX}" y="${nameBaselineY}" font-family="${SERIF_FONT_FAMILY}" font-size="21" font-weight="700" letter-spacing="0.5" fill="${colors.name}">${escapeXml(BRAND_NAME)}</text>
    <text x="${textX}" y="${descriptorBaselineY}" font-family="${FONT_STACK}" font-size="11" font-weight="600" letter-spacing="0.8" fill="${colors.descriptor}">${escapeXml(BRAND_DESCRIPTOR)}</text>`;
}

// Right-aligned lockup — hero.ts's bottom-right corner placement. `x` is
// the mark's own RIGHT edge (the icon's right edge lands exactly there);
// the wordmark sits to the icon's left with text-anchor="end", so it
// grows leftward from a fixed point regardless of "SUAT KILIÇ"'s actual
// rendered width — no text-width estimation needed. Name only, no
// descriptor: at this compact corner size a second, smaller line reads as
// clutter rather than an understated signature, and the task's own brand
// hierarchy for this placement is icon + name only. `y` is still the
// icon's own top edge, same convention as the left-aligned variant, so
// the caller's own bottom-anchored math (icon height, safe margins) stays
// in one place (hero.ts) rather than duplicated here.
function buildCompactRightMarkup(x: number, y: number, colors: BrandColors): string {
  // 36, not a smaller number: buildVillaIconMarkup always draws in its
  // fixed 36x36 local box (no scale transform applied here, unlike
  // buildFullMarkup) — using any other value here would silently misalign
  // the icon's actual right edge from the intended safe-margin position x.
  const iconSize = 36;
  const iconLeft = x - iconSize;
  const textRightX = iconLeft - 14;
  const nameBaselineY = y + 23;

  return `<g transform="translate(${iconLeft}, ${y})">${buildVillaIconMarkup(colors.icon)}</g>
    <text x="${textRightX}" y="${nameBaselineY}" text-anchor="end" font-family="${SERIF_FONT_FAMILY}" font-size="24" font-weight="700" letter-spacing="0.3" fill="${colors.name}">${escapeXml(BRAND_NAME)}</text>`;
}

// Larger, more spaced-out lockup (icon above the wordmark, centered) for a
// future full-format placement — a carousel cover slide, a standalone
// brand card, etc. Not called by any current renderer; implemented now so
// the "full logo lockup" requirement is satisfied as a real, reusable
// component rather than deferred entirely.
function buildFullMarkup(x: number, y: number, colors: BrandColors): string {
  const iconSize = 56;
  const iconX = x + 60 - iconSize / 2;
  const nameY = y + iconSize + 34;
  const descriptorY = y + iconSize + 58;
  const centerX = x + 60;

  return `<g transform="translate(${iconX}, ${y}) scale(${iconSize / 36})">${buildVillaIconMarkup(colors.icon)}</g>
    <text x="${centerX}" y="${nameY}" text-anchor="middle" font-family="${SERIF_FONT_FAMILY}" font-size="32" font-weight="700" letter-spacing="0.5" fill="${colors.name}">${escapeXml(BRAND_NAME)}</text>
    <text x="${centerX}" y="${descriptorY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="14" font-weight="600" letter-spacing="1.2" fill="${colors.descriptor}">${escapeXml(BRAND_DESCRIPTOR)}</text>`;
}

export type BrandMarkResult = { defs: string; markup: string };

// Returns both the <defs> fragment (gradient definition, only when the
// gold tone actually needs one — the caller splices this into their own
// <defs> block, exactly as the old buildBrandBadgeMarkup's callers already
// did for "brandGradient") and the visible markup.
export function buildBrandMark(
  x: number,
  y: number,
  variant: BrandMarkVariant = "compact",
  tone: BrandMarkTone = "gold",
  align: BrandMarkAlign = "left",
): BrandMarkResult {
  const colors = resolveColors(tone);
  const defs = colors.nameIsGradient ? goldGradientDefsMarkup() : "";
  const markup =
    variant === "full"
      ? buildFullMarkup(x, y, colors)
      : align === "right"
        ? buildCompactRightMarkup(x, y, colors)
        : buildCompactLeftMarkup(x, y, colors);
  return { defs, markup };
}
