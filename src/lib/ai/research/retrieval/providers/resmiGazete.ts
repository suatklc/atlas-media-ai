import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { parseTurkishLongDate } from "../turkishDate";

// NOT currently registered in retrieval/router.ts's ADAPTERS list — see
// that file's own comment for the exact reason (a TLS certificate-chain
// failure specific to this host when fetched via Node's native fetch:
// `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, reproducible, while the identical
// request via curl on the same machine succeeds). This module's
// extraction logic IS real and verified: resmigazete.gov.tr's homepage
// SERVER-RENDERS today's complete table of contents (fihrist) directly in
// the HTML (confirmed via curl against the live site, not assumed/
// guessed), and the parsing below was tested against that real captured
// markup. Historical dates via the site's own
// /fihrist?tarih=YYYY-MM-DD query parameter were also investigated but
// found unreliable during testing (intermittent hangs/timeouts) — this
// adapter is scoped to TODAY's issue only regardless, since that's what a
// "current opportunities" engine actually needs. Kept in the codebase,
// not deleted, so it can be registered again once the TLS issue has a
// safe resolution (e.g. the production deployment's own Node/TLS
// environment trusts this certificate chain even though this task's
// investigation environment does not — that was not able to be confirmed
// here).
const HOMEPAGE_URL = "https://www.resmigazete.gov.tr/";
const FETCH_TIMEOUT_MS = 10_000;
// The real homepage observed during investigation was ~200KB; this is a
// generous safety cap, not a tuned expectation.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// NOT every Resmî Gazete publication is real-estate content (the Gazette
// covers all government topics) — only entries whose title genuinely
// concerns property/title-deed/zoning/construction/housing are kept.
// Turkish-aware WORD-BOUNDARY matching is required here, not naive
// substring matching: live testing against a real issue found that a
// substring check on "yapı" (building/structure, a real, intended
// keyword) also matched the extremely common bureaucratic phrase
// "değişiklik YAPILMASINA" ("to make an amendment" — a conjugated form of
// the unrelated verb "yapmak") purely because "yapı" happens to appear as
// a substring of "yapılmasına". Without word-boundary matching this
// keyword alone would have flagged nearly every entry in a typical issue
// as "relevant" — the same class of bug already fixed once in
// content/intent.ts, applied here independently since research/ has no
// reason to import from content/ for this.
const RELEVANCE_KEYWORDS = ["tapu", "imar", "kadastro", "gayrimenkul", "arsa", "parsel", "konut", "inşaat", "yapı"];

const TURKISH_WORD_CHARS = "a-zA-ZçğıöşüÇĞİÖŞÜ0-9_";
const TURKISH_WORD_CHAR_PATTERN = new RegExp(`^[${TURKISH_WORD_CHARS}]$`);

function isTurkishWordChar(char: string | undefined): boolean {
  return char !== undefined && TURKISH_WORD_CHAR_PATTERN.test(char);
}

function hasWordBoundaryMatch(haystack: string, needle: string): boolean {
  let searchFrom = 0;
  for (;;) {
    const index = haystack.indexOf(needle, searchFrom);
    if (index === -1) return false;
    const before = index > 0 ? haystack[index - 1] : undefined;
    const after = haystack[index + needle.length];
    if (!isTurkishWordChar(before) && !isTurkishWordChar(after)) return true;
    searchFrom = index + 1;
  }
}

async function fetchHomepageHtml(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(HOMEPAGE_URL, {
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The homepage's own heading reads e.g. "27 Ağustos 2026 Tarihli ve 33353
// Sayılı Resmî Gazete" — this is the issue's real publication date, used
// as every entry's publishedAt (the fihrist itself carries no per-entry
// date; every entry in one issue shares the issue's own date).
function extractIssueDate(html: string): string | null {
  const match = html.match(/(\d{1,2}\s+\p{L}+\s+\d{4})\s+Tarihli/u);
  return match ? parseTurkishLongDate(match[1]) : null;
}

// Minimal, bounded extraction of <div class="fihrist-item mb-1">
// <a href="...">title</a></div> — verified against real, live homepage
// HTML, not a guessed shape. Untrusted input: every extracted value is
// decoded as plain text data, never interpreted as markup or executed.
function extractFihristItems(html: string): { title: string; url: string }[] {
  const pattern = /<div class="fihrist-item mb-1"><a href="([^"]+)"[^>]*>(?:–– ?|– ?)?([\s\S]*?)<\/a><\/div>/g;
  const items: { title: string; url: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const url = decodeHtmlEntities(match[1].trim());
    const title = decodeHtmlEntities(match[2].trim());
    if (title && url) {
      items.push({ title, url });
    }
  }

  return items;
}

export async function fetchResmiGazeteAnnouncements(): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();

  let html: string;
  try {
    html = await fetchHomepageHtml();
  } catch (error) {
    console.error("Resmî Gazete retrieval failed:", error instanceof Error ? error.message : String(error));
    return [];
  }

  const publishedAt = extractIssueDate(html) ?? "";
  const items = extractFihristItems(html);

  const relevant = items.filter((item) => {
    const normalizedTitle = item.title.toLocaleLowerCase("tr-TR");
    return RELEVANCE_KEYWORDS.some((keyword) =>
      hasWordBoundaryMatch(normalizedTitle, keyword.toLocaleLowerCase("tr-TR")),
    );
  });

  return relevant.map((item) => ({
    title: item.title,
    publisher: "T.C. Resmî Gazete",
    url: item.url,
    // Empty string, never a guessed date, when the issue heading didn't
    // parse — same explicit-unknown convention as providers/tcmb.ts.
    publishedAt,
    tier: classifySourceTier(item.url),
    snippet: item.title,
    retrievedAt,
  }));
}
