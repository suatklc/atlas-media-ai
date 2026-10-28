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

// Sources whose entire remit is real property: everything they publish is
// in scope regardless of title wording (live-observed: TKGM's "2024/4
// Sayılı Genelge Değişikliği Hakkında Duyuru" — a citizenship-by-property
// valuation rule — names no property word in its title).
const PROPERTY_DOMAIN_HOSTS = ["tkgm.gov.tr"];

function isPropertyDomainSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLocaleLowerCase("en-US");
    return PROPERTY_DOMAIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

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

// url (optional): a property-domain source (TKGM) is in scope without
// property wording in the title — after the administrative-noise check.
export function classifyRealEstateScope(text: string, regionNames: string[] = [], url?: string): RealEstateScope {
  let normalized = ` ${tokens(text.toLocaleLowerCase("tr-TR")).join(" ")} `;
  if (hasPhrase(normalized, ADMINISTRATIVE_NOISE_PHRASES)) return "out";
  if (url && isPropertyDomainSource(url)) return "property";
  for (const name of NON_PROPERTY_NAMES) normalized = normalized.split(` ${name} `).join(" ");
  const words = tokens(normalized);
  if (hasStem(words, PROPERTY_STEMS) || hasPhrase(normalized, PROPERTY_PHRASES)) return "property";
  const regions = regionNames.map((name) => name.toLocaleLowerCase("tr-TR"));
  const namesRegion = hasStem(words, regions);
  if (namesRegion && hasStem(words, REGIONAL_DEVELOPMENT_STEMS)) return "property";
  if (hasStem(words, MACRO_STEMS) || hasPhrase(normalized, MACRO_PHRASES) || namesRegion) return "macro";
  return "out";
}
