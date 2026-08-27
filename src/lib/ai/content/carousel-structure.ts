import type { OutputMode } from "./types";
import { extractCarouselStructure, type CarouselStructure } from "../creative/caption";

// Mirrors educational-points.ts's own resolveEducationalPoints exactly:
// prefer whatever clean, already-extracted value the client sent (the
// client already ran extractVisualHeadlineMarker over the completed
// stream); defensively re-derive from the raw assistantResponseText only
// if the client's value is missing/malformed. Client input is untrusted —
// each field is validated as a non-empty string and length-capped before
// use, never passed through as-is.
const MAX_FIELD_LENGTH = 400;

function sanitizeField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD_LENGTH ? trimmed.slice(0, MAX_FIELD_LENGTH) : trimmed;
}

function sanitizeClientCarouselStructure(value: unknown): CarouselStructure | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const whatHappened = sanitizeField(v.whatHappened);
  const whyItMatters = sanitizeField(v.whyItMatters);
  const cta = sanitizeField(v.cta);
  if (!whatHappened || !whyItMatters || !cta) return null;
  return { whatHappened, whyItMatters, cta };
}

function sanitizeAssistantResponseText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Only meaningful for outputMode "carousel" — returns undefined for
// "single" without inspecting either input, since the single-image path
// never needs this structure.
export function resolveCarouselStructure(
  outputMode: OutputMode,
  clientValue: unknown,
  assistantResponseText: unknown,
): CarouselStructure | undefined {
  if (outputMode !== "carousel") {
    return undefined;
  }

  const clientStructure = sanitizeClientCarouselStructure(clientValue);
  if (clientStructure) {
    return clientStructure;
  }

  const safeAssistantResponseText = sanitizeAssistantResponseText(assistantResponseText);
  if (!safeAssistantResponseText) {
    return undefined;
  }

  return extractCarouselStructure(safeAssistantResponseText);
}
