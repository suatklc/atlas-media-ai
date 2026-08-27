import type { ContentIntent } from "./types";

// Returns two locale-normalized readings of the same text rather than one
// merged string. The Turkish "dotted/dotless I" pair can't be resolved by a
// single context-free lowercase pass: tr-TR lowercases ASCII "I" to dotless
// "ı" (correct for Turkish words like "SATILIK" -> "satılık", but it turns
// "INSTAGRAM" into "ınstagram", which no longer matches "instagram"); en-US
// lowercases ASCII "I" to dotted "i" (fixes "INSTAGRAM", but leaves Turkish
// dotless-ı words unrecognizable in their own uppercase form). Keeping both
// readings and matching against either lets each word match under whichever
// locale actually applies to it, with no merging, transliteration, or
// language detection involved.
function normalizedViews(text: string): string[] {
  return [
    text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " "),
    text.toLocaleLowerCase("en-US").trim().replace(/\s+/g, " "),
  ];
}

// Bug fix (Handoff — content-intent false-positive classification): a
// phrase used to "match" via plain .includes(), so a trigger's characters
// merely APPEARING inside an unrelated word counted as a match — e.g. "ev"
// (a real listing keyword) matched inside "e-Devlet" (e-government, an
// entirely unrelated word), because "ev" happens to be a substring of
// "devlet". This is the generic replacement mechanism: a phrase only
// matches at a genuine Turkish-aware word/phrase boundary.
//
// JavaScript's regex \b is ASCII-only (\w = [A-Za-z0-9_]), so it silently
// fails at the edge of a Turkish word ending/starting with ç/ğ/ı/ö/ş/ü —
// the same class of bug already fixed once in creative/image-prompt.ts's
// turkishWordBoundarySource. That fix is single-word-only and lives in
// creative/, a layer above content/ in this codebase's dependency
// direction (creative/ imports from content/, never the reverse), so it is
// duplicated here rather than imported — plus this needs to handle
// multi-word phrases ("konut projesi", "bir önceki yanıtını") as one
// contiguous boundary-checked span, not just single words.
const TURKISH_WORD_CHARS = "a-zA-ZçğıöşüÇĞİÖŞÜ0-9_";
const TURKISH_WORD_CHAR_PATTERN = new RegExp(`^[${TURKISH_WORD_CHARS}]$`);

function isTurkishWordChar(char: string | undefined): boolean {
  return char !== undefined && TURKISH_WORD_CHAR_PATTERN.test(char);
}

// A small, closed, deliberately bounded set of common Turkish suffix
// endings — NOT a full morphological analyzer (that would need a real
// Turkish stemmer, i.e. a new dependency, which this fix must not add).
// Right after a genuine left-boundary match, the trigger word may be
// followed by end-of-word OR exactly one of these — covering the common
// case/possessive suffix combinations ("evimi", "villamı", "arsanın"),
// vowel-buffer variants for vowel-ending roots ("arsayı", "villası"),
// plural ("evler"), and the verb-infinitive/agent-adjective derivational
// endings relevant to this file's own verb-root triggers ("öğretici",
// "hazırlamak"). A trigger followed by any LONGER run of word characters
// (e.g. "ev" inside "evrensel") is correctly rejected as a different word
// — this is the deliberate, disclosed limit of a dependency-free
// heuristic: it cannot distinguish that from a genuine, less-common
// Turkish inflection this list doesn't happen to include.
const COMMON_TURKISH_SUFFIXES = new Set([
  // bare case suffixes (consonant-final root)
  "i", "ı", "u", "ü", // accusative
  "e", "a", // dative
  "de", "da", "den", "dan", // locative / ablative
  "in", "ın", "un", "ün", // genitive
  // bare case suffixes, vowel-final root (buffer consonant y/n)
  "yi", "yı", "yu", "yü", // accusative
  "ye", "ya", // dative
  "nin", "nın", "nun", "nün", // genitive
  // possessive suffixes (consonant-final root) and 3rd-person w/ buffer s
  "im", "ım", "um", "üm", // 1sg
  "si", "sı", "su", "sü", // 3sg, vowel-final root
  "leri", "ları", // 3pl
  // possessive + accusative combos ("evimi", "villasını")
  "imi", "ımı", "umu", "ümü",
  "ini", "ını", "unu", "ünü",
  "sini", "sını", "sunu", "sünü",
  // plural
  "ler", "lar",
  // verb infinitive / agent-adjective derivational endings (for this
  // file's own verb-root triggers: öğret, yaz, üret, oluştur, hazırla)
  "mek", "mak",
  "ici", "ıcı", "ucu", "ücü",
]);

// Scans every occurrence of `needle` inside `haystack` (not just the
// first) and accepts the first one with a genuine left boundary (start of
// string, or preceded by a non-word character — this alone is what
// rejects "ev" inside "devlet") AND a genuine right boundary (end of
// string, a non-word character, or a recognized suffix from the list
// above immediately followed by a non-word character/end of string).
function hasWordBoundaryMatch(haystack: string, needle: string): boolean {
  if (!needle) return false;

  let searchFrom = 0;
  for (;;) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) return false;

    const before = index > 0 ? haystack[index - 1] : undefined;
    if (!isTurkishWordChar(before)) {
      const afterStart = index + needle.length;
      let afterEnd = afterStart;
      while (afterEnd < haystack.length && isTurkishWordChar(haystack[afterEnd])) {
        afterEnd += 1;
      }
      const remainder = haystack.slice(afterStart, afterEnd);
      if (remainder === "" || COMMON_TURKISH_SUFFIXES.has(remainder)) {
        return true;
      }
    }

    searchFrom = index + 1;
  }
}

// A phrase matches if any of its own normalized readings appears, at a
// genuine word/phrase boundary, in any normalized reading of the message.
// Signals go through the identical normalizedViews() helper as the
// message for a mathematically consistent comparison (this only matters
// for phrases containing "I"/"İ"; today's phrases are already lowercase
// Turkish/English literals, so this is a no-op for them in practice, but
// keeps the guarantee general).
function hasAnyMatch(messageViews: string[], phrases: string[]): boolean {
  return phrases.some((phrase) =>
    normalizedViews(phrase).some((phraseView) =>
      messageViews.some((messageView) => hasWordBoundaryMatch(messageView, phraseView)),
    ),
  );
}

// Checked first, as a hard veto. Transform Action prompts must never
// activate content planning — they already carry their own "final content
// only" instruction and target a previous reply, not a new content brief.
const TRANSFORM_META_EXCLUSIONS = [
  "bir önceki yanıtını",
  "dönüştür",
  "yalnızca son paylaşım metnini ver",
  "yalnızca son mesaj metnini ver",
  "yalnızca konu satırı ve e-posta gövdesini ver",
];

// A non-none intent requires a creation signal in addition to a subject
// signal — a domain keyword alone must never activate content planning.
const CREATION_SIGNALS = [
  "hazırla",
  "yaz",
  "oluştur",
  "üret",
  "paylaşım",
  "gönderi",
  "post",
  "carousel",
  "içerik",
  "görsel",
  "sosyal medya",
  "instagram",
  "linkedin",
  "facebook",
  "create",
  "generate",
  "prepare",
];

// Bug fix (Handoff — content-intent priority false-positive): "listing"
// previously mixed SUBJECT nouns (villa, daire, ev, mülk, konut, arsa,
// residence, property, properties, estate, rezidans, "konut projesi") with
// genuine listing PURPOSE/action signals (ilan, satılık, kiralık). Since
// listing was checked first and a bare subject noun was enough to match
// it, any message merely mentioning a property type — regardless of its
// actual purpose (education, market analysis, comparison) — was
// misclassified as "listing". A property noun describes WHAT the content
// is about, not WHY the user wants it; it must never by itself prove
// listing intent. The fix: "listing" now contains ONLY purpose/action
// signals — a message needs one of these, not merely a property noun, to
// resolve as "listing". Property nouns are no longer matched against any
// category at all here (they still reach the model as ordinary message
// text; this file only decides structured-content-plan intent). A few
// purpose phrasings genuinely missing from the original list are added
// (satışa çıkar/sun, kiraya ver, portföy, tanıtım) — the same class of
// signal as the existing ilan/satılık/kiralık, not new vocabulary outside
// that concept.
//
// A second, related fix: "market-stats" previously had no vocabulary for
// price/rate/change/development/analysis language (fiyat, faiz, değişim,
// gelişme, analiz), so a genuinely market-analysis message fell through
// to whatever else matched — often "educational" via the generic verb
// "anlat" ("explain"), which describes HOW a response should be phrased
// more than WHAT category it belongs to. "market-stats" is now checked
// before "educational" (moved up one position; "listing" stays first,
// "comparison" stays directly after "educational" so an explicit
// comparison request naturally accompanied by "anlat"/"hakkında" still
// resolves "educational" first, unchanged from before — see
// content-intent.test.mjs's "farkları anlat" case) so a message that
// genuinely carries market-analysis vocabulary is classified as
// market-stats even when it also contains a generic explanatory verb.
// "educational"'s own vocabulary also gained "dikkat" ("[nelere] dikkat
// edilmeli", "dikkat edilmesi gereken") — a common, generic Turkish
// advisory/checklist phrasing pattern that had no existing trigger at all.
//
// Declaration order is still the deterministic tie-break when more than
// one category matches: listing, market-stats, educational, comparison,
// announcement. First match wins.
const SUBJECT_SIGNALS: { intent: Exclude<ContentIntent, "none">; patterns: string[] }[] = [
  {
    intent: "listing",
    patterns: [
      "ilan",
      "satılık",
      "kiralık",
      "portföy",
      "satışa çıkar",
      "satışa sun",
      "kiraya ver",
      "tanıtım",
    ],
  },
  {
    intent: "market-stats",
    patterns: ["istatistik", "piyasa", "trend", "rapor", "veri", "fiyat", "faiz", "değişim", "gelişme", "analiz"],
  },
  {
    intent: "educational",
    patterns: ["eğitici", "bilgilendirici", "öğret", "anlat", "ipuçları", "hakkında", "dikkat"],
  },
  { intent: "comparison", patterns: ["karşılaştır", "fark"] },
  { intent: "announcement", patterns: ["duyuru", "haber", "yeni hizmet", "yeni ofis", "açılış"] },
];

export function detectContentIntent(message: string): ContentIntent {
  const messageViews = normalizedViews(message);

  if (hasAnyMatch(messageViews, TRANSFORM_META_EXCLUSIONS)) {
    return "none";
  }

  if (!hasAnyMatch(messageViews, CREATION_SIGNALS)) {
    return "none";
  }

  for (const subject of SUBJECT_SIGNALS) {
    if (hasAnyMatch(messageViews, subject.patterns)) {
      return subject.intent;
    }
  }

  return "none";
}
