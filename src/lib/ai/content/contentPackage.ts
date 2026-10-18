// Gold Standard V1 — the structured machine contract that replaces the
// old hidden prose markers ([[CAROUSEL_STRUCTURE: ...]] etc.) for the
// Current Content Radar generation path. This is deliberately NOT a
// generic framework: one flat type, one JSON Schema, one deterministic
// validator — built for exactly this one pipeline, not a reusable
// abstraction for future content types.

export type SlideRole = "hook" | "what-happened" | "why-it-matters" | "what-to-do" | "cta";

// Fixed, deterministic role-per-index mapping for the 5-slide carousel —
// the MODEL fills in headline/body/facts for each role, but which role
// occupies which slide position is a constant this code owns, never
// something the model decides. Matches the Gold Standard brief's slide
// order exactly (Section 8).
export const CAROUSEL_SLIDE_ROLES: SlideRole[] = ["hook", "what-happened", "why-it-matters", "what-to-do", "cta"];

export type ContentFact = {
  label: string;
  value: number;
  unit: string; // "" when not applicable (e.g. a count, not a currency)
  // "component"/"total" enable the arithmetic check below; "standalone"
  // is any other number the source supports on its own (e.g. a bare
  // "yaklaşık 150.000 TL" with no itemized breakdown) — never promoted
  // to "total" without real "component" facts backing it, and the model
  // is explicitly instructed not to invent components it wasn't given.
  role: "component" | "total" | "standalone";
};

export type ContentSlide = {
  index: number; // 1-based, matches CAROUSEL_SLIDE_ROLES order for carousel
  role: SlideRole;
  headline: string;
  body: string;
  facts: string[]; // plain-language facts shown on this slide (display strings)
  visualBrief: string; // short visual CONCEPT only — never rendered text
};

export type ContentPackage = {
  topic: string;
  source: { name: string; url: string; publishedAt: string };
  hook: string;
  caption: string;
  hashtags: string[];
  format: "single" | "carousel";
  slides: ContentSlide[];
  facts: ContentFact[];
  // Absent = "news" (Radar/current-development content, the original
  // behavior). "expert" = evergreen expert content from a user instruction
  // (no source, no facts) — the carousel renders slide headlines as section
  // labels and a single CTA instead of the news template's fixed ones.
  contentMode?: "news" | "expert";
};

export type ContentPackageValidationResult = { ok: true } | { ok: false; reason: string };

const MIN_NOTABLE_NUMBER = 1000;
// A source-stated total is allowed to be a rounded "approximately" figure
// even when a real itemized breakdown exists (e.g. "yaklaşık 150.000 TL"
// summarizing exact component figures) — this tolerance is intentionally
// small (rounding-only), not a loophole for genuinely wrong totals like
// the 40k+25k+25k+10k=100k-shown-as-150k case this validator exists to
// catch.
const ARITHMETIC_TOLERANCE = 1;

// Evidence Safety Gate follow-up: individual word-tokens that only ever
// describe a calendar date's own parts, never a genuinely summable
// quantity. A live production run proved a plain exact-string denylist
// insufficient — the model produced a compound unit ("ay-gün") that
// evaded it entirely. isCalendarDateUnit below normalizes and splits the
// unit on common separators/whitespace first, so any simple combination
// of these tokens (single or compound, "yıl", "ay-gün", "ay/gün",
// "yıl-ay", "yıl ay gün", ...) is caught by the SAME check — not an
// ever-growing exact-phrase list.
const CALENDAR_UNIT_TOKENS = new Set(["yıl", "sene", "ay", "gün"]);

// A unit represents calendar-date parts (as opposed to a legitimate
// quantitative duration) only when EVERY token it splits into is one of
// the calendar-part words above — "ay" alone, "ay-gün", "yıl/ay/gün" all
// match; "TL", "adet", "yıllık" (a different word, not the bare token
// "yıl") do not. Deliberately conservative: an unrecognized token makes
// the whole unit NOT match, so this can only ever narrow to obvious
// calendar-part combinations, never misfire on an unrelated unit.
function isCalendarDateUnit(unit: string): boolean {
  const tokens = unit
    .trim()
    .toLocaleLowerCase("tr-TR")
    .split(/[\s\-/,]+/)
    .filter((token) => token.length > 0);
  return tokens.length > 0 && tokens.every((token) => CALENDAR_UNIT_TOKENS.has(token));
}

// Shared by both the sanitizer and validateContentPackage below — one
// predicate, so they can never drift apart on what counts as an invalid
// calendar-date component.
function isCalendarDateComponentFact(fact: ContentFact): boolean {
  return fact.role === "component" && isCalendarDateUnit(fact.unit);
}

// Deterministic Calendar-Date Fact Sanitizer: a proven, live-observed
// regression — the model re-emitted a single date (05.09.2026) as
// separate role="component" facts (year/month/day, or compound
// variants like "ay-gün") despite an explicit prompt rule against it —
// used to fail the ENTIRE package at validateContentPackage. Stripping
// the exact invalid pattern BEFORE validation lets a generation that
// makes only this one mistake still succeed (with a smaller/possibly-
// empty facts[]) instead of failing closed on an otherwise-good
// package. Deliberately narrow: a legitimate role="standalone"/"total"
// duration fact (e.g. "24 ay" as a loan term) is never touched, since
// it isn't role==="component" in the first place.
export function sanitizeCalendarDateFacts(facts: ContentFact[]): ContentFact[] {
  return facts.filter((fact) => !isCalendarDateComponentFact(fact));
}

function extractNotableNumbers(text: string): Set<number> {
  const numbers = new Set<number>();
  const matches = text.matchAll(/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?/g);
  for (const match of matches) {
    const normalized = match[0].replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    if (Number.isFinite(value) && value >= MIN_NOTABLE_NUMBER) {
      numbers.add(Math.round(value));
    }
  }
  return numbers;
}

function wordSet(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase("tr-TR")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function headlineOverlapRatio(a: string, b: string): number {
  const aWords = wordSet(a);
  const bWords = wordSet(b);
  if (aWords.size === 0 || bWords.size === 0) return 0;
  let shared = 0;
  for (const word of aWords) {
    if (bWords.has(word)) shared += 1;
  }
  return shared / Math.min(aWords.size, bWords.size);
}

const VALID_SLIDE_ROLES = new Set<SlideRole>(["hook", "what-happened", "why-it-matters", "what-to-do", "cta"]);
const VALID_FACT_ROLES = new Set(["component", "total", "standalone"]);

function isContentSlide(value: unknown): value is ContentSlide {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.index === "number" &&
    typeof v.role === "string" &&
    VALID_SLIDE_ROLES.has(v.role as SlideRole) &&
    typeof v.headline === "string" &&
    typeof v.body === "string" &&
    Array.isArray(v.facts) &&
    v.facts.every((f) => typeof f === "string") &&
    typeof v.visualBrief === "string"
  );
}

function isContentFact(value: unknown): value is ContentFact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.label === "string" &&
    typeof v.value === "number" &&
    Number.isFinite(v.value) &&
    typeof v.unit === "string" &&
    typeof v.role === "string" &&
    VALID_FACT_ROLES.has(v.role)
  );
}

// Untrusted-input guard for a client-supplied ContentPackage — same
// defensive posture as every other AI-sourced field in this pipeline
// (isContentOpportunity, sanitizeClientCarouselStructure, etc). Structural
// only; validateContentPackage below is the semantic/business-rule layer.
export function isContentPackage(value: unknown): value is ContentPackage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.topic !== "string" || typeof v.hook !== "string" || typeof v.caption !== "string") return false;
  if (!v.source || typeof v.source !== "object") return false;
  const source = v.source as Record<string, unknown>;
  if (typeof source.name !== "string" || typeof source.url !== "string" || typeof source.publishedAt !== "string") {
    return false;
  }
  if (!Array.isArray(v.hashtags) || !v.hashtags.every((h) => typeof h === "string")) return false;
  if (v.format !== "single" && v.format !== "carousel") return false;
  if (!Array.isArray(v.slides) || !v.slides.every(isContentSlide)) return false;
  if (!Array.isArray(v.facts) || !v.facts.every(isContentFact)) return false;
  return true;
}

// Deterministic, zero-AI-cost validation — every check here runs in
// plain code, never a second model call. Rejects explicitly (never
// silently "fixes" or drops fields) so the caller can ask for
// regeneration rather than persist a subtly broken package.
export function validateContentPackage(pkg: ContentPackage): ContentPackageValidationResult {
  // A. Slide count
  const expectedSlideCount = pkg.format === "carousel" ? 5 : 1;
  if (pkg.slides.length !== expectedSlideCount) {
    return {
      ok: false,
      reason: `${pkg.format} format requires exactly ${expectedSlideCount} slide(s), got ${pkg.slides.length}.`,
    };
  }

  if (pkg.format === "carousel") {
    for (let i = 0; i < pkg.slides.length; i++) {
      const expectedRole = CAROUSEL_SLIDE_ROLES[i];
      if (pkg.slides[i].index !== i + 1 || pkg.slides[i].role !== expectedRole) {
        return {
          ok: false,
          reason: `Slide ${i + 1} must have index ${i + 1} and role "${expectedRole}", got index ${pkg.slides[i].index} and role "${pkg.slides[i].role}".`,
        };
      }
    }
  }

  // B. Required fields
  if (!pkg.source.name.trim() || !pkg.source.url.trim()) {
    return { ok: false, reason: "source.name and source.url are required." };
  }
  if (!pkg.hook.trim()) {
    return { ok: false, reason: "hook is required." };
  }
  if (!pkg.caption.trim()) {
    return { ok: false, reason: "caption is required." };
  }
  if (pkg.hashtags.length === 0) {
    return { ok: false, reason: "hashtags must be non-empty." };
  }
  for (const slide of pkg.slides) {
    if (!slide.headline.trim()) {
      return { ok: false, reason: `Slide ${slide.index} headline is required.` };
    }
    if (!slide.body.trim()) {
      return { ok: false, reason: `Slide ${slide.index} body is required.` };
    }
  }

  // Evidence Safety Gate follow-up: a calendar date must never be
  // decomposed into separate additive "component" facts (year/month/day,
  // single or compound units like "ay-gün") — the real, live-observed
  // defect this catches. Deliberately narrow to role==="component" so a
  // genuinely legitimate standalone/total duration fact (e.g. "5 yıl
  // vade" as role="standalone") is never rejected — only the specific
  // arithmetic-component misuse is. Shares isCalendarDateComponentFact
  // with sanitizeCalendarDateFacts above so the two can never drift
  // apart on what counts as invalid.
  for (const fact of pkg.facts) {
    if (isCalendarDateComponentFact(fact)) {
      return {
        ok: false,
        reason: `Calendar-date component misuse: a date must never be split into arithmetic "component" facts (fact "${fact.label}" uses unit "${fact.unit}").`,
      };
    }
  }

  // C. Arithmetic consistency — the exact class of error this validator
  // exists to catch: itemized "component" facts whose sum doesn't match
  // a stated "total". D (do not invent breakdowns) is enforced by never
  // requiring components to exist — a lone "total"/"standalone" fact
  // with no components is always valid.
  const components = pkg.facts.filter((f) => f.role === "component");
  const totals = pkg.facts.filter((f) => f.role === "total");
  if (components.length > 0 && totals.length > 0) {
    const componentSum = components.reduce((sum, f) => sum + f.value, 0);
    for (const total of totals) {
      if (Math.abs(componentSum - total.value) > ARITHMETIC_TOLERANCE) {
        return {
          ok: false,
          reason: `Arithmetic inconsistency: itemized facts sum to ${componentSum} but total is stated as ${total.value}.`,
        };
      }
    }
  }

  // E. Cross-field number consistency — a notable (>=1000) number
  // appearing in the caption must also appear somewhere in the package's
  // own facts or slide text; otherwise it's an unverifiable/contradicting
  // figure the model introduced only in the caption.
  const captionNumbers = extractNotableNumbers(pkg.caption);
  if (captionNumbers.size > 0) {
    const knownNumbers = new Set<number>();
    for (const fact of pkg.facts) knownNumbers.add(Math.round(fact.value));
    for (const slide of pkg.slides) {
      for (const n of extractNotableNumbers(`${slide.headline} ${slide.body} ${slide.facts.join(" ")}`)) {
        knownNumbers.add(n);
      }
    }
    for (const n of captionNumbers) {
      if (!knownNumbers.has(n)) {
        return {
          ok: false,
          reason: `Caption references ${n}, which does not appear in the package's own facts or slides.`,
        };
      }
    }
  }

  // F. Duplicate slide role/content — roles are already guaranteed
  // distinct by the index/role check above; this additionally catches
  // two slides saying essentially the same thing in their headlines.
  for (let i = 0; i < pkg.slides.length; i++) {
    for (let j = i + 1; j < pkg.slides.length; j++) {
      if (headlineOverlapRatio(pkg.slides[i].headline, pkg.slides[j].headline) >= 0.7) {
        return {
          ok: false,
          reason: `Slide ${pkg.slides[i].index} and slide ${pkg.slides[j].index} headlines are near-duplicates.`,
        };
      }
    }
  }

  return { ok: true };
}
