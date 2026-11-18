import type { BusinessProfile } from "../context/businessProfile";
import type { NormalizedResearchResult } from "./retrieval/types";
import type { AdapterRunReport } from "./retrieval/types";
import type { RetrievalWindow } from "./retrieval/coverage";
import { oldestDate, reachesWindow } from "./retrieval/coverage";
import { capEvidenceText } from "./retrieval/evidenceExtraction";
import { classifySourceTier } from "./retrieval/sourceQuality";
import { radarDiag } from "./retrieval/diagnostics";
import type { RankedContentOpportunity } from "./retrieval/types";
import { buildContentOpportunities } from "./discover";
import { passesOwnerTitleScreen } from "../content/ownerProposals";

// Free RSS feeds of the sites the business named (BusinessProfile.newsFeeds,
// 2026-11-18): Gayrimenkul Gündemi (sector) and Sarıyer Posta (local news).
// Title, date and link come from the feed; when an item is a candidate the
// article's own body text is read (bounded) as its evidence. Coverage is
// what the feed actually spans — a short feed is reported, never presented
// as a scanned month. Non-article entries (photo galleries, videos) are
// ignored for both items and coverage. No AI, no paid call.

const FEED_TIMEOUT_MS = 10_000;
const ARTICLE_TIMEOUT_MS = 8_000;
const MAX_BYTES = 3 * 1024 * 1024;
export const MAX_ARTICLE_FETCHES = 8;
const NON_ARTICLE_PATH = /^\/(video|videolar|foto-galeri|galeri|fotogaleri)\//i;

export type FeedItem = {
  feedId: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string; // "" when the feed's date did not parse (never guessed)
  description: string;
};

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[name] ?? "")
    .replace(/&amp;/g, "&");
}

function textOf(html: string): string {
  return decodeXml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function field(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return match ? decodeXml(match[1]).trim() : "";
}

function isArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !NON_ARTICLE_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function parseFeed(xml: string, feedId: string, publisher: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw = match[1];
    const title = textOf(field(raw, "title"));
    const url = field(raw, "link");
    if (!title || !isArticleUrl(url)) continue;
    const date = new Date(field(raw, "pubDate"));
    items.push({
      feedId,
      publisher,
      title,
      url,
      publishedAt: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
      description: textOf(field(raw, "description")),
    });
  }
  return items;
}

// The article's own paragraphs (Sarıyer Posta: property="articleBody";
// WordPress sites such as Gayrimenkul Gündemi: class="entry-content"),
// falling back to og:description. Never the page chrome.
export function extractArticleText(html: string): string | undefined {
  const start = html.search(/(?:item)?prop(?:erty)?="articleBody"|class="[^"]*entry-content/);
  if (start >= 0) {
    const region = html.slice(start, start + 60_000);
    const paragraphs = [...region.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1])).filter((text) => text.length >= 40);
    if (paragraphs.length > 0) return capEvidenceText(paragraphs.join("\n"));
  }
  const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/);
  const fallback = og ? textOf(og[1]) : "";
  return fallback.length >= 40 ? capEvidenceText(fallback) : undefined;
}

async function fetchText(url: string, timeoutMs: number, accept: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new Error("too large");
  return new TextDecoder("utf-8").decode(buffer);
}

export type OwnerFeedsResult = {
  items: FeedItem[];
  reports: Record<string, AdapterRunReport>;
};

// Reads every configured feed (in parallel). Never throws.
export async function fetchOwnerFeeds(profile: BusinessProfile, window?: RetrievalWindow): Promise<OwnerFeedsResult> {
  const reports: Record<string, AdapterRunReport> = {};
  const lists = await Promise.all(
    (profile.newsFeeds ?? []).map(async (feed) => {
      try {
        const items = parseFeed(await fetchText(feed.url, FEED_TIMEOUT_MS, "application/rss+xml, application/xml, text/xml"), feed.id, feed.name);
        // Coverage: everything after the oldest dated article was in the
        // feed; nothing before it was seen.
        const since = oldestDate(items.map((item) => item.publishedAt || undefined));
        reports[feed.id] = { status: "ok", coverage: { since, complete: since !== null && reachesWindow(since, window) } };
        radarDiag("owner-feed", { feed: feed.id, status: "ok", articles: items.length, since });
        return items;
      } catch (error) {
        reports[feed.id] = { status: "error" };
        radarDiag("owner-feed", { feed: feed.id, status: "error", error: error instanceof Error ? error.name : "Error" });
        return [];
      }
    }),
  );
  return { items: lists.flat(), reports };
}

// Feed items → RankedContentOpportunity for the existing news flow: a cheap
// title screen first (so only plausible owner items cost an article fetch),
// then article evidence, then discover.ts's own opportunity builder.
export async function collectOwnerFeedOpportunities(
  profile: BusinessProfile,
  window: RetrievalWindow | undefined,
  now: Date = new Date(),
): Promise<{ opportunities: RankedContentOpportunity[]; reports: Record<string, AdapterRunReport> }> {
  const { items, reports } = await fetchOwnerFeeds(profile, window);
  const screened = items
    .filter((item) => passesOwnerTitleScreen(item.title, item.publishedAt, profile, now))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const results = await withArticleEvidence(screened);
  const opportunities = buildContentOpportunities(
    results.map((result) => ({ ...result, editorialAngle: `Mülk sahipleri açısından: ${result.title}` })),
    now,
  );
  radarDiag("owner-feeds", { articles: items.length, screened: screened.length, read: results.length, opportunities: opportunities.length });
  return { opportunities, reports };
}

// Article text for the given items (bounded, parallel); RSS description as
// the fallback evidence. Returns NormalizedResearchResult for the existing
// opportunity pipeline (discover.ts buildContentOpportunities).
export async function withArticleEvidence(items: FeedItem[]): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  return Promise.all(
    items.slice(0, MAX_ARTICLE_FETCHES).map(async (item) => {
      let evidenceText: string | undefined;
      try {
        evidenceText = extractArticleText(await fetchText(item.url, ARTICLE_TIMEOUT_MS, "text/html"));
      } catch {
        // keep the description below
      }
      if (!evidenceText && item.description.length >= 40) evidenceText = capEvidenceText(item.description);
      return {
        title: item.title,
        publisher: item.publisher,
        url: item.url,
        publishedAt: item.publishedAt,
        tier: classifySourceTier(item.url),
        snippet: item.description || item.title,
        retrievedAt,
        evidenceText,
      };
    }),
  );
}
