import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { parseTurkishLongDate } from "../turkishDate";

// LIVE, real provider — the Turkish Land Registry and Cadastre General
// Directorate (TKGM)'s own public announcement/news listing pages. No API
// key: both pages SERVER-RENDER their entries (title, category badge,
// Turkish-formatted date, link) directly in the HTML — verified by live
// fetch. Unlike Resmî Gazete (a general-government gazette needing topic
// filtering), everything TKGM itself publishes is already title-deed/
// cadastral-domain content by definition — no relevance filter is applied
// here.
const ORIGIN = "https://www.tkgm.gov.tr";
const LISTING_PAGES: { url: string; publisher: string; basePath: string }[] = [
  { url: `${ORIGIN}/duyurular`, publisher: "Tapu ve Kadastro Genel Müdürlüğü (TKGM) — Duyurular", basePath: "/duyurular" },
  { url: `${ORIGIN}/haberler`, publisher: "Tapu ve Kadastro Genel Müdürlüğü (TKGM) — Haberler", basePath: "/haberler" },
];

const FETCH_TIMEOUT_MS = 10_000;
// These listing pages were observed live at ~2.7MB and ~4.5MB (full
// pages, not just the entry list) — this cap is a generous safety margin
// above that, not a tuned expectation.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

async function fetchListingHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/html" },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text/i.test(contentType)) {
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

// Minimal, bounded extraction of TKGM's real, live-verified card markup:
// <a class="group block ..." href="/duyurular/SLUG"><div class="flex
// flex-col gap-4"><h3 ...>TITLE</h3> ... <p ...>DD Ay YYYY</p>. Untrusted
// input: every extracted value is treated as plain text data, never
// executed. basePath scopes the pattern to only /duyurular or only
// /haberler links, so the two listing pages' entries are never confused
// with each other or with unrelated same-page links.
function extractListingItems(html: string, basePath: string): { title: string; url: string; dateText: string }[] {
  const escapedBasePath = basePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<a class="group block[^"]*" href="(${escapedBasePath}\\/[^"]+)"><div class="flex flex-col gap-4"><h3[^>]*>([\\s\\S]*?)<\\/h3>[\\s\\S]*?<p[^>]*>([^<]+)<\\/p>`,
    "g",
  );
  const items: { title: string; url: string; dateText: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const url = match[1].trim();
    const title = match[2].trim();
    const dateText = match[3].trim();
    if (title && url) {
      items.push({ title, url, dateText });
    }
  }

  return items;
}

export async function fetchTkgmAnnouncements(): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const results: NormalizedResearchResult[] = [];

  for (const page of LISTING_PAGES) {
    let html: string;
    try {
      html = await fetchListingHtml(page.url);
    } catch (error) {
      console.error(`TKGM listing retrieval failed (${page.url}):`, error instanceof Error ? error.message : String(error));
      continue;
    }

    for (const item of extractListingItems(html, page.basePath)) {
      const fullUrl = `${ORIGIN}${item.url}`;
      results.push({
        title: item.title,
        publisher: page.publisher,
        url: fullUrl,
        // Empty string, never a guessed date, when the card's own date
        // text didn't parse — same explicit-unknown convention as every
        // other adapter in this pipeline.
        publishedAt: parseTurkishLongDate(item.dateText) ?? "",
        tier: classifySourceTier(fullUrl),
        snippet: item.title,
        retrievedAt,
      });
    }
  }

  return results;
}
