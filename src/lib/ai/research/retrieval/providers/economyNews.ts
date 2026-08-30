import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { hasAnyWordBoundaryMatch, PROPERTY_MARKET_RELEVANCE_KEYWORDS } from "../relevance";

// Current Content Radar V1 — Layer 2 (news/market attention). LIVE, real
// provider — standard RSS 2.0 feeds from two established Turkish outlets,
// live-verified reachable during this task's own investigation:
//   - Anadolu Ajansı (AA), Economy category — Turkey's national wire
//     service; already category-scoped by the feed URL itself.
//   - Dünya Gazetesi — an established Turkish business/economy daily;
//     its feed is general/mixed (sports, breaking news, lifestyle,
//     international alongside economy), so it needs the same relevance
//     filter Resmî Gazete/ÇŞİDB already apply for their own "mixed
//     official source" content — see relevance.ts.
//
// No API key, no paid search, no scraping: RSS is a standard public
// syndication format both outlets publish openly. No new dependency —
// native fetch + a bounded regex extraction, the same pattern
// providers/tcmb.ts already established for its own XML/Atom feeds.
// Standard RSS <pubDate> is RFC 822 text ("Sun, 30 Aug 2026 15:19:09
// +0300"), natively parseable by `new Date(...)` — unlike tcmb.ts's own
// feed, no custom Turkish month table is needed here at all.
//
// This is Layer 2, NOT Layer 1: these are discovery signals from
// commercial press, not primary official sources — classifySourceTier
// resolves both domains to "financial-news" (below official-authority in
// TIER_SCORE, discover.ts), never "official-authority".
const ECONOMY_NEWS_FEEDS: { url: string; label: string; publisher: string }[] = [
  {
    url: "https://www.aa.com.tr/tr/rss/default?cat=ekonomi",
    label: "Anadolu Ajansı (AA) — Ekonomi",
    publisher: "Anadolu Ajansı (AA)",
  },
  {
    url: "https://www.dunya.com/rss",
    label: "Dünya Gazetesi",
    publisher: "Dünya Gazetesi",
  },
];

const FETCH_TIMEOUT_MS = 10_000;
// RSS feeds are normally tens of KB (the live-verified AA/Dünya feeds
// each carry ~25-30 items); this is a generous safety cap against an
// unexpectedly huge/misbehaving response, never a tuned expectation.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function fetchFeedText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/xml|text/i.test(contentType)) {
      throw new Error(`unexpected content-type "${contentType}"`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("response exceeded the size limit");
    }

    return Buffer.from(buffer).toString("utf-8");
  } finally {
    clearTimeout(timeout);
  }
}

const NAMED_XML_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

// Decodes the standard XML predefined entities (&lt; &gt; &quot; &apos;
// &amp;) plus numeric character references in both decimal (&#39;,
// &#039;, any digit count/padding) and hexadecimal (&#x27;) form. A
// decoder that only recognizes the bare literal string "&#39;" silently
// fails on a zero-padded reference — the exact live production defect
// this fixes: Dünya's own feed encoded an apostrophe as "&#039;" (not
// "&#39;"), which reached the UI undecoded ("Şimşek&#039;ten" instead of
// "Şimşek'ten"). &amp; is decoded LAST so a source that has already
// double-escaped a character (e.g. "&amp;#39;") is never mis-decoded a
// second time into something the source didn't actually mean.
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(lt|gt|quot|apos);/g, (_, name: string) => NAMED_XML_ENTITIES[name])
    .replace(/&amp;/g, "&");
}

// publishedAt === "" is this pipeline's explicit "unknown, never
// fabricated" convention (see every other provider) — a pubDate that
// doesn't parse falls back to it rather than a guessed date.
function parseRssPubDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type RawItem = { title: string; link: string; pubDate: string | null };

// Minimal, bounded RSS 2.0 <item> extraction — deliberately not a general
// XML parser (no new dependency), same principle as tcmb.ts's own Atom
// extractor. Untrusted input: every extracted value is treated as plain
// text data, never executed. RSS's <link> is plain text content (unlike
// Atom's <link href="...">), so it is extracted the same way as <title>.
function extractItems(xml: string): RawItem[] {
  const items: RawItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemPattern.exec(xml))) {
    const block = itemMatch[1];
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

    if (!titleMatch || !linkMatch) continue;

    const title = decodeXmlEntities(titleMatch[1].trim());
    const link = decodeXmlEntities(linkMatch[1].trim());
    const pubDate = pubDateMatch ? parseRssPubDate(decodeXmlEntities(pubDateMatch[1])) : null;

    if (!title || !link) continue;

    items.push({ title, link, pubDate });
  }

  return items;
}

// Fetches both feeds and returns their combined, relevance-filtered,
// normalized entries. One feed failing (network error, unexpected shape)
// is logged and skipped — it never fails the other feed or the caller's
// overall retrieval (see retrieval/router.ts, which already treats every
// adapter this way too; this per-feed isolation is an extra,
// adapter-internal layer of the same principle, matching tcmb.ts's own
// two-feed handling).
export async function fetchEconomyNewsAnnouncements(): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const results: NormalizedResearchResult[] = [];

  for (const feed of ECONOMY_NEWS_FEEDS) {
    let xml: string;
    try {
      xml = await fetchFeedText(feed.url);
    } catch (error) {
      console.error(
        `Economy news feed retrieval failed (${feed.label}):`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    const relevantItems = extractItems(xml).filter((item) =>
      hasAnyWordBoundaryMatch(item.title, PROPERTY_MARKET_RELEVANCE_KEYWORDS),
    );

    for (const item of relevantItems) {
      results.push({
        title: item.title,
        publisher: feed.publisher,
        url: item.link,
        publishedAt: item.pubDate ?? "",
        tier: classifySourceTier(item.link),
        snippet: item.title,
        retrievedAt,
      });
    }
  }

  return results;
}
