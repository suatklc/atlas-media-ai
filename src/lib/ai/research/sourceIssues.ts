import type { AdapterRunReport } from "./retrieval/types";
import { formatTurkeyDateLong } from "./retrieval/turkishDate";

// User-facing names for the router's adapter ids (retrieval/router.ts).
const SOURCE_LABELS: Record<string, string> = {
  tcmb: "TCMB",
  tkgm: "TKGM",
  "resmi-gazete": "Resmî Gazete",
  csb: "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı",
  "aa-dunya": "AA / Dünya haber akışları",
  "gayrimenkul-gundemi": "Gayrimenkul Gündemi RSS",
  "sariyer-posta": "Sarıyer Posta RSS",
};

export type SourceReportSummary = {
  // ACCESS: a source (or part of it) could not be read in this run.
  accessIssues: string[];
  // SCOPE: a readable source was scanned only part of the way back to the
  // target window (feed length, page cap, archive gap).
  coverageGaps: string[];
};

const HOUR_MS = 60 * 60 * 1000;

// Short Turkish lines for the dashboard. Access and coverage are kept apart
// on purpose: "TKGM could not be read" and "AA only covers 9 hours" call for
// different conclusions. Never contains URLs or error text.
export function describeSourceReport(reports: Record<string, AdapterRunReport>, now: Date = new Date()): SourceReportSummary {
  const accessIssues: string[] = [];
  const coverageGaps: string[] = [];

  for (const [source, report] of Object.entries(reports)) {
    const label = SOURCE_LABELS[source] ?? source;

    if (report.status === "error") {
      accessIssues.push(`${label} (ulaşılamadı)`);
      continue; // nothing was read, so there is no coverage to describe
    }
    if (report.status === "partial") {
      accessIssues.push(source === "tkgm" ? `${label} (bazı duyuru içerikleri okunamadı)` : `${label} (kısmen okunabildi)`);
    }

    const coverage = report.coverage;
    if (!coverage || coverage.complete) continue;
    if (!coverage.since) {
      coverageGaps.push(`${label}: tarihli kayıt okunamadı`);
      continue;
    }
    const hours = Math.max(1, Math.round((now.getTime() - new Date(coverage.since).getTime()) / HOUR_MS));
    coverageGaps.push(
      hours <= 48
        ? `${label}: yalnız son ${hours} saat tarandı`
        : `${label}: yalnız ${formatTurkeyDateLong(coverage.since) ?? "kısmi dönem"} sonrası tarandı`,
    );
  }

  return { accessIssues, coverageGaps };
}
