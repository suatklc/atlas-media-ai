import { SAFETY_CLAUSE, PHOTOGRAPHY_QUALITY_CLAUSE, GEOGRAPHIC_CONTEXT_CLAUSE, NEGATIVE_SPACE_CLAUSE } from "./image-prompt";

// Gold Standard V1 — a small, purpose-built composer for the Current
// Content Radar structured-package path, NOT a rewrite of image-prompt.ts's
// existing buildImagePrompt (which stays exactly as-is for the general
// chat path). visualBrief is already a clean, model-authored visual
// CONCEPT (never raw user prose, never rendered text) — this only adds
// the same safety/quality/format guarantees every other image prompt in
// this pipeline already gets, reusing those exact clauses rather than
// duplicating their text.
//
// Explicit Türkiye/İstanbul context clause (Gold Standard visual-quality
// bar): the observed defect this fixes is generic American-suburban-house
// imagery appearing for a Turkish real-estate context — a plain "villa"
// prompt with no country context lets the image model default to
// whatever "house" imagery is statistically dominant in its training
// data, which is not Turkish residential architecture.
const TURKISH_CONTEXT_CLAUSE =
  "Görsel Türkiye/İstanbul bağlamında, Türk şehir/konut mimarisine uygun olsun (örn. tipik Amerikan banliyö evi/beyaz çit gibi Türkiye dışı bir estetik OLMASIN); modern Türk gayrimenkul/mimari dilini yansıtsın.";

// EXPERT / portfolio content (owner-focused villa posts): a real production
// review found the generic visualBrief + Turkish-context clause still
// produced a suburban-looking house — not the property a premium villa
// owner identifies with. Explicit, restrained art direction for an
// illustrative (never a real listing) premium villa in the business
// profile's own region. News content keeps buildGoldStandardImagePrompt
// unchanged.
function premiumVillaArtDirection(region: string): string {
  return [
    `Kuzey İstanbul / ${region} bölgesinin ormana yakın, yeşil ve sakin villa yerleşimi karakteri`,
    "çağdaş, sade ve rafine mimariye sahip premium müstakil villa; doğal taş, ahşap ve geniş cam yüzeyler",
    "olgun ağaçlar ve bakımlı peyzajla çevrili geniş, mahremiyeti yüksek özel bahçe; ev ile bahçe arasında güçlü ilişki",
    "gösterişsiz lüks (understated luxury), gerçekçi mimari fotoğraf, doğal gün ışığı veya yumuşak akşamüstü ışığı, göz hizasına yakın doğal perspektif",
    "KAÇIN: Amerikan banliyö evi görünümü, abartılı köşk/saray ölçeği, Boğaz veya deniz manzarası, fantastik/yapay zekâ mimarisi, aşırı sinematik/HDR veya sahte görünüm",
  ].join("; ");
}

// The villa art direction above is only right when the content is actually
// about a home. Atlas's expert content covers the whole property scope
// (land, zoning, construction, market), so a land/zoning post must not get
// a villa cover: land vocabulary wins over residential vocabulary.
const LAND_TERMS = /(^|[^\p{L}])(arsa\p{L}*|arazi\p{L}*|parsel\p{L}*|tarla\p{L}*|imar\p{L}*)(?=$|[^\p{L}])/u;
const RESIDENTIAL_TERMS = /(^|[^\p{L}])(villa\p{L}*|müstakil\p{L}*|konut\p{L}*|ev(?:i|in\p{L}*|ler\p{L}*)?)(?=$|[^\p{L}])/u;

export function prefersVillaArtDirection(text: string): boolean {
  const normalized = text.toLocaleLowerCase("tr-TR");
  return RESIDENTIAL_TERMS.test(normalized) && !LAND_TERMS.test(normalized);
}

export function buildExpertVillaImagePrompt(visualBrief: string, region: string): string {
  const clauses = [
    premiumVillaArtDirection(region),
    visualBrief.trim(),
    PHOTOGRAPHY_QUALITY_CLAUSE,
    GEOGRAPHIC_CONTEXT_CLAUSE,
    NEGATIVE_SPACE_CLAUSE,
    "format: 4:5 (1080x1350), Instagram gönderisi için",
  ];
  return `${clauses.join("; ")}. ${SAFETY_CLAUSE}`;
}

export function buildGoldStandardImagePrompt(visualBrief: string): string {
  const clauses = [
    visualBrief.trim(),
    TURKISH_CONTEXT_CLAUSE,
    PHOTOGRAPHY_QUALITY_CLAUSE,
    GEOGRAPHIC_CONTEXT_CLAUSE,
    NEGATIVE_SPACE_CLAUSE,
    "format: 4:5 (1080x1350), Instagram gönderisi için",
  ];
  return `${clauses.join("; ")}. ${SAFETY_CLAUSE}`;
}
