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

// A phrase matches if any of its own normalized readings appears as a
// substring in any normalized reading of the message — signals go through
// the identical normalizedViews() helper as the message for a mathematically
// consistent comparison (this only matters for phrases containing "I"/"İ";
// today's phrases are already lowercase Turkish/English literals, so this
// is a no-op for them in practice, but keeps the guarantee general).
function hasAnyMatch(messageViews: string[], phrases: string[]): boolean {
  return phrases.some((phrase) =>
    normalizedViews(phrase).some((phraseView) =>
      messageViews.some((messageView) => messageView.includes(phraseView)),
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

// Fixed declaration order — the deterministic tie-break when more than one
// subject category matches: listing, educational, comparison, market-stats,
// announcement, in that order. First match wins.
const SUBJECT_SIGNALS: { intent: Exclude<ContentIntent, "none">; patterns: string[] }[] = [
  {
    intent: "listing",
    patterns: [
      "ilan",
      "satılık",
      "kiralık",
      "villa",
      "daire",
      "ev",
      "mülk",
      "konut",
      "arsa",
      "residence",
      "property",
      "properties",
      "estate",
      "rezidans",
      "konut projesi",
    ],
  },
  {
    intent: "educational",
    patterns: ["eğitici", "bilgilendirici", "öğret", "anlat", "ipuçları", "hakkında"],
  },
  { intent: "comparison", patterns: ["karşılaştır", "fark"] },
  { intent: "market-stats", patterns: ["istatistik", "piyasa", "trend", "rapor", "veri"] },
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
