import type { BusinessProfile, ContentIdea, OwnerTheme } from "../context/businessProfile";
import type { RankedContentOpportunity } from "../research/retrieval/types";
import { classifyGeoScope, homeAreaNames } from "../research/turkishPlaces";

// Owner proposals (2026-11-17, selection reworked 2026-11-18): Atlas's goal
// is that people who want to sell a property in the business's area reach
// the advisor. "Güncel Konuları Bul" turns every collected development
// (Radar's official sources AND the business's own news feeds) into owner-
// facing proposals:
//
// - NEWS proposals: chosen by benefit to an owner, relevance to the
//   business's own area and recency — whether the source is official gives
//   no priority. A news item must carry an owner signal in its title, fit a
//   theme, be dated within the last 30 days, and not be local to another
//   province/district, institutional promotion or clickbait. At most one
//   per theme, at most five, never padded with weaker items.
// - EVERGREEN expert topics: kept apart, only for themes no news covered;
//   an old or undated news item is never relabelled as evergreen.
//
// Deterministic: no AI, no network. Picking a proposal only prepares the
// existing draft flow (news → the opportunity; evergreen → the expert
// instruction); nothing is generated until the user presses its button.

export type OwnerProposal = {
  themeId: string;
  themeLabel: string;
  kind: "current" | "evergreen";
  title: string;
  benefit: string;
  format: string;
  // source.title = the ORIGINAL news headline; the card's own title is the
  // owner-facing proposal headline.
  source?: { name: string; url: string; publishedAt?: string; title?: string };
  // "fact": official/primary source → the grounded news flow.
  // "context": sector/local news → the expert flow; its figures, dates and
  //   tax/legal statements are never carried into the draft.
  // "inspiration": a site found by the (paid, disabled) web search.
  sourceRole?: "fact" | "context" | "inspiration";
  // Where the development applies, stated on the card (never implied).
  scopeNote?: string;
  opportunity?: RankedContentOpportunity;
  instruction?: string;
  // Why a news item was chosen (deterministic score parts), for review.
  score?: { total: number; theme: number; locality: number; recency: number };
};

const lower = (text: string) => text.toLocaleLowerCase("tr-TR");
const DAY_MS = 86_400_000;
const NEWS_MAX_AGE_DAYS = 30;
export const MAX_NEWS_PROPOSALS = 5;

// Institutional promotion (minister statements, ceremonies, summit and
// praise stories) is not something an owner can act on.
const PROMO_MARKERS = ["bakan ", "bakanı ", "konuştu", "ziyaret", "tören", "övgü", "katıldı", "buluştu", "zirve", "cop3", "anlattı", "başarısı"];
// Sensational framing is not a trustworthy basis for an owner post.
const CLICKBAIT_MARKERS = ["şaşkına", "şok ", "inanılmaz", "kağıt gibi", "bomba", "olay yaratan", "herkes bunu"];

export function isInstitutionalPromo(title: string): boolean {
  const text = lower(title);
  return PROMO_MARKERS.some((marker) => text.includes(marker));
}

export function isClickbait(title: string): boolean {
  const text = lower(title);
  return CLICKBAIT_MARKERS.some((marker) => text.includes(marker));
}

function words(text: string): string[] {
  return lower(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// A stem matches when its words appear consecutively, each as a word prefix
// ("konut satış" matches "konut satışları").
function countStems(text: string, stems: string[]): number {
  const haystack = words(text);
  return stems.filter((stem) => {
    const needle = words(stem);
    return haystack.some((_, start) => needle.every((part, offset) => haystack[start + offset]?.startsWith(part)));
  }).length;
}

// Cheap title-only screen (used before reading article pages): dated within
// the window, owner signal, not promotion/clickbait, not local elsewhere.
export function passesOwnerTitleScreen(title: string, publishedAt: string, profile: BusinessProfile, now: Date): boolean {
  const published = publishedAt ? new Date(publishedAt).getTime() : NaN;
  if (Number.isNaN(published)) return false;
  const ageDays = (now.getTime() - published) / DAY_MS;
  if (ageDays < 0 || ageDays > NEWS_MAX_AGE_DAYS) return false;
  if (isInstitutionalPromo(title) || isClickbait(title)) return false;
  if (countStems(title, profile.contentStrategy?.ownerSignalStems ?? []) === 0) return false;
  return classifyGeoScope(title, homeAreaNames(profile.geography)).kind !== "elsewhere";
}

export type LocalityLevel = "neighbourhood" | "district" | "province" | "national";
export type Locality = { level: LocalityLevel; place?: string; mahalle?: string };
type Scored = {
  opportunity: RankedContentOpportunity;
  theme: OwnerTheme;
  score: NonNullable<OwnerProposal["score"]>;
  date: number;
  locality: Locality;
};

// How close a development is to the business's own area. Only the primary
// area and its neighbouring villages count as "neighbourhood"; a story that
// names only the district (e.g. another Sarıyer neighbourhood such as
// Poligon) is district-level context, not a direct concern of a seller in
// the primary area.
// The province is judged on the title only: a national story's body often
// lists cities ("Satışlarda İstanbul'u Ankara ve İzmir izledi").
export function localityOf(title: string, body: string, profile: BusinessProfile): Locality {
  const text = `${title} ${body}`;
  const tokens = words(text);
  const { primary, nearby, district, province } = profile.geography;
  const areaWords = new Set([district, province].filter((name): name is string => Boolean(name)).map(lower));
  const neighbourhoods = [primary, ...nearby].filter((name) => !areaWords.has(lower(name)));
  const mahalleMatch = text.match(/(\p{Lu}\p{L}+)\s*(?:['’]\p{L}*\s+)?Mahalle/u);
  const mahalle = mahalleMatch ? `${mahalleMatch[1]} Mahallesi` : undefined;
  const own = neighbourhoods.find((name) => tokens.includes(lower(name)));
  if (own) return { level: "neighbourhood", place: own, mahalle };
  if (district && tokens.includes(lower(district))) return { level: "district", place: district, mahalle };
  if (province && words(title).includes(lower(province))) return { level: "province", place: province };
  return { level: "national" };
}

const LOCALITY_POINTS: Record<LocalityLevel, number> = { neighbourhood: 3, district: 1, province: 0, national: 0 };

export function scopeNoteFor(locality: Locality, profile: BusinessProfile): string {
  const detail = locality.mahalle && locality.mahalle !== `${locality.place} Mahallesi` ? ` · ${locality.mahalle}` : "";
  switch (locality.level) {
    case "neighbourhood":
      return `Kapsam: ${locality.place}${detail}`;
    case "district":
      return `Kapsam: ${locality.place}${detail} — ${profile.geography.primary} için doğrudan değil, ilçe geneli bağlam`;
    case "province":
      return `Kapsam: ${locality.place} geneli — tek bir mahalleye veya mülke doğrudan uygulanmaz`;
    default:
      return "Kapsam: Türkiye geneli veri — bölgenize veya tek bir mülkün fiyatına doğrudan uygulanmaz";
  }
}

// The card's owner-facing headline: the theme's first template whose stems
// match the news title (templates carry no figure, place or promise).
export function proposalHeadline(theme: OwnerTheme, newsTitle: string): string {
  const templates = theme.newsHeadlines ?? [];
  const match = templates.find((entry) => !entry.stems || countStems(newsTitle, entry.stems) > 0);
  return match?.text ?? newsTitle;
}

const clamp = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

// Only official/primary sources may supply facts to a draft.
const FACT_TIERS = new Set(["official-authority", "primary-data"]);

// Expert-flow instruction for news from a non-official source: the news is
// only the starting point; its figures, dates and tax/legal statements are
// not carried over (the expert gate also blocks digits and ruling phrasing).
function contextInstruction(headline: string, entry: Scored, scopeNote: string, profile: BusinessProfile): string {
  const source = entry.opportunity.sources[0];
  return [
    `${profile.geography.primary} ve çevresinde mülkünü satmayı düşünen mülk sahiplerine "${headline}" sorusunu ele alan özgün bir uzman paylaşımı hazırla.`,
    // Clamped so the instruction stays within the draft API's 1000-char limit.
    `Çıkış noktası ${source.publisher} haberi: "${clamp(entry.opportunity.topic, 140)}". ${scopeNote}.`,
    "Haberdeki rakamları, oranları, tarihleri ve vergi/hukuk hükümlerini aktarma; bunların kişinin durumuna göre resmî kaynaktan veya uzmanından teyit edilmesi gerektiğini söyle.",
    "Genel veriyi bölgeye ya da tek bir mülkün fiyatına uyarlanmış bir sonuç gibi sunma.",
  ].join(" ");
}

export function scoreNewsCandidate(
  opportunity: RankedContentOpportunity,
  profile: BusinessProfile,
  now: Date,
): Scored | null {
  const themes = profile.contentStrategy?.ownerThemes ?? [];
  const title = opportunity.topic;
  const source = opportunity.sources[0];
  if (!source?.url || isInstitutionalPromo(title) || isClickbait(title)) return null;

  // Recency: undated or older than 30 days is not news (and never evergreen).
  const published = source.publishedAt ? new Date(source.publishedAt).getTime() : NaN;
  if (Number.isNaN(published)) return null;
  const ageDays = (now.getTime() - published) / DAY_MS;
  if (ageDays < 0 || ageDays > NEWS_MAX_AGE_DAYS) return null;

  // Owner signal must be in the title itself.
  if (countStems(title, profile.contentStrategy?.ownerSignalStems ?? []) === 0) return null;

  // Local to another province/district: judged on the title only — a
  // national story's body often lists other cities as examples. The own
  // area may be named in the body too ("Sarıyer Poligon Mahallesi'nde…").
  const home = homeAreaNames(profile.geography);
  if (classifyGeoScope(title, home).kind === "elsewhere") return null;
  const evidenceHead = (source.evidenceText ?? "").slice(0, 600);

  let best: { theme: OwnerTheme; points: number } | null = null;
  for (const theme of themes) {
    const points = countStems(title, theme.matchStems) * 2 + countStems(evidenceHead, theme.matchStems);
    if (points > 0 && (!best || points > best.points)) best = { theme, points };
  }
  // A development in the business's own area with an owner signal but no
  // theme word is still a regional development.
  const locality = localityOf(title, evidenceHead, profile);
  if (!best && (locality.level === "neighbourhood" || locality.level === "district")) {
    const regional = themes.find((theme) => theme.id === "regional");
    if (regional) best = { theme: regional, points: 1 };
  }
  if (!best) return null;

  const localityPoints = LOCALITY_POINTS[locality.level];
  const recency = ageDays <= 3 ? 2 : ageDays <= 7 ? 1 : 0;
  const themePoints = Math.min(best.points, 4);
  return {
    opportunity,
    theme: best.theme,
    score: { total: themePoints + localityPoints + recency, theme: themePoints, locality: localityPoints, recency },
    date: published,
    locality,
  };
}

export function buildOwnerProposals(
  profile: BusinessProfile,
  candidates: RankedContentOpportunity[],
  webProposals: OwnerProposal[] = [],
  now: Date = new Date(),
): OwnerProposal[] {
  const themes = profile.contentStrategy?.ownerThemes ?? [];
  const ideas = new Map<string, ContentIdea>((profile.contentStrategy?.ideas ?? []).map((idea) => [idea.id, idea]));

  // Same URL may arrive twice (e.g. Radar and a feed) — score it once.
  const seen = new Set<string>();
  const scored = candidates
    .filter((opportunity) => {
      const url = opportunity.sources[0]?.url ?? "";
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .map((opportunity) => scoreNewsCandidate(opportunity, profile, now))
    .filter((entry): entry is Scored => entry !== null)
    .sort((a, b) => b.score.total - a.score.total || b.date - a.date);

  const news: OwnerProposal[] = [];
  const coveredThemes = new Set<string>();
  for (const entry of scored) {
    if (news.length >= MAX_NEWS_PROPOSALS) break;
    if (coveredThemes.has(entry.theme.id)) continue;
    coveredThemes.add(entry.theme.id);
    const source = entry.opportunity.sources[0];
    const headline = proposalHeadline(entry.theme, entry.opportunity.topic);
    const scopeNote = scopeNoteFor(entry.locality, profile);
    const isFact = FACT_TIERS.has(source.tier);
    news.push({
      themeId: entry.theme.id,
      themeLabel: entry.theme.label,
      kind: "current",
      title: headline,
      benefit: entry.theme.benefit,
      // The expert (instruction) flow always produces a 5-slide carousel.
      format: isFact ? entry.theme.format : "Carousel",
      source: {
        name: source.publisher,
        url: source.url,
        publishedAt: source.publishedAt || undefined,
        title: entry.opportunity.topic,
      },
      sourceRole: isFact ? "fact" : "context",
      scopeNote,
      // Official/primary source → grounded news flow. Sector/local news →
      // expert flow with the news as context only.
      ...(isFact
        ? { opportunity: entry.opportunity }
        : { instruction: contextInstruction(headline, entry, scopeNote, profile) }),
      score: entry.score,
    });
  }
  // Web-search proposals (paid; off unless enabled) only for themes still
  // open, and only current ones (ownerWebSearch drops old/undated pages).
  for (const proposal of webProposals) {
    if (news.length >= MAX_NEWS_PROPOSALS) break;
    if (proposal.kind !== "current" || coveredThemes.has(proposal.themeId)) continue;
    coveredThemes.add(proposal.themeId);
    news.push(proposal);
  }

  // Evergreen expert topics, separate: only themes no news covered.
  const evergreen: OwnerProposal[] = [];
  const usedIdeas = new Set<string>();
  for (const theme of themes) {
    if (coveredThemes.has(theme.id)) continue;
    const idea = theme.ideaIds.map((id) => ideas.get(id)).find((candidate) => candidate && !usedIdeas.has(candidate.id));
    if (!idea) continue;
    usedIdeas.add(idea.id);
    evergreen.push({
      themeId: theme.id,
      themeLabel: theme.label,
      kind: "evergreen",
      title: idea.title,
      benefit: theme.benefit,
      // The expert (instruction) flow always produces a 5-slide carousel.
      format: "Carousel",
      // The idea's own verified reference page (about this exact subject), or none.
      source: idea.reference ? { name: idea.reference.name, url: idea.reference.url } : undefined,
      instruction: idea.instruction,
    });
  }
  return [...news, ...evergreen];
}
