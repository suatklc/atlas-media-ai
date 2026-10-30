import type { NormalizedResearchResult } from "../types";
import { classifySourceTier } from "../sourceQuality";
import { errorKind, radarDiag, tally, type AdapterReport } from "../diagnostics";
import { parseTurkishLongDate } from "../turkishDate";
import {
  toEvidenceTextOrUndefined,
  extractPdfTextOrUndefined,
  stripHtmlToText,
  MAX_PDF_BYTES,
} from "../evidenceExtraction";

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

// Reused for both the listing pages and each item's own detail page —
// same fetch safety (timeout, size cap, content-type check), just a
// different URL.
async function fetchHtml(url: string): Promise<string> {
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
    // TKGM's markup now wraps each card title in inline rich-text markup
    // (<span class="..."><p>TITLE</p></span>, verified live 2026-10) —
    // reduced to plain text so raw HTML never reaches a title/snippet,
    // relevance matching, or the dashboard.
    const title = stripHtmlToText(match[2]);
    const dateText = match[3].trim();
    if (title && url) {
      items.push({ title, url, dateText });
    }
  }

  return items;
}

// Source-Grounding Minimal Fix: best-effort, bounded-parallel fetch of
// each announcement's own detail page (as opposed to the listing card
// alone). A failure on any one item — network error, non-HTML response,
// or too little extractable text — simply leaves that item's
// evidenceText absent; it is NEVER substituted with the title. Capped at
// MAX_DETAIL_FETCHES so a future listing-page change (many more items)
// can't turn one discovery run into an unbounded number of requests.
const MAX_DETAIL_FETCHES = 12;

// TKGM Linked-PDF Evidence Extraction: every sampled TKGM announcement
// detail page is a thin stub whose real content lives in a linked PDF
// hosted on TKGM's own CMS media host — verified live against multiple
// real announcements, always the same relative-path shape. Deliberately
// a FIXED, hardcoded, trusted origin — only the PDF's own path (a
// tightly restricted character class: no "..", no alternate host, no
// protocol tricks) is ever read off the page; the host itself is never
// taken from page content, so this can't be used to fetch an arbitrary
// URL.
const PDF_MEDIA_ORIGIN = "https://cms-api.tkgm.gov.tr";
const PDF_LINK_PATTERN = /\/media-library\/[a-zA-Z0-9]+\.pdf/;
const PDF_FETCH_TIMEOUT_MS = 10_000;
const PDF_SIGNATURE = "%PDF";

function findLinkedPdfUrl(detailHtml: string): string | undefined {
  const match = detailHtml.match(PDF_LINK_PATTERN);
  return match ? `${PDF_MEDIA_ORIGIN}${match[0]}` : undefined;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/pdf" },
    });

    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/pdf/i.test(contentType)) {
      throw new Error(`unexpected content-type "${contentType}"`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("PDF exceeded the size limit");
    }

    const bytes = new Uint8Array(buffer);
    // Safe PDF signature check, in addition to Content-Type — a server
    // misconfiguration or an unexpected redirect target could still
    // claim "application/pdf" without actually being one.
    const signature = Buffer.from(bytes.slice(0, 4)).toString("latin1");
    if (signature !== PDF_SIGNATURE) {
      throw new Error("response does not have a valid PDF signature");
    }

    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

// TKGM's official correspondence (the linked PDF) states its own subject
// on a "Konu :" line, terminated by the next all-caps heading ("GENELGE",
// "GENEL MÜDÜRLÜK MAKAMINA", ...) or the "İlgi" references block —
// verified live against multiple real announcements. Many TKGM card
// titles carry no subject at all (e.g. "2024/2 Sayılı Genelge
// Güncellemesi Hakkında Duyuru"), so without this the item's snippet is
// just a repeat of an uninformative title. Genuine source text only; no
// match within the bound -> undefined, and the snippet stays the title.
const SUBJECT_LINE_PATTERN = /Konu\s*:\s*([\s\S]{3,200}?)(?=\s+(?:İlgi\b|[A-ZÇĞİÖŞÜ]{4,}\b))/u;

export function extractSubjectLine(evidenceText: string): string | undefined {
  const match = evidenceText.match(SUBJECT_LINE_PATTERN);
  const subject = match?.[1].replace(/\s+/g, " ").trim();
  return subject ? subject : undefined;
}

// Diagnostics only (Handoff 9): counts per outcome and per-phase durations
// (ms); behavior unchanged. Detail/PDF requests run in parallel, so the
// phase's wall time is close to its slowest item, not the sum.
type TkgmEvidenceStats = {
  detailOk: number;
  detailFailed: Record<string, number>;
  pdfOk: number;
  pdfNoText: number;
  pdfNotLinked: number;
  pdfFailed: Record<string, number>;
  detailMs: number[];
  pdfFetchMs: number[];
  pdfParseMs: number[];
};

function emptyEvidenceStats(): TkgmEvidenceStats {
  return { detailOk: 0, detailFailed: {}, pdfOk: 0, pdfNoText: 0, pdfNotLinked: 0, pdfFailed: {}, detailMs: [], pdfFetchMs: [], pdfParseMs: [] };
}

function msSummary(values: number[]): { n: number; max: number; sum: number } {
  return { n: values.length, max: values.length ? Math.max(...values) : 0, sum: values.reduce((a, b) => a + b, 0) };
}

async function attachDetailPageEvidence(
  results: NormalizedResearchResult[],
  stats: TkgmEvidenceStats = emptyEvidenceStats(),
): Promise<void> {
  await Promise.allSettled(
    results.slice(0, MAX_DETAIL_FETCHES).map(async (result) => {
      let detailHtml: string;
      const detailStartedAt = Date.now();
      try {
        detailHtml = await fetchHtml(result.url);
        result.evidenceText = toEvidenceTextOrUndefined(detailHtml);
        stats.detailOk += 1;
      } catch (error) {
        // Safe failure — evidenceText stays absent, never faked.
        tally(stats.detailFailed, errorKind(error));
        return;
      } finally {
        stats.detailMs.push(Date.now() - detailStartedAt);
      }

      // Prefer the real linked PDF's own text over the thin detail-page
      // stub, when one is discoverable and safely fetchable/parseable.
      // Any failure from here on simply keeps the detail-page evidence
      // already assigned above (which the existing evidence sufficiency
      // gate will correctly classify as thin) — never a fabricated
      // fallback, and never a crash.
      const pdfUrl = findLinkedPdfUrl(detailHtml);
      if (!pdfUrl) {
        stats.pdfNotLinked += 1;
        return;
      }
      try {
        const pdfStartedAt = Date.now();
        let pdfBytes: Uint8Array;
        try {
          pdfBytes = await fetchPdfBytes(pdfUrl);
        } finally {
          stats.pdfFetchMs.push(Date.now() - pdfStartedAt);
        }
        const parseStartedAt = Date.now();
        const pdfText = await extractPdfTextOrUndefined(pdfBytes);
        stats.pdfParseMs.push(Date.now() - parseStartedAt);
        if (pdfText) {
          result.evidenceText = pdfText;
          stats.pdfOk += 1;
        } else {
          stats.pdfNoText += 1;
        }
      } catch (error) {
        // Safe failure — keep the existing detail-page evidenceText.
        tally(stats.pdfFailed, errorKind(error));
      }
    }),
  );
}

export async function fetchTkgmAnnouncements(report?: AdapterReport): Promise<NormalizedResearchResult[]> {
  const retrievedAt = new Date().toISOString();
  const results: NormalizedResearchResult[] = [];
  const listing: Record<string, unknown> = {};

  for (const page of LISTING_PAGES) {
    let html: string;
    const listingStartedAt = Date.now();
    try {
      html = await fetchHtml(page.url);
    } catch (error) {
      console.error(`TKGM listing retrieval failed (${page.url}):`, error instanceof Error ? error.message : String(error));
      listing[page.basePath] = { status: "error", error: errorKind(error), ms: Date.now() - listingStartedAt };
      report?.fail(`${page.basePath}: ${errorKind(error)}`);
      continue;
    }
    const before = results.length;

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
    listing[page.basePath] = { status: "ok", items: results.length - before, ms: Date.now() - listingStartedAt };
  }

  const stats = emptyEvidenceStats();
  const evidenceStartedAt = Date.now();
  await attachDetailPageEvidence(results, stats);
  const evidencePhaseMs = Date.now() - evidenceStartedAt;
  const { detailMs, pdfFetchMs, pdfParseMs, ...counts } = stats;

  let subjectFound = 0;
  for (const result of results) {
    const subject = result.evidenceText ? extractSubjectLine(result.evidenceText) : undefined;
    if (subject) {
      result.snippet = `${result.title} — Konu: ${subject}`;
      subjectFound += 1;
    }
  }
  radarDiag("tkgm-evidence", {
    listing,
    items: results.length,
    detailAttempted: Math.min(results.length, MAX_DETAIL_FETCHES),
    ...counts,
    timingMs: {
      evidencePhase: evidencePhaseMs,
      detail: msSummary(detailMs),
      pdfFetch: msSummary(pdfFetchMs),
      pdfParse: msSummary(pdfParseMs),
    },
    subjectFound,
    titleOnly: results.length - subjectFound,
  });

  return results;
}
