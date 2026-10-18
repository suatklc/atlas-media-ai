import type { ContentPackage } from "./contentPackage";

// Draft Edit (Real Use V1): validation of Suat's edited carousel copy and
// the merge into the stored ContentPackage. Used by /api/drafts/edit.

const SLIDE_COUNT = 5;
const MAX_HEADLINE = 160;
const MAX_BODY = 700;
const MAX_FACT = 200;
const MAX_FACTS = 4;
const MAX_SHORT = 200;
// Instagram's caption limit; the persisted caption also carries hashtags.
const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;

type SlideEdit = { headline: string; body: string; facts: string[]; emphasis?: string; cta?: string };
export type DraftEdit = { slides: SlideEdit[]; caption: string; hashtags: string[] };

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = text(value, max);
  if (parsed === null) return null;
  return parsed || undefined;
}

// Hashtags arrive as one free-text field; a space would end an Instagram
// tag, so each whitespace/comma-separated token becomes one "#tag".
export function parseHashtags(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const tags = raw
    .split(/[\s,]+/)
    .map((token) => token.replace(/^#+/, ""))
    .filter(Boolean)
    .map((token) => `#${token}`);
  return tags.length > 0 && tags.length <= MAX_HASHTAGS ? tags : null;
}

export function parseDraftEdit(body: unknown): DraftEdit | string {
  if (!body || typeof body !== "object") return "Geçersiz istek gövdesi.";
  const { slides, caption, hashtags } = body as Record<string, unknown>;
  if (!Array.isArray(slides) || slides.length !== SLIDE_COUNT) return "Tam olarak 5 slayt gerekli.";

  const parsedSlides: SlideEdit[] = [];
  for (let index = 0; index < SLIDE_COUNT; index += 1) {
    const slide = slides[index] as Record<string, unknown> | null;
    if (!slide || typeof slide !== "object") return `Slayt ${index + 1} geçersiz.`;
    const headline = text(slide.headline, MAX_HEADLINE);
    const slideBody = text(slide.body, MAX_BODY);
    if (!headline) return `Slayt ${index + 1}: başlık boş olamaz (en fazla ${MAX_HEADLINE} karakter).`;
    if (!slideBody) return `Slayt ${index + 1}: metin boş olamaz (en fazla ${MAX_BODY} karakter).`;
    const rawFacts = Array.isArray(slide.facts) ? slide.facts : [];
    const facts = rawFacts.map((fact) => text(fact, MAX_FACT)).filter((fact): fact is string => Boolean(fact));
    if (facts.length !== rawFacts.filter((fact) => typeof fact === "string" && fact.trim()).length || facts.length > MAX_FACTS) {
      return `Slayt ${index + 1}: en fazla ${MAX_FACTS} madde, her biri en fazla ${MAX_FACT} karakter.`;
    }
    const emphasis = optionalText(slide.emphasis, MAX_SHORT);
    const cta = optionalText(slide.cta, MAX_SHORT);
    if (emphasis === null || cta === null) return `Slayt ${index + 1}: vurgu/CTA en fazla ${MAX_SHORT} karakter.`;
    parsedSlides.push({ headline, body: slideBody, facts, emphasis, cta });
  }

  const parsedCaption = text(caption, MAX_CAPTION);
  if (!parsedCaption) return `Açıklama boş olamaz (en fazla ${MAX_CAPTION} karakter).`;
  const parsedHashtags = parseHashtags(hashtags);
  if (!parsedHashtags) return `En az 1, en fazla ${MAX_HASHTAGS} hashtag girin.`;
  return { slides: parsedSlides, caption: parsedCaption, hashtags: parsedHashtags };
}

// The edit replaces only Suat-editable text; topic, source, hook, roles,
// visual briefs, facts[] (package-level) and contentMode stay as generated.
export function applyDraftEdit(original: ContentPackage, edit: DraftEdit): ContentPackage {
  return {
    ...original,
    caption: edit.caption,
    hashtags: edit.hashtags,
    slides: original.slides.map((slide, index) => {
      const next = edit.slides[index];
      const merged = { ...slide, headline: next.headline, body: next.body, facts: next.facts };
      // A cleared field is removed, never left holding the previous value.
      delete merged.emphasis;
      delete merged.cta;
      return {
        ...merged,
        ...(next.emphasis ? { emphasis: next.emphasis } : {}),
        ...(next.cta ? { cta: next.cta } : {}),
      };
    }),
  };
}
