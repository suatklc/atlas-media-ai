// Verified Fact Contract — the small intermediate layer between raw
// MEANINGFUL evidence and ContentPackage generation. A proven, live-
// observed defect (context leakage: a true fact from one conditional
// branch of a source document ending up applied to a different
// scenario) recurred across three separate deterministic/prompt-only
// attempts to fix it. The actual fix moves the decision out of the
// editorial call entirely: a separate, narrow, non-editorial AI call
// (Job 1) classifies every factual claim in the evidence as
// current-topic / different-scenario / unsupported, and CODE — never
// the editorial model — deterministically keeps only current-topic
// facts before the ContentPackage call ever runs. Deliberately as
// small as contentPackage.ts's own contract: one flat type, one JSON
// schema, one structural guard — not a generic framework, no
// confidence score, no source IDs, no embeddings, no citation system.

export type EvidenceFactStatus = "current-topic" | "different-scenario" | "unsupported";

export type EvidenceFact = {
  claim: string;
  evidenceFragment: string;
  status: EvidenceFactStatus;
};

const VALID_STATUSES = new Set<EvidenceFactStatus>(["current-topic", "different-scenario", "unsupported"]);

export function isEvidenceFact(value: unknown): value is EvidenceFact {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.claim === "string" &&
    typeof v.evidenceFragment === "string" &&
    typeof v.status === "string" &&
    VALID_STATUSES.has(v.status as EvidenceFactStatus)
  );
}

export function isEvidenceFactArray(value: unknown): value is EvidenceFact[] {
  return Array.isArray(value) && value.every(isEvidenceFact);
}

// Evidence Fragment Grounding Check: "current-topic" is Job 1's OWN
// classification of its OWN self-reported evidenceFragment — nothing
// upstream of this ever confirms that fragment actually appears in the
// real evidenceText Job 1 was given. Without this, a hallucinated
// claim+fragment pair labeled "current-topic" by Job 1 would reach Job 2
// as a "DOĞRULANMIŞ OLGU" (verified fact) purely on the model's say-so.
// Deterministic, dependency-free — normalizes case (tr-TR) and
// whitespace only, then requires a literal substring match; no fuzzy/
// edit-distance tolerance, so this can only ever reject (never
// incorrectly accept) a fragment that isn't genuinely present.
function normalizeForEvidenceMatch(text: string): string {
  return text.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

export function isEvidenceFragmentGrounded(fact: EvidenceFact, evidenceText: string): boolean {
  const fragment = normalizeForEvidenceMatch(fact.evidenceFragment);
  if (!fragment) return false;
  return normalizeForEvidenceMatch(evidenceText).includes(fragment);
}

// The core safety property: never rely on the editorial call to
// self-censor a fact it was already shown — code alone decides what
// reaches it, by simply never including anything else in the first
// place. A "current-topic" fact additionally fails CLOSED (is dropped,
// same as if it had never been extracted) when its own evidenceFragment
// isn't a genuine, verifiable quote from the real evidenceText — see
// isEvidenceFragmentGrounded above.
export function filterCurrentTopicFacts(facts: EvidenceFact[], evidenceText: string): EvidenceFact[] {
  return facts.filter((fact) => fact.status === "current-topic" && isEvidenceFragmentGrounded(fact, evidenceText));
}

const EVIDENCE_FACT_SCHEMA = {
  type: "object" as const,
  properties: {
    claim: { type: "string" },
    evidenceFragment: { type: "string" },
    status: { type: "string", enum: ["current-topic", "different-scenario", "unsupported"] },
  },
  required: ["claim", "evidenceFragment", "status"],
  additionalProperties: false,
};

export const FACT_CONTRACT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    facts: { type: "array" as const, items: EVIDENCE_FACT_SCHEMA },
  },
  required: ["facts"],
  additionalProperties: false,
};

// ============================================================
// Verified Token-to-Claim Binding Check (Gap 2, narrow slice): a real,
// live-observed defect in a production run — Job 2 (the editorial
// call) combined a date genuinely verified under ONE Job 1 fact with a
// DIFFERENT fact's subject inside a single slide display-fact string,
// producing a claim neither verified fact actually made ("Satış
// dışındaki işlemlerde 2014/2 sayılı Genelge hükümleri 05.09.2026
// tarihinden itibaren uygulanmaya devam edecektir" — the real source
// attaches that date only to a separate, sale-specific requirement).
// Deterministic and digit-anchored: it only polices which notable
// tokens (dates/durations/legal references/percentages/large numbers)
// may appear TOGETHER in one slide fact string, never the wording
// around them — rewording a single already-licensed fact is never
// affected, only recombining tokens that were never verified together.
// Deliberately scoped to ContentSlide.facts[] only (never body/
// headline/caption) — that field is documented as a close display
// mirror of specific verified facts, unlike free narrative prose where
// mentioning two true facts in the same paragraph is normal and not a
// binding claim.
// ============================================================

const DATE_PATTERN = /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g;
const ISO_DATE_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/g;
const DURATION_PATTERN = /\b\d{1,3}\s*(?:gün|saat|ay|yıl|sene)\b/g;
// No trailing \b: JS's \w (and therefore \b) is ASCII-only, so a
// boundary check right after "sayılı" (ends in Turkish dotless "ı",
// U+0131) never matches — it would silently make these two patterns
// never match anything. The literal "sayılı" text already anchors the
// match precisely enough without it.
const LEGAL_REF_SLASH_PATTERN = /\b\d{1,4}\/\d{1,2}\s*sayılı/g;
const LEGAL_REF_PLAIN_PATTERN = /\b\d{3,6}\s*sayılı/g;
const PERCENTAGE_PATTERN = /\b%\s?\d+(?:[.,]\d+)?\b|\b\d+(?:[.,]\d+)?\s?%\b/g;
// Large standalone numbers (thousand-grouped, or any bare 4+ digit
// run such as a year) — deliberately NOT the small list-marker digits
// a "what-to-do" slide uses ("1)", "2." at a line start): those never
// match any pattern here (too short, no unit/"sayılı" word, below the
// digit-count floor), so they're excluded by construction, not by a
// special case. Matched LAST (see extractNotableTokens below) and
// skipped wherever it would overlap an already-claimed date/legal-
// reference span — without that, a single date like "05.09.2026" or a
// reference like "2014/2 sayılı" would silently ALSO yield a second,
// separate bare-number token ("2026" / "2014") that could pair with
// something the real date/reference never did.
const LARGE_NUMBER_PATTERN = /\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?\b|\b\d{4,}\b/g;

// One canonical form per non-date token so separator variants of the
// same real value ("2014/2 sayılı" vs "2014.2 sayılı") compare equal —
// consistency is all that matters here, not which separator wins.
function normalizeToken(raw: string): string {
  return raw
    .toLocaleLowerCase("tr-TR")
    .replace(/\//g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

// Date Token Canonicalization: a real, live-observed false positive —
// Job 2 sometimes echoes an already-verified date in ISO form
// ("2026-09-07") instead of the DD.MM.YYYY form Job 1's facts carry
// ("07.09.2026"). normalizeToken alone treats those as two unrelated
// tokens, so a harmless reformat of a genuinely verified date got
// rejected as "unverified". Both DATE_PATTERN and ISO_DATE_PATTERN
// matches are re-expressed in one canonical YYYY-MM-DD form here —
// scoped to dates only; every other token kind keeps using
// normalizeToken unchanged, and no new date shape is matched beyond
// what DATE_PATTERN/ISO_DATE_PATTERN already recognized.
function canonicalizeDateToken(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month}-${day}`;
  }
  const dmy = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  // Unreachable for any real DATE_PATTERN/ISO_DATE_PATTERN match — safe
  // fallback to the generic normalizer rather than throwing.
  return normalizeToken(raw);
}

// Specific-to-generic priority order: every pattern here is tried
// before LARGE_NUMBER_PATTERN, whose matches are discarded if they
// overlap a span one of these already claimed. Each pattern keeps its
// own normalizer — only the two date patterns canonicalize format.
const PRIORITY_PATTERNS: { pattern: RegExp; normalize: (raw: string) => string }[] = [
  { pattern: DATE_PATTERN, normalize: canonicalizeDateToken },
  { pattern: ISO_DATE_PATTERN, normalize: canonicalizeDateToken },
  { pattern: LEGAL_REF_SLASH_PATTERN, normalize: normalizeToken },
  { pattern: LEGAL_REF_PLAIN_PATTERN, normalize: normalizeToken },
  { pattern: DURATION_PATTERN, normalize: normalizeToken },
  { pattern: PERCENTAGE_PATTERN, normalize: normalizeToken },
];

type TokenSpan = { start: number; end: number };

function findSpans(pattern: RegExp, text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length });
  }
  return spans;
}

function overlapsAny(span: TokenSpan, claimed: TokenSpan[]): boolean {
  return claimed.some((c) => span.start < c.end && span.end > c.start);
}

export function extractNotableTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  const claimedSpans: TokenSpan[] = [];

  for (const { pattern, normalize } of PRIORITY_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      tokens.add(normalize(match[0]));
      claimedSpans.push({ start, end: start + match[0].length });
    }
  }

  for (const span of findSpans(LARGE_NUMBER_PATTERN, text)) {
    if (!overlapsAny(span, claimedSpans)) {
      tokens.add(normalizeToken(text.slice(span.start, span.end)));
    }
  }

  return tokens;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}‖${b}` : `${b}‖${a}`;
}

// Fail-closed entry point: given the grounded current-topic facts Job 2
// was actually shown, and the plain-language facts[] strings Job 2 put
// on each slide, returns a human-readable reason per violation found
// (empty array = no violations). A token present in zero verified
// facts is flagged on its own (plain invention); a pair of otherwise-
// verified tokens that never co-occurred in a single fact is flagged
// as an unlicensed binding — the exact shape of the reproduced defect.
export function findTokenBindingViolations(
  verifiedFacts: EvidenceFact[],
  slideFactStrings: string[],
): string[] {
  const allVerifiedTokens = new Set<string>();
  const licensedPairs = new Set<string>();

  for (const fact of verifiedFacts) {
    const tokens = Array.from(extractNotableTokens(`${fact.claim} ${fact.evidenceFragment}`));
    for (const token of tokens) allVerifiedTokens.add(token);
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        licensedPairs.add(pairKey(tokens[i], tokens[j]));
      }
    }
  }

  const violations: string[] = [];
  for (const factString of slideFactStrings) {
    const tokens = Array.from(extractNotableTokens(factString));
    if (tokens.length === 0) continue;

    for (const token of tokens) {
      if (!allVerifiedTokens.has(token)) {
        violations.push(`Unverified token "${token}" in slide fact "${factString}".`);
      }
    }

    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const a = tokens[i];
        const b = tokens[j];
        if (!allVerifiedTokens.has(a) || !allVerifiedTokens.has(b)) continue; // already reported above
        if (!licensedPairs.has(pairKey(a, b))) {
          violations.push(
            `Unlicensed token pairing "${a}" + "${b}" in slide fact "${factString}" — never verified together in a single fact.`,
          );
        }
      }
    }
  }

  return violations;
}
