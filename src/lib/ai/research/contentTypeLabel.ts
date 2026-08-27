import type { ContentIntent } from "../content/types";

// Current Content Opportunities UI: user-facing Turkish labels for a
// ContentOpportunity's suggestedContentType — the dashboard must never
// show the raw ContentIntent enum name ("market-stats", "educational",
// ...) to the user. Purely presentational; never read by content/creative
// planning. Exhaustive (Record, not Partial<Record>) over the existing
// ContentIntent enum so a future new intent value is a compile-time error
// here, not a silent "undefined" label.
const CONTENT_TYPE_LABELS: Record<ContentIntent, string> = {
  listing: "İlan İçeriği",
  educational: "Bilgilendirici İçerik",
  comparison: "Karşılaştırma",
  "market-stats": "Piyasa Analizi",
  announcement: "Duyuru",
  none: "Genel İçerik",
};

export function describeContentType(intent: ContentIntent): string {
  return CONTENT_TYPE_LABELS[intent];
}
