import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { parseTurkishLongDate } from "../turkishDate";
import { hasAnyWordBoundaryMatch, REAL_ESTATE_RELEVANCE_KEYWORDS } from "../relevance";
import { fetchWithSystemTrust } from "../secureFetch";
import { errorKind, radarDiag, tally, type AdapterReport } from "../diagnostics";
import { reachesWindow, type RetrievalWindow } from "../coverage";

// Research Breadth Expansion v2: NOW REGISTERED in retrieval/router.ts.
// The previous blocker — Node's global fetch() rejecting this host with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE while curl succeeded — is fixed via
// secureFetch.ts's fetchWithSystemTrust, which uses the OS's own trusted
// certificate store (tls.getCACertificates("system"), a real Node 22+
// API — the same trust source curl already used), scoped to only this
// one call. This is NOT a TLS-verification bypass; see secureFetch.ts's
// own comment for the full reasoning and the live verification that
// proved it. This module's extraction logic IS real and verified:
// resmigazete.gov.tr's homepage SERVER-RENDERS today's complete table of
// contents (fihrist) directly in the HTML (confirmed via curl against the
// live site, not assumed/guessed), and the parsing below was tested
// against that real captured markup. Historical dates via the site's own
// /fihrist?tarih=YYYY-MM-DD query parameter were also investigated but
// found unreliable during testing (intermittent hangs/timeouts) — this
// adapter is scoped to TODAY's issue only regardless, since that's what a
// "current opportunities" engine actually needs. This same intermittent-
// availability characteristic was observed again during THIS task's live
// validation (the TLS fix itself was proven working — a clean 200 with
// real HTML — but repeated requests in the same session later timed out)
// — the existing timeout + try/catch/return-[] below already absorbs
// that safely; see router.ts's own per-adapter isolation for why one
// flaky source can never break the whole discovery request.
const HOMEPAGE_URL = "https://www.resmigazete.gov.tr/";
const FETCH_TIMEOUT_MS = 10_000;
// The real homepage observed during investigation was ~200KB; this is a
// generous safety cap, not a tuned expectation.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Standard fetch() first; the node:https system-CA path (secureFetch.ts) is
// only a fallback for a TLS/certificate error. Live (Handoff 9): fetch()
// returned 200 in ~115 ms while the node:https path timed out every time,
// so the old "always secureFetch" route had become the adapter's failure.
const TLS_ERROR_PATTERN = /CERT|SSL|TLS|ISSUER|SIGNATURE|SELF_SIGNED/i;

function isTlsError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  return TLS_ERROR_PATTERN.test(`${cause?.code ?? ""} ${cause?.message ?? ""}`);
}

async function fetchWithStandardFetch(): Promise<{ status: number; contentType: string; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(HOMEPAGE_URL, { signal: controller.signal, headers: { Accept: "text/html" } });
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("response exceeded the size limit");
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: Buffer.from(buffer).toString("utf-8"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHomepageHtml(): Promise<string> {
  let result: { status: number; contentType: string; text: string };
  try {
    result = await fetchWithStandardFetch();
  } catch (error) {
    if (!isTlsError(error)) throw error;
    radarDiag("resmi-gazete-fetch", { fallback: "secureFetch", reason: errorKind(error) });
    result = await fetchWithSystemTrust(HOMEPAGE_URL, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      accept: "text/html",
    });
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`request failed with status ${result.status}`);
  }
  if (!/html|text/i.test(result.contentType)) {
    throw new Error(`unexpected content-type "${result.contentType}"`);
  }

  return result.text;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// The homepage's own heading reads e.g. "27 Ağustos 2026 Tarihli ve 33353
// Sayılı Resmî Gazete" — this is the issue's real publication date, used
// as every entry's publishedAt (the fihrist itself carries no per-entry
// date; every entry in one issue shares the issue's own date).
// The heading is HTML-entity encoded on the live site ("17 Kas&#x131;m 2026
// Tarihli…", seen 2026-11-17) — decode first, or the month never matches and
// every entry silently got an empty date (= never inside the age window).
export function extractIssueDate(html: string): string | null {
  const match = decodeHtmlEntities(html).match(/(\d{1,2}\s+\p{L}+\s+\d{4})\s+Tarihli/u);
  return match ? parseTurkishLongDate(match[1]) : null;
}

// The issue date is also in every entry's own URL
// (".../eskiler/2026/11/20261117-3.pdf") — the most reliable per-entry date,
// independent of heading markup. Turkey midnight, like parseTurkishLongDate.
export function issueDateFromUrl(url: string): string | null {
  const match = url.match(/\/eskiler\/(\d{4})\/(\d{2})\/(\d{4})(\d{2})(\d{2})[-.]/);
  if (!match || match[1] !== match[3] || match[2] !== match[4]) return null;
  const parsed = new Date(`${match[3]}-${match[4]}-${match[5]}T00:00:00+03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

// Source-Grounding Minimal Fix: deliberately NOT fetching each item's own
// detail page here. Resmî Gazete fihrist entries link to the individual
// gazette document itself, which is commonly a PDF rather than an HTML
// page — parsing that would need a new dependency (out of scope), and
// this adapter is already documented above as intermittently flaky, so a
// second per-item request for uncertain payoff isn't worth the added
// failure surface. evidenceText is simply left absent for every item —
// the safe, correct behavior when genuine evidence can't be captured;
// content-package generation already treats an absent evidenceText as
// "headline-only" and constrains itself accordingly.
// ---------------------------------------------------------------------------
// Archive coverage (2026-11-17): the homepage alone is ONE day, while the
// dashboard promises a 30-day window. The site keeps every past issue as a
// static index page, /eskiler/YYYY/MM/YYYYMMDD.htm (windows-1254, live
// 28–370 ms) — unlike the /fihrist?tarih= query found unreliable earlier.
// When a window is given, those day pages are read back to its start,
// bounded (MAX_ARCHIVE_DAYS requests, ARCHIVE_CONCURRENCY at a time,
// ARCHIVE_TIMEOUT_MS each). A day that cannot be read is reported, never
// guessed; entries keep their own issue date, so an old issue is never
// presented as new.
// ---------------------------------------------------------------------------
const ORIGIN = "https://www.resmigazete.gov.tr";
export const MAX_ARCHIVE_DAYS = 30;
const ARCHIVE_CONCURRENCY = 6;
const ARCHIVE_TIMEOUT_MS = 8_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;

type IssueDay = { year: string; month: string; day: string };

// Turkey calendar day `daysBack` days before `now`.
export function turkeyIssueDay(now: Date, daysBack: number): IssueDay {
  const shifted = new Date(now.getTime() + TURKEY_OFFSET_MS - daysBack * DAY_MS);
  return {
    year: String(shifted.getUTCFullYear()),
    month: String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    day: String(shifted.getUTCDate()).padStart(2, "0"),
  };
}

// Turkey midnight of an issue day as an ISO instant (same convention as
// parseTurkishLongDate).
export function issueDayIso({ year, month, day }: IssueDay): string {
  return new Date(`${year}-${month}-${day}T00:00:00+03:00`).toISOString();
}

export function archiveIndexUrl({ year, month, day }: IssueDay): string {
  return `${ORIGIN}/eskiler/${year}/${month}/${year}${month}${day}.htm`;
}

// Archive day page: <a href="20261116-1.htm">––&nbsp; Title</a>. Only the
// issue's own entries (YYYYMMDD-N.htm/pdf) — the announcement-section
// links (main.aspx?...ilanlar...) are section indexes, not entries.
export function extractArchiveItems(html: string, issue: IssueDay): { title: string; url: string }[] {
  const stamp = `${issue.year}${issue.month}${issue.day}`;
  const pattern = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const items: { title: string; url: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const href = match[1].trim();
    const file = href.split("/").pop() ?? "";
    if (!new RegExp(`^${stamp}-\\d+\\.(?:htm|pdf)$`, "i").test(file)) continue;
    const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .replace(/^[\s–-]+/, "")
      .trim();
    if (title) items.push({ title, url: `${ORIGIN}/eskiler/${issue.year}/${issue.month}/${file}` });
  }
  return items;
}

async function fetchArchiveDay(issue: IssueDay): Promise<{ title: string; url: string }[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARCHIVE_TIMEOUT_MS);
  try {
    const response = await fetch(archiveIndexUrl(issue), { signal: controller.signal, headers: { Accept: "text/html" } });
    if (!response.ok) throw new Error(`request failed with status ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error("response exceeded the size limit");
    // These static pages are windows-1254 (Turkish), not UTF-8.
    return extractArchiveItems(new TextDecoder("windows-1254").decode(buffer), issue);
  } finally {
    clearTimeout(timeout);
  }
}

// Number of past issues needed to reach the window start (0 = homepage only).
export function archiveDaysFor(now: Date, window?: RetrievalWindow): number {
  if (!window?.notBefore) return 0;
  const days = Math.ceil((now.getTime() - window.notBefore.getTime()) / DAY_MS);
  return Math.max(0, Math.min(MAX_ARCHIVE_DAYS, days));
}

type Entry = { title: string; url: string; publishedAt: string };

export async function fetchResmiGazeteAnnouncements(
  report?: AdapterReport,
  window?: RetrievalWindow,
  now: Date = new Date(),
): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const entries: Entry[] = [];
  // dayRead[k] = issue k days back was read (0 = today's homepage).
  const archiveDays = archiveDaysFor(now, window);
  const dayRead: boolean[] = new Array(archiveDays + 1).fill(false);
  const failures: Record<string, number> = {};

  try {
    const html = await fetchHomepageHtml();
    const issueDate = extractIssueDate(html);
    for (const item of extractFihristItems(html)) {
      entries.push({ ...item, publishedAt: issueDateFromUrl(item.url) ?? issueDate ?? "" });
    }
    dayRead[0] = true;
  } catch (error) {
    console.error("Resmî Gazete retrieval failed:", error instanceof Error ? error.message : String(error));
    tally(failures, `today: ${errorKind(error)}`);
  }

  // Bounded worker pool over days 1..archiveDays.
  let next = 1;
  async function worker() {
    while (next <= archiveDays) {
      const daysBack = next++;
      const issue = turkeyIssueDay(now, daysBack);
      try {
        const items = await fetchArchiveDay(issue);
        const publishedAt = issueDayIso(issue);
        for (const item of items) entries.push({ ...item, publishedAt });
        dayRead[daysBack] = true;
      } catch (error) {
        tally(failures, `archive: ${errorKind(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ARCHIVE_CONCURRENCY, archiveDays) }, worker));

  for (const [kind, count] of Object.entries(failures)) report?.fail(`${kind}×${count}`);

  // Coverage = the contiguous run of read issues starting today: a missing
  // day in the middle means nothing before it counts as fully scanned.
  let contiguous = -1;
  while (contiguous + 1 < dayRead.length && dayRead[contiguous + 1]) contiguous++;
  const since = contiguous < 0 ? null : issueDayIso(turkeyIssueDay(now, contiguous));
  report?.coverage?.({ since, complete: since !== null && reachesWindow(since, window) });

  const deduped = [...new Map(entries.map((entry) => [entry.url, entry])).values()];
  const relevant = deduped.filter((entry) => hasAnyWordBoundaryMatch(entry.title, REAL_ESTATE_RELEVANCE_KEYWORDS));
  radarDiag("resmi-gazete", {
    status: dayRead.every(Boolean) ? "ok" : dayRead.some(Boolean) ? "partial" : "error",
    issuesRead: dayRead.filter(Boolean).length,
    issuesWanted: dayRead.length,
    undated: deduped.filter((entry) => !entry.publishedAt).length,
    extracted: deduped.length,
    relevant: relevant.length,
    ...(Object.keys(failures).length > 0 ? { failures } : {}),
  });

  return relevant.map((entry) => ({
    title: entry.title,
    publisher: "T.C. Resmî Gazete",
    url: entry.url,
    // The entry's own issue date; empty string (never a guess) only when
    // neither the URL nor the heading carried one.
    publishedAt: entry.publishedAt,
    tier: classifySourceTier(entry.url),
    snippet: entry.title,
    retrievedAt,
  }));
}
