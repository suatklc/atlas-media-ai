// Deterministic text cleanup only — no AI call, no classification logic.
// Shared by AIAssistantPanel.tsx (client, run once per completed stream) and
// generate-visual/route.ts (server, defensive re-clean of whatever the
// client sent — arbitrary client-supplied text is never trusted as-is).

// Finds the explicit [[VISUAL_HEADLINE: ...]] / [[EDUCATIONAL_POINTS: ...]]
// markers anywhere in the text, not just as the literal last line.
// creative/directive.ts asks the model to place them after Etiketler, but
// the extractor must not depend on that being followed exactly — trailing
// whitespace or other structure after a marker must not defeat it. Only
// each marker's own matched span is removed; everything else in the text
// (including content that follows it) is kept.
const VISUAL_HEADLINE_MARKER = /\n?\[\[VISUAL_HEADLINE:\s*([^\]]*?)\s*\]\]/i;
// Package 5C: pipe-delimited candidate points, e.g. "a | b | c". Same
// bracket-marker shape as VISUAL_HEADLINE, so it's found/stripped the same
// way and can't collide with normal bracketed prose (e.g. "[500.000 TL]")
// for the same reason VISUAL_HEADLINE's marker doesn't.
const EDUCATIONAL_POINTS_MARKER = /\n?\[\[EDUCATIONAL_POINTS:\s*([^\]]*?)\s*\]\]/i;
const MAX_EDUCATIONAL_POINTS = 5;
const MAX_FALLBACK_POINT_LENGTH = 200;

const EDUCATIONAL_SECTION_PATTERN =
  /^(?:nokta|madde|adım|[iİ]pucu|kontrol)\s*(\d{1,2})(?:\s*[:.)-]\s*(.*))?$/iu;
const NUMBERED_ITEM_PATTERN = /^\d{1,2}(?:[.)]|\s+-)\s+(.+)$/u;
const BULLET_ITEM_PATTERN = /^(?:[-*•])\s+(.+)$/u;
const METADATA_LIKE_PATTERN = /\[\[/u;
const EXCLUDED_SECTION_PATTERN =
  /^(?:etiketler|kapanış(?:\s*\/\s*cta)?|cta|görsel spesifikasyonu|tamamlanması gereken(?:ler)?|dahili brief|dahili içerik planı|meta)(?=:|$)/iu;
const NEUTRAL_SECTION_PATTERN = /^(?:giriş|özet|başlık)(?=:|$)/iu;
const VISUAL_INSTRUCTION_PATTERN =
  /^(?:kompozisyon|tipografi|logo|kamera|ışık|renk|yerleşim|metin yerleşimi|görsel|görsel öncelik)(?=:|$)/iu;

type FallbackLine = {
  normalized: string;
  available: boolean;
};

function normalizeStructuralLine(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/__/g, "")
    .trim();
}

function normalizeFallbackCandidate(value: string): string | undefined {
  const candidate = value
    .trim()
    .replace(/^\*\*(.*?)\*\*$/, "$1")
    .replace(/^_(.*?)_$/, "$1")
    .trim();

  if (
    !candidate ||
    candidate.length > MAX_FALLBACK_POINT_LENGTH ||
    candidate.startsWith("#") ||
    METADATA_LIKE_PATTERN.test(candidate) ||
    EXCLUDED_SECTION_PATTERN.test(candidate) ||
    VISUAL_INSTRUCTION_PATTERN.test(candidate)
  ) {
    return undefined;
  }

  return candidate;
}

function buildFallbackLines(text: string): FallbackLine[] {
  let excludedSection = false;

  return text.split("\n").map((line) => {
    const normalized = normalizeStructuralLine(line);

    if (!normalized || /^(-{3,}|\*{3,}|_{3,})$/.test(normalized)) {
      return { normalized, available: false };
    }

    if (EDUCATIONAL_SECTION_PATTERN.test(normalized)) {
      excludedSection = false;
      return { normalized, available: true };
    }

    if (EXCLUDED_SECTION_PATTERN.test(normalized) || VISUAL_INSTRUCTION_PATTERN.test(normalized)) {
      excludedSection = true;
      return { normalized, available: false };
    }

    if (NEUTRAL_SECTION_PATTERN.test(normalized)) {
      excludedSection = false;
      return { normalized, available: false };
    }

    if (
      excludedSection ||
      METADATA_LIKE_PATTERN.test(normalized) ||
      normalized.startsWith("#")
    ) {
      return { normalized, available: false };
    }

    return { normalized, available: true };
  });
}

function extractEducationalSections(lines: FallbackLine[]): string[] | undefined {
  const points: string[] = [];

  for (let index = 0; index < lines.length && points.length < MAX_EDUCATIONAL_POINTS; index += 1) {
    const line = lines[index];
    if (!line.available) continue;

    const match = line.normalized.match(EDUCATIONAL_SECTION_PATTERN);
    if (!match) continue;

    const sameLineCandidate = normalizeFallbackCandidate(match[2] ?? "");
    if (sameLineCandidate) {
      points.push(sameLineCandidate);
      continue;
    }

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const next = lines[nextIndex];
      if (EDUCATIONAL_SECTION_PATTERN.test(next.normalized) || EXCLUDED_SECTION_PATTERN.test(next.normalized)) {
        break;
      }
      if (!next.available) continue;

      const candidate = normalizeFallbackCandidate(next.normalized);
      if (candidate) points.push(candidate);
      break;
    }
  }

  return points.length > 0 ? points : undefined;
}

function extractNumberedItems(lines: FallbackLine[]): string[] | undefined {
  const points = lines
    .filter((line) => line.available)
    .map((line) => line.normalized.match(NUMBERED_ITEM_PATTERN)?.[1])
    .map((value) => normalizeFallbackCandidate(value ?? ""))
    .filter((value): value is string => Boolean(value))
    .slice(0, MAX_EDUCATIONAL_POINTS);

  return points.length > 0 ? points : undefined;
}

function extractBulletBlock(lines: FallbackLine[]): string[] | undefined {
  let block: string[] = [];

  for (const line of lines) {
    const match = line.available ? line.normalized.match(BULLET_ITEM_PATTERN) : null;
    const candidate = normalizeFallbackCandidate(match?.[1] ?? "");

    if (candidate) {
      block.push(candidate);
      continue;
    }

    if (block.length >= 2) {
      return block.slice(0, MAX_EDUCATIONAL_POINTS);
    }
    block = [];
  }

  return block.length >= 2 ? block.slice(0, MAX_EDUCATIONAL_POINTS) : undefined;
}

// Marker-first, deterministic extraction from one completed assistant
// response. Fallback parsing accepts only explicit line-level educational
// structures; it never infers points from ordinary prose.
export function extractEducationalPoints(responseText: string): string[] | undefined {
  const markerMatch = responseText.match(EDUCATIONAL_POINTS_MARKER);
  if (markerMatch) {
    const markerPoints = markerMatch[1]
      .split("|")
      .map((point) => point.trim())
      .filter(Boolean)
      .slice(0, MAX_EDUCATIONAL_POINTS);
    if (markerPoints.length > 0) {
      return markerPoints;
    }
  }

  const lines = buildFallbackLines(responseText);
  return extractEducationalSections(lines) ?? extractNumberedItems(lines) ?? extractBulletBlock(lines);
}

// One final pass over the completed response: strips both markers
// (regardless of which comes first, or whether only one is present) and
// returns the display text plus whatever structured values were found.
// educationalPoints is only set when at least one non-empty point was
// parsed — never a fabricated placeholder array.
export function extractVisualHeadlineMarker(text: string): {
  displayText: string;
  visualHeadline?: string;
  educationalPoints?: string[];
} {
  let working = text;
  let visualHeadline: string | undefined;
  const educationalPoints = extractEducationalPoints(text);

  const headlineMatch = working.match(VISUAL_HEADLINE_MARKER);
  if (headlineMatch && typeof headlineMatch.index === "number") {
    visualHeadline = headlineMatch[1].trim() || undefined;
    const before = working.slice(0, headlineMatch.index);
    const after = working.slice(headlineMatch.index + headlineMatch[0].length);
    working = `${before}${after}`;
  }

  const pointsMatch = working.match(EDUCATIONAL_POINTS_MARKER);
  if (pointsMatch && typeof pointsMatch.index === "number") {
    const before = working.slice(0, pointsMatch.index);
    const after = working.slice(pointsMatch.index + pointsMatch[0].length);
    working = `${before}${after}`;
  }

  const displayText = working.replace(/\n{3,}/g, "\n\n").trim();
  return { displayText, visualHeadline, educationalPoints };
}

// A short "Label:" (or "**Label:**") prefix at the start of a line — the
// shape Claude's own invented section headers share ("Ana Başlık:",
// "Caption:", "Etiketler:", etc.), whether or not that exact label was ever
// instructed. Matching the shape rather than enumerating every label keeps
// this generic and bounded instead of growing per content type.
const LEADING_LABEL_PATTERN = /^[\p{L}][\p{L}\s/]{0,28}:\s*/u;

export function stripLeadingLabel(line: string): string {
  return line.replace(LEADING_LABEL_PATTERN, "");
}

// Internal-only section headers, matched as a bounded phrase prefix — NOT
// dependent on a trailing colon or bold wrapping, since live output shows
// Claude producing both "Görsel Spesifikasyonu:" (colon, content trailing on
// the same line) and a bare "**Görsel Spesifikasyonu**" heading (no colon,
// body on following lines) interchangeably. The colon-requiring
// LEADING_LABEL_PATTERN below never matched the bare form, so those lines
// fell through as regular kept content — this is that bug's fix.
//
// The lookahead requires what follows the phrase to be a colon or end of
// line — NOT bare whitespace. A real heading is either the whole line
// ("Görsel Spesifikasyonu") or the phrase immediately followed by a colon
// ("Görsel Spesifikasyonu: ..."); an ordinary sentence that happens to
// start with these words continues with a space and more prose ("Tamamlanması
// gereken bir çok iş var..."), which this must NOT match.
const INTERNAL_SECTION_PATTERNS = [/^görsel spesifikasyonu(?=:|$)/iu, /^tamamlanması gereken(ler)?(?=:|$)/iu];

// Etiketler is a real, expected, non-internal section — but its own label
// must never appear in the caption, while the hashtags beneath/after it
// must always survive. Given its own explicit boundary rule (same
// colon-or-end-only shape as the internal patterns above) rather than
// relying on the generic colon-terminated LEADING_LABEL_PATTERN, which
// likewise misses a bare "**Etiketler**" heading.
const ETIKETLER_PREFIX_PATTERN = /^etiketler(?=:|$)\s*:?\s*/iu;

// A line that is purely a markdown horizontal rule (---, ***, ___) — used
// only to visually separate the model's own internal response sections and
// never meaningful in a publishable caption either way.
const HORIZONTAL_RULE_PATTERN = /^(-{3,}|\*{3,}|_{3,})$/;

// Derives the publishable Instagram caption from Claude's single raw
// response: strip the VISUAL_HEADLINE marker (defensive — the caller should
// already have done this) and drop internal-only sections, keeping
// everything else (including hashtags) with only its leading label removed.
// This is separation/cleanup, not a rewrite: wording and paragraph order are
// preserved as-is.
export function buildPublishableCaption(rawText: string): string {
  const { displayText } = extractVisualHeadlineMarker(rawText);

  const lines = displayText.split("\n");
  const kept: string[] = [];
  let skipCurrentSection = false;

  for (const original of lines) {
    // Markdown headings require a space after the #'s — using \s* here
    // would also eat a lone leading "#" from an unspaced hashtag line
    // (e.g. "#emlak #gayrimenkul...").
    const normalized = original.trim().replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");

    if (HORIZONTAL_RULE_PATTERN.test(normalized)) {
      continue;
    }

    if (INTERNAL_SECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      skipCurrentSection = true;
      continue;
    }

    if (ETIKETLER_PREFIX_PATTERN.test(normalized)) {
      // Ends any active internal-section skip (Etiketler always follows
      // Görsel Spesifikasyonu in practice) and drops just the label,
      // keeping any hashtag content that shares its line.
      skipCurrentSection = false;
      const remainder = normalized.replace(ETIKETLER_PREFIX_PATTERN, "").trim();
      if (remainder) {
        kept.push(remainder);
      }
      continue;
    }

    // Any other colon-terminated label line (e.g. "Ana Başlık:", "Caption:")
    // also ends an active skip — a defensive fallback for a section
    // transition that isn't one of the specifically-known boundaries above.
    if (LEADING_LABEL_PATTERN.test(normalized)) {
      skipCurrentSection = false;
    }

    if (skipCurrentSection) {
      continue;
    }

    kept.push(stripLeadingLabel(normalized));
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
