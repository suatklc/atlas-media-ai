// Real-estate scope gate for Current Content Radar (Handoff 9): a topic is
// chosen because it means something for real estate FIRST, and current
// sources are used inside that frame — never a random general news item.
//
// Root cause this closes: retrieval/router.ts keeps any entry whose
// title/snippet merely CONTAINS one of the query keywords, and that query
// (discover.ts) includes generic economy/admin words ("satış", "fiyat",
// "faiz", "kredi", "enflasyon", "yatırım", "piyasa", "vergi", "yönetmelik"
// ...). A central-bank inflation report or an unrelated regulation therefore
// qualified as a "current content opportunity" with no property angle at
// all, and nothing downstream checked for one.
//
// Three buckets, from the item's own title + snippet:
//   - "property": names property / land / zoning / construction / title-
//     deed / rental / mortgage subject matter -> eligible as normal.
//   - "macro": only rate/inflation/credit vocabulary or only a region name
//     -> "when needed" material: used only to fill a shortlist that has too
//     few property topics, at most one, and only from an official/primary-
//     data source (see discover.ts). A region named together with a
//     development term (road, metro, plan, project) is "property".
//   - "out": anything else -> never a content opportunity.
// Deterministic, no AI, no network. Covers the whole property scope (homes,
// villas, land, zoning, construction, market data, regional development),
// never villas only.

export type RealEstateScope = "property" | "macro" | "out";

// Sources whose remit is real property (TKGM). Their notices often name no
// generic property word in the title (live-observed: "2024/4 Sayılı Genelge
// Değişikliği Hakkında Duyuru" — a citizenship-by-property valuation rule),
// so they get their own source-specific evaluation below — but NOT
// unconditional acceptance: TKGM also publishes holiday greetings, hiring
// notices and executive visits (live-observed "29 Ekim Cumhuriyet Bayramı").
const PROPERTY_DOMAIN_HOSTS = ["tkgm.gov.tr"];

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

export function isPropertyDomainSource(url: string): boolean {
  const host = parseUrl(url)?.hostname.toLocaleLowerCase("en-US");
  return Boolean(host && PROPERTY_DOMAIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

// Property-domain evaluation, over the title plus the official "Konu:"
// subject line when the adapter could read it (tkgm.ts appends it to the
// snippet). In scope when the text names property subject matter (the
// shared stems/phrases) or TKGM's own regulatory/registry vocabulary.
// Ceremonial items are out. Never "macro": nothing here is rate/inflation
// material. An amendment title alone ("Duyuru Değişikliği", "Genelge
// Güncellemesi") is NOT enough (production, 2026-11-02: a title-only
// "Duyuru Değişikliği" reached the shortlist) — its subject must be
// readable from the title or "Konu:" line, otherwise it fails closed.
const PROPERTY_DOMAIN_NOISE_STEMS = ["bayram", "kutlama"];
const PROPERTY_DOMAIN_STEMS = ["genelge", "yönetmeli", "tebliğ", "kararname", "mevzuat", "tescil", "harç"];
const PROPERTY_DOMAIN_PHRASES = ["kültür varlık", "usul ve esas"];

// Word-start stems: a token qualifies when it starts with one of these, so
// Turkish suffixes ("konutlar", "arsaların", "tapuda", "imarlı") match.
const PROPERTY_STEMS = [
  "konut",
  "villa",
  "rezidans",
  "apartman",
  "arsa",
  "arazi",
  "tarla",
  "parsel",
  "tapu",
  "kadastro",
  "takbis",
  "taşınmaz",
  "gayrimenkul",
  "emlak",
  "mülk",
  "imar",
  "inşaat",
  "yapılaş",
  "iskan",
  "iskân",
  "kira",
  "kiralık",
  "kiracı",
  "ipotek",
  "müteahhit",
  "gyo",
  "toki",
  "dask",
];

// Tokens that start like a property stem but mean something else.
const EXCLUDED_TOKENS = new Set(["kiraz", "kirazı", "kirazlar", "mülki", "mülkî"]);

// Names that contain a property word but are not property subject matter
// (banks), removed before classification.
const NON_PROPERTY_NAMES = ["yapı kredi", "emlak katılım"];

// Multi-word property phrases, matched at a word start.
const PROPERTY_PHRASES = [
  "kat karşılığı",
  "kentsel dönüşüm",
  "riskli yapı",
  "yapı ruhsat",
  "yapı denetim",
  "yapı kayıt",
  "mekansal plan",
  "çevre düzeni plan",
  "zorunlu deprem sigorta",
  "ev sahibi kiracı",
];

// A named region together with one of these is a regional development
// (new road, metro, plan, project) — real-estate relevant on its own.
const REGIONAL_DEVELOPMENT_STEMS = ["metro", "otoyol", "yol", "köprü", "tünel", "ulaşım", "altyapı", "proje", "plan", "yatırım"];

// Institutional/administrative notices (hiring, exams, appointments,
// ceremonial visits) — never content topics, whoever publishes them
// (live-observed on TKGM: "Sözleşmeli Bilişim Personel Alım İlanı", a
// minister's conference visit).
const ADMINISTRATIVE_NOISE_PHRASES = ["personel alım", "işçi alım", "sözleşmeli", "sınav", "atama", "staj", "ziyaret", "bakanımız", "tebrik", "anma", "taziye"];

const MACRO_STEMS = ["faiz", "enflasyon", "tüfe", "üfe", "kredi", "dezenflasyon"];
const MACRO_PHRASES = ["politika faizi", "para politikası", "fiyat istikrarı"];

function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function hasStem(words: string[], stems: string[]): boolean {
  return words.some((word) => !EXCLUDED_TOKENS.has(word) && stems.some((stem) => word.startsWith(stem)));
}

function hasPhrase(normalized: string, phrases: string[]): boolean {
  const spaced = ` ${tokens(normalized).join(" ")}`;
  return phrases.some((phrase) => spaced.includes(` ${phrase}`));
}

function classifyPropertyDomainItem(normalized: string): RealEstateScope {
  const words = tokens(normalized);
  if (hasStem(words, PROPERTY_DOMAIN_NOISE_STEMS)) return "out";
  if (hasStem(words, PROPERTY_STEMS) || hasPhrase(normalized, PROPERTY_PHRASES)) return "property";
  if (hasStem(words, PROPERTY_DOMAIN_STEMS) || hasPhrase(normalized, PROPERTY_DOMAIN_PHRASES)) return "property";
  return "out";
}

function normalize(text: string): string {
  let normalized = ` ${tokens(text.toLocaleLowerCase("tr-TR")).join(" ")} `;
  for (const name of NON_PROPERTY_NAMES) normalized = normalized.split(` ${name} `).join(" ");
  return normalized;
}

// url (optional): a property-domain source (TKGM) gets its own source-
// specific evaluation (above) — after the shared administrative-noise check.
export function classifyRealEstateScope(text: string, regionNames: string[] = [], url?: string): RealEstateScope {
  let normalized = ` ${tokens(text.toLocaleLowerCase("tr-TR")).join(" ")} `;
  if (hasPhrase(normalized, ADMINISTRATIVE_NOISE_PHRASES)) return "out";
  if (url && isPropertyDomainSource(url)) return classifyPropertyDomainItem(normalized);
  for (const name of NON_PROPERTY_NAMES) normalized = normalized.split(` ${name} `).join(" ");
  const words = tokens(normalized);
  if (hasStem(words, PROPERTY_STEMS) || hasPhrase(normalized, PROPERTY_PHRASES)) return "property";
  const regions = regionNames.map((name) => name.toLocaleLowerCase("tr-TR"));
  const namesRegion = hasStem(words, regions);
  if (namesRegion && hasStem(words, REGIONAL_DEVELOPMENT_STEMS)) return "property";
  if (hasStem(words, MACRO_STEMS) || hasPhrase(normalized, MACRO_PHRASES) || namesRegion) return "macro";
  return "out";
}

// ============================================================
// Editorial-value gate + topic-specific angle (production acceptance,
// 2026-11-02). Being property-related is not enough: a candidate reaches
// the shortlist only when its own text names a concrete property subject
// that a specific audience acts on (land, zoning, construction, title
// deed, rent, mortgage, housing, market, regional development — never
// villa-only). The angle is that audience + the source's own subject
// line; it states no consequence, impact, price or legal reading the
// source does not. No derivable angle -> no opportunity (never a generic
// filler sentence).
//
// Text used: title + snippet (the snippet carries TKGM's official "Konu:"
// line). Full TKGM evidence is deliberately NOT used to find the subject:
// every TKGM PDF carries "Tapu ve Kadastro" in its letterhead/distribution
// list, which would make any notice look like a title-deed topic. A
// "macro" item (rate/inflation) additionally reads its evidence: it
// qualifies only when the source itself links it to property.
// ============================================================

type AngleRule = { audience: string; matches: (words: string[], normalized: string) => boolean };

const GENERIC_PROPERTY_STEMS = ["taşınmaz", "gayrimenkul", "emlak", "mülk"];
const TRANSACTION_STEMS = ["edinim", "satış", "satın", "alım", "devir", "değerleme", "harç", "vergi", "intikal"];
const MARKET_STEMS = ["fiyat", "piyasa", "endeks", "yatırım", "talep", "satış", "değer"];

const ANGLE_RULES: AngleRule[] = [
  {
    audience: "Konut kredisi kullanacak alıcılar",
    matches: (w, n) => hasStem(w, ["ipotek"]) || hasPhrase(n, ["konut kredi"]),
  },
  {
    audience: "Konut sahipleri ve alıcıları",
    matches: (w, n) => hasStem(w, ["dask"]) || hasPhrase(n, ["zorunlu deprem sigorta"]),
  },
  {
    audience: "Ev sahipleri ve kiracılar",
    matches: (w, n) => hasStem(w, ["kira", "kiralık", "kiracı"]) || hasPhrase(n, ["ev sahibi kiracı"]),
  },
  { audience: "Arsa ve arazi sahipleri ile alıcıları", matches: (w) => hasStem(w, ["arsa", "arazi", "tarla", "parsel"]) },
  {
    audience: "İmar ve yapılaşma koşullarını izleyen mülk sahipleri ve yatırımcılar",
    matches: (w, n) => hasStem(w, ["imar", "yapılaş"]) || hasPhrase(n, ["mekansal plan", "çevre düzeni plan"]),
  },
  {
    audience: "Yapı sahipleri, müteahhitler ve yeni yapı alıcıları",
    matches: (w, n) =>
      hasStem(w, ["inşaat", "müteahhit", "iskan", "iskân"]) ||
      hasPhrase(n, ["yapı ruhsat", "yapı denetim", "yapı kayıt", "kentsel dönüşüm", "riskli yapı", "kat karşılığı"]),
  },
  {
    audience: "Tapu ve kadastro işlemi yapacak mülk sahipleri",
    matches: (w, n) => hasStem(w, ["tapu", "kadastro", "takbis", "tescil"]) || hasPhrase(n, ["kat mülkiyet", "kat irtifak"]),
  },
  {
    audience: "Taşınmaz alan, satan veya sahibi olanlar",
    matches: (w) => hasStem(w, GENERIC_PROPERTY_STEMS) && hasStem(w, TRANSACTION_STEMS),
  },
  {
    audience: "Gayrimenkul piyasasını izleyen alıcı ve yatırımcılar",
    matches: (w) => hasStem(w, ["gyo"]) || (hasStem(w, [...GENERIC_PROPERTY_STEMS, "konut", "villa"]) && hasStem(w, MARKET_STEMS)),
  },
  { audience: "Konut alıcıları ve sahipleri", matches: (w) => hasStem(w, ["konut", "villa", "rezidans", "apartman", "toki"]) },
];

// Words that only describe the document, not its subject ("2024/4 Sayılı
// Genelge Değişikliği Hakkında Duyuru", "Duyuru Değişikliği").
const BOILERPLATE_WORDS = new Set([
  "duyuru",
  "duyurusu",
  "değişiklik",
  "değişikliği",
  "güncelleme",
  "güncellemesi",
  "genelge",
  "genelgesi",
  "sayılı",
  "hakkında",
  "hk",
  "ilişkin",
  "basın",
  "konulu",
  "ilan",
  "ilanı",
]);

const SUBJECT_MARKER = " — Konu: ";

// The source's own subject: the official "Konu:" line when present, else
// the title. Undefined when it is only document boilerplate.
function sourceSubject(title: string, snippet: string): string | undefined {
  const markerAt = snippet.indexOf(SUBJECT_MARKER);
  const subject = (markerAt >= 0 ? snippet.slice(markerAt + SUBJECT_MARKER.length) : title)
    .replace(/\s+hk\.?$/iu, "")
    .trim();
  const meaningful = tokens(subject.toLocaleLowerCase("tr-TR")).filter(
    (word) => /\p{L}/u.test(word) && !BOILERPLATE_WORDS.has(word),
  );
  return meaningful.length >= 2 ? subject : undefined;
}

export type EditorialCandidate = { title: string; snippet: string; url: string; evidenceText?: string };

export function deriveEditorialAngle(candidate: EditorialCandidate, regionNames: string[] = []): string | undefined {
  const scope = classifyRealEstateScope(`${candidate.title} ${candidate.snippet}`, regionNames, candidate.url);
  if (scope === "out") return undefined;
  const subject = sourceSubject(candidate.title, candidate.snippet);
  if (!subject) return undefined;

  const text = scope === "macro" ? `${candidate.title} ${candidate.snippet} ${candidate.evidenceText ?? ""}` : `${candidate.title} ${candidate.snippet}`;
  const normalized = normalize(text);
  const words = tokens(normalized);
  const rule = ANGLE_RULES.find((entry) => entry.matches(words, normalized));
  if (rule) return `${rule.audience} açısından: ${subject}`;

  // A named region together with a development term (property scope only).
  const regions = regionNames.map((name) => name.toLocaleLowerCase("tr-TR"));
  if (scope === "property" && hasStem(words, regions) && hasStem(words, REGIONAL_DEVELOPMENT_STEMS)) {
    return `Bölgedeki mülk sahipleri ve yatırımcılar açısından: ${subject}`;
  }
  return undefined;
}
