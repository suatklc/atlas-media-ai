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
// shared stems/phrases) or TKGM's own regulatory/registry vocabulary; an
// announcement-amendment title on the /duyurular section ("Duyuru
// Değişikliği", "Genelge Güncellemesi") is in scope even title-only — it
// amends one of TKGM's own regulatory notices. Ceremonial items are out.
// Never "macro": nothing here is rate/inflation material.
const PROPERTY_DOMAIN_NOISE_STEMS = ["bayram", "kutlama"];
const PROPERTY_DOMAIN_STEMS = ["genelge", "yönetmeli", "tebliğ", "kararname", "mevzuat", "tescil", "harç"];
const PROPERTY_DOMAIN_PHRASES = ["kültür varlık", "usul ve esas"];
const ANNOUNCEMENT_AMENDMENT_STEMS = ["değişikli", "güncelleme"];
const ANNOUNCEMENT_SECTION_PATH = "/duyurular/";

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

function classifyPropertyDomainItem(normalized: string, url: string): RealEstateScope {
  const words = tokens(normalized);
  if (hasStem(words, PROPERTY_DOMAIN_NOISE_STEMS)) return "out";
  if (hasStem(words, PROPERTY_STEMS) || hasPhrase(normalized, PROPERTY_PHRASES)) return "property";
  if (hasStem(words, PROPERTY_DOMAIN_STEMS) || hasPhrase(normalized, PROPERTY_DOMAIN_PHRASES)) return "property";
  const isAnnouncement = parseUrl(url)?.pathname.startsWith(ANNOUNCEMENT_SECTION_PATH) ?? false;
  if (isAnnouncement && hasStem(words, ANNOUNCEMENT_AMENDMENT_STEMS)) return "property";
  return "out";
}

// url (optional): a property-domain source (TKGM) gets its own source-
// specific evaluation (above) — after the shared administrative-noise check.
export function classifyRealEstateScope(text: string, regionNames: string[] = [], url?: string): RealEstateScope {
  let normalized = ` ${tokens(text.toLocaleLowerCase("tr-TR")).join(" ")} `;
  if (hasPhrase(normalized, ADMINISTRATIVE_NOISE_PHRASES)) return "out";
  if (url && isPropertyDomainSource(url)) return classifyPropertyDomainItem(normalized, url);
  for (const name of NON_PROPERTY_NAMES) normalized = normalized.split(` ${name} `).join(" ");
  const words = tokens(normalized);
  if (hasStem(words, PROPERTY_STEMS) || hasPhrase(normalized, PROPERTY_PHRASES)) return "property";
  const regions = regionNames.map((name) => name.toLocaleLowerCase("tr-TR"));
  const namesRegion = hasStem(words, regions);
  if (namesRegion && hasStem(words, REGIONAL_DEVELOPMENT_STEMS)) return "property";
  if (hasStem(words, MACRO_STEMS) || hasPhrase(normalized, MACRO_PHRASES) || namesRegion) return "macro";
  return "out";
}
