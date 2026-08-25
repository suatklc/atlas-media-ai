import type { ContentFormat, ContentIntent, OutputMode, OutputSpecification } from "./types";

const MIN_CAROUSEL_SLIDES = 2;
const MAX_CAROUSEL_SLIDES = 10;
const EDUCATIONAL_CAROUSEL_DEFAULT = 6;
const GENERAL_CAROUSEL_DEFAULT = 5;

const SINGLE_PATTERNS = [
  /\btek\s+görsel\b/gu,
  /\btek\s+post\b/gu,
  /\btek\s+gönderi\b/gu,
  /\btek\s+kare\b/gu,
  /\btek\s+slayt\b/gu,
  /\b1\s+(?:slayt|slide)\b/gu,
];

const CAROUSEL_PATTERNS = [
  /\bcarousel\b/gu,
  /\bkarusel\b/gu,
  /\bkaydırmalı\s+gönderi\b/gu,
  /(?:^|\s)çoklu\s+görsel\b/gu,
  /(?:^|\s)çok\s+görselli\s+gönderi\b/gu,
];

const COUNT_PATTERNS = [
  /\b(\d{1,3})\s+(?:slayt(?:lık)?|slides?)\b/gu,
  /\b(\d{1,3})\s+görsellik\s+(?:carousel|karusel)\b/gu,
];

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
}

function carouselDefault(intent: ContentIntent): number {
  return intent === "educational" ? EDUCATIONAL_CAROUSEL_DEFAULT : GENERAL_CAROUSEL_DEFAULT;
}

function compatibilityDefault(intent: ContentIntent): OutputSpecification {
  return intent === "educational"
    ? { outputMode: "carousel", slideCount: EDUCATIONAL_CAROUSEL_DEFAULT }
    : { outputMode: "single", slideCount: 1 };
}

function findLastModeInstruction(text: string): { outputMode: OutputMode; index: number } | undefined {
  let last: { outputMode: OutputMode; index: number } | undefined;

  for (const [outputMode, patterns] of [
    ["single", SINGLE_PATTERNS],
    ["carousel", CAROUSEL_PATTERNS],
  ] as const) {
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index ?? -1;
        if (!last || index > last.index) {
          last = { outputMode, index };
        }
      }
    }
  }

  return last;
}

function findLastValidCount(text: string): number | undefined {
  let last: { count: number; index: number } | undefined;

  for (const pattern of COUNT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[1]);
      if (count < 1 || count > MAX_CAROUSEL_SLIDES) continue;
      const index = match.index ?? -1;
      if (!last || index > last.index) {
        last = { count, index };
      }
    }
  }

  return last?.count;
}

export function resolveOutputSpecification(message: string, intent: ContentIntent): OutputSpecification {
  const normalized = normalize(message);
  const explicitCount = findLastValidCount(normalized);

  if (explicitCount === 1) {
    return { outputMode: "single", slideCount: 1 };
  }
  if (explicitCount !== undefined && explicitCount >= MIN_CAROUSEL_SLIDES) {
    return { outputMode: "carousel", slideCount: explicitCount };
  }

  const explicitMode = findLastModeInstruction(normalized)?.outputMode;
  if (explicitMode === "single") {
    return { outputMode: "single", slideCount: 1 };
  }
  if (explicitMode === "carousel") {
    return { outputMode: "carousel", slideCount: carouselDefault(intent) };
  }

  return compatibilityDefault(intent);
}

const FORMAT_BY_INTENT: Record<ContentIntent, ContentFormat> = {
  listing: "single-premium-post",
  educational: "carousel",
  comparison: "comparison-graphic",
  "market-stats": "infographic",
  announcement: "simple-branded-post",
  none: "none",
};

export function selectContentFormat(intent: ContentIntent): ContentFormat {
  return FORMAT_BY_INTENT[intent];
}
