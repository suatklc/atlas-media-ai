// Shared by providers/resmiGazete.ts and providers/csb.ts (Research
// Breadth Expansion v2) — both are official sources whose overall content
// is NOT exclusively real-estate (Resmî Gazete covers all government
// legislation; the Ministry of Environment, Urbanization and Climate
// Change covers environment/climate/water/forestry alongside zoning/
// construction), so both need the same real-estate relevance filter
// before any of their entries becomes a ContentOpportunity candidate.
//
// Turkish-aware WORD-BOUNDARY matching, not naive substring matching — a
// substring check on "yapı" (building/structure, a real, intended
// keyword) also matches the extremely common bureaucratic phrase
// "değişiklik YAPILMASINA" ("to make an amendment") purely because "yapı"
// happens to appear as a substring of "yapılmasına" — a real case found
// live against an actual Resmî Gazete issue during Phase 3. The same bug
// class already fixed once in content/intent.ts; kept independent here
// since research/ has no reason to import from content/ for this. This
// module was extracted out of resmiGazete.ts (its original sole owner)
// now that a second adapter (csb.ts) needs the identical logic — the same
// "genuinely reused by two adapters now" extraction turishDate.ts already
// documents for itself.

const TURKISH_WORD_CHARS = "a-zA-ZçğıöşüÇĞİÖŞÜ0-9_";
const TURKISH_WORD_CHAR_PATTERN = new RegExp(`^[${TURKISH_WORD_CHARS}]$`);

function isTurkishWordChar(char: string | undefined): boolean {
  return char !== undefined && TURKISH_WORD_CHAR_PATTERN.test(char);
}

function hasWordBoundaryMatch(haystack: string, needle: string): boolean {
  let searchFrom = 0;
  for (;;) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) return false;
    const before = index > 0 ? haystack[index - 1] : undefined;
    const after = haystack[index + needle.length];
    if (!isTurkishWordChar(before) && !isTurkishWordChar(after)) return true;
    searchFrom = index + 1;
  }
}

// text is normalized internally (toLocaleLowerCase("tr-TR")) — callers
// pass the raw title text, never a pre-lowercased one, removing the risk
// of a caller forgetting to normalize (or normalizing with the wrong,
// locale-unaware .toLowerCase()) before calling this.
export function hasAnyWordBoundaryMatch(text: string, keywords: string[]): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return keywords.some((keyword) => hasWordBoundaryMatch(normalized, keyword.toLocaleLowerCase("tr-TR")));
}

// Real-estate/property/zoning relevance vocabulary — deliberately scoped
// narrower than discover.ts's own broader BASE_TOPIC_KEYWORDS (which also
// covers rent/credit/economic-data terms relevant to TCMB's ALREADY-
// real-estate-only feed). This filter's job is different: it decides
// whether an item from a source that covers many UNRELATED government
// topics belongs in the pipeline AT ALL, so it stays centered on
// unambiguous property/construction/zoning vocabulary.
export const REAL_ESTATE_RELEVANCE_KEYWORDS = [
  "tapu",
  "imar",
  "kadastro",
  "gayrimenkul",
  "arsa",
  "parsel",
  "konut",
  "inşaat",
  "yapı",
  "kentsel dönüşüm",
  "mekansal plan",
  "çevre düzeni planı",
];
