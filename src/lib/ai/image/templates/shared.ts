// Deterministic, template-agnostic rendering primitives shared across
// visual templates. No template-specific sizing/positioning here — each
// template owns its own tuned constants (e.g. hero.ts's 54px/44px tiers).

export const FONT_STACK = "'Segoe UI', Arial, sans-serif";

const DEFAULT_CANVAS_WIDTH = 1080;
const DEFAULT_CANVAS_HEIGHT = 1350;

// Safe, deterministic parse of "WIDTHxHEIGHT" (e.g. "1080x1080",
// "1080x1350") — falls back to the current 4:5 default on anything
// malformed, mirroring the defensive-fallback style used throughout this
// pipeline (sanitizeHeadline, selectVisualTemplateId, etc). Moved here from
// educational.ts (which already used it) so hero.ts can share the identical
// parsing logic instead of a second, duplicate copy — every renderer that
// needs its own actual canvas size uses this same function.
export function parseCanvasDimensions(dimensionsPx: string): { width: number; height: number } {
  const match = /^(\d+)x(\d+)$/.exec((dimensionsPx || "").trim());
  if (!match) {
    return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
  }
  return { width, height };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Greedy word-wrap at a given character-per-line budget. Never breaks a
// word except as a last resort for a single token longer than one whole
// line (rare for real headlines, but must never crash or overflow).
function wrapWords(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      if (current) {
        lines.push(current);
        current = "";
      }
      let remaining = word;
      while (remaining.length > maxCharsPerLine) {
        lines.push(remaining.slice(0, maxCharsPerLine));
        remaining = remaining.slice(maxCharsPerLine);
      }
      current = remaining;
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

export function layoutAtSize(
  text: string,
  availableWidth: number,
  fontSize: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  // Heuristic average glyph width — no real font-metrics engine available,
  // and none needed: this only has to avoid overflow, not be pixel-exact.
  const maxCharsPerLine = Math.max(6, Math.floor(availableWidth / (fontSize * 0.56)));
  const allLines = wrapWords(text, maxCharsPerLine);

  if (allLines.length <= maxLines) {
    return { lines: allLines, truncated: false };
  }

  const lines = allLines.slice(0, maxLines);
  const last = lines[maxLines - 1].replace(/[.,;:]+$/, "").trimEnd();
  lines[maxLines - 1] = `${last}…`;
  return { lines, truncated: true };
}

// Temporary MVP identity only — there is no real agent/brokerage logo asset
// in the repo yet. Deliberately a plain text/SVG badge, not a generated or
// invented logo file; expected to be replaced by real agent branding later.
const BRAND_LABEL = "Atlas AI";

// Verbatim current badge markup, parameterized only by its anchor position —
// every visual template is expected to reuse this identical badge per the
// Package 5 audit's branding recommendation ("reuse it unchanged across all
// 3 templates for consistency"). Callers must ensure their enclosing SVG
// defines a "brandGradient" linearGradient in its own <defs>, exactly as
// hero.ts's overlay already does.
export function buildBrandBadgeMarkup(x: number, y: number): string {
  const brandBadgeSize = 40;
  const brandChipPaddingX = 10;
  const brandChipPaddingY = 8;
  const brandTextGap = 12;
  const brandTextWidthEstimate = 112;
  const brandChipWidth = brandBadgeSize + brandTextGap + brandTextWidthEstimate + brandChipPaddingX * 2;

  return `<rect x="${x - brandChipPaddingX}" y="${y - brandChipPaddingY}" width="${brandChipWidth}" height="${brandBadgeSize + brandChipPaddingY * 2}" rx="10" fill="#09090b" fill-opacity="0.5" />
    <rect x="${x}" y="${y}" width="${brandBadgeSize}" height="${brandBadgeSize}" rx="8" fill="url(#brandGradient)" />
    <text x="${x + brandBadgeSize / 2}" y="${y + brandBadgeSize / 2 + 7}" font-family="${FONT_STACK}" font-size="20" font-weight="700" fill="#ffffff" text-anchor="middle">A</text>
    <text x="${x + brandBadgeSize + brandTextGap}" y="${y + brandBadgeSize / 2 + 7}" font-family="${FONT_STACK}" font-size="23" font-weight="600" letter-spacing="0.3" fill="#f4f4f5">${escapeXml(BRAND_LABEL)}</text>`;
}
