import type { ContentIntent } from "./types";
import { extractEducationalPoints } from "../creative/caption";

// Package 5C: mirrors the marker extractor's own cap (creative/caption.ts)
// and the educational renderer's own per-aspect-ratio point limit — this is
// a coarse anti-abuse sanity bound on untrusted client input, not the
// primary text-fitting mechanism (that's educational.ts's own
// layoutAtSize-based truncation).
const MAX_EDUCATIONAL_POINTS = 5;
const MAX_EDUCATIONAL_POINT_LENGTH = 200;
const MAX_ASSISTANT_RESPONSE_LENGTH = 20000;

// Client-supplied — untrusted. Accepts only an array of plain strings;
// never objects/HTML/SVG (each accepted entry becomes exactly one <text>
// title string via educational.ts's own escapeXml + layoutAtSize, so this
// is a coarse sanity bound, not a rendering mechanism). Trims, discards
// empty entries, caps count and per-item length. Returns [] (not an error)
// for anything malformed — educational.ts's own "no points supplied" safe
// fallback already handles that case.
function sanitizeEducationalPoints(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const cleaned: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    cleaned.push(trimmed.length > MAX_EDUCATIONAL_POINT_LENGTH ? trimmed.slice(0, MAX_EDUCATIONAL_POINT_LENGTH) : trimmed);
    if (cleaned.length >= MAX_EDUCATIONAL_POINTS) {
      break;
    }
  }
  return cleaned;
}

function sanitizeAssistantResponseText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, MAX_ASSISTANT_RESPONSE_LENGTH);
}

// Extracted from generate-visual/route.ts (Handoff — production build fix):
// a Next.js Route Handler file may only export the HTTP method handlers and
// a small fixed set of config values; any other named export (this
// function was previously exported directly from the route file purely for
// unit-testability) is a type error under Next's stable webpack build,
// though the beta Turbopack production builder had been silently
// tolerating it. Moved verbatim — no behavior change — to its own module so
// it can still be imported directly by both route.ts and its tests.
export function resolveEducationalPoints(
  intent: ContentIntent,
  clientValue: unknown,
  assistantResponseText: unknown,
): string[] {
  const clientPoints = sanitizeEducationalPoints(clientValue);
  if (intent !== "educational" || clientPoints.length > 0) {
    return clientPoints;
  }

  const safeAssistantResponseText = sanitizeAssistantResponseText(assistantResponseText);
  if (!safeAssistantResponseText) {
    return [];
  }

  return sanitizeEducationalPoints(extractEducationalPoints(safeAssistantResponseText));
}
