// User-facing names for the router's adapter ids (retrieval/router.ts).
const SOURCE_LABELS: Record<string, string> = {
  tcmb: "TCMB",
  tkgm: "TKGM",
  "resmi-gazete": "Resmî Gazete",
  csb: "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı",
  "aa-dunya": "AA / Dünya haber akışları",
};

// Sources that could not be (fully) read in this run, as short Turkish
// labels — lets the dashboard say "nothing qualified" vs "a source was
// unreachable" instead of a bare empty list. Never contains URLs or errors.
export function describeSourceIssues(statuses: Record<string, string>): string[] {
  return Object.entries(statuses)
    .filter(([, status]) => status !== "ok")
    .map(([source, status]) => {
      const label = SOURCE_LABELS[source] ?? source;
      if (status === "error") return `${label} (ulaşılamadı)`;
      return source === "tkgm" ? `${label} (bazı duyuru içerikleri okunamadı)` : `${label} (kısmen okunabildi)`;
    });
}
