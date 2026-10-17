import type { SourceTier } from "./types";

// ============================================================
// Source Intelligence — Source Registry + trust model (Radar V2 seam).
//
// One explicit place that says, per source, WHAT IT IS ALLOWED TO DO:
//
//   fact-authority      (TIER 1) may support factual claims — still only
//                       through Job 1 / Gap 1 / Gap 2 / Scenario Boundary.
//   discovery-context   (TIER 2) news/sector outlets: "something important
//                       may have happened" + context. Their facts are
//                       secondary — when a fact-authority source for the
//                       same event is in the evidence bundle, it leads.
//   social-intelligence (TIER 3) social/competitor accounts: topics,
//                       formats, hooks, engagement. NEVER fact evidence —
//                       see socialIntelligence.ts (a social signal can only
//                       become a discovery lead that needs a primary source).
//
// Business-neutral by design: the registry lists sources, not a vertical.
// Adding a source = one entry here (+ an adapter in retrieval/providers/
// when it should be fetched). `status: "live"` means an adapter exists;
// "planned" entries document the intended trust role before any
// integration exists, so nothing is assumed once one is built.
// ============================================================

export type SourceRole = "fact-authority" | "discovery-context" | "social-intelligence";

export type SourceRegistryEntry = {
  id: string;
  name: string;
  role: SourceRole;
  // The existing SourceTier taxonomy (types.ts) this entry maps to — kept
  // so every current consumer (buildResearchDirective wording, ranking)
  // keeps working unchanged.
  tier: SourceTier;
  domains: string[];
  status: "live" | "planned";
  platform?: "web" | "instagram";
};

export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  // TIER 1 — fact authority
  { id: "tkgm", name: "Tapu ve Kadastro Genel Müdürlüğü (TKGM)", role: "fact-authority", tier: "official-authority", domains: ["tkgm.gov.tr"], status: "live" },
  { id: "resmi-gazete", name: "Resmî Gazete", role: "fact-authority", tier: "official-authority", domains: ["resmigazete.gov.tr", "mevzuat.gov.tr"], status: "live" },
  { id: "csb", name: "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı", role: "fact-authority", tier: "official-authority", domains: ["csb.gov.tr"], status: "live" },
  { id: "tcmb", name: "Türkiye Cumhuriyet Merkez Bankası (TCMB)", role: "fact-authority", tier: "official-authority", domains: ["tcmb.gov.tr"], status: "live" },
  { id: "tuik", name: "Türkiye İstatistik Kurumu (TÜİK)", role: "fact-authority", tier: "official-authority", domains: ["tuik.gov.tr"], status: "planned" },
  { id: "gib", name: "Gelir İdaresi Başkanlığı", role: "fact-authority", tier: "official-authority", domains: ["gib.gov.tr"], status: "planned" },
  { id: "spk", name: "Sermaye Piyasası Kurulu (SPK)", role: "fact-authority", tier: "official-authority", domains: ["spk.gov.tr"], status: "planned" },
  { id: "bddk", name: "Bankacılık Düzenleme ve Denetleme Kurumu (BDDK)", role: "fact-authority", tier: "official-authority", domains: ["bddk.org.tr"], status: "planned" },
  { id: "sariyer-belediyesi", name: "Sarıyer Belediyesi", role: "fact-authority", tier: "official-authority", domains: ["sariyer.bel.tr"], status: "planned" },
  // TIER 2 — discovery + context
  { id: "aa-ekonomi", name: "Anadolu Ajansı (AA) — Ekonomi", role: "discovery-context", tier: "financial-news", domains: ["aa.com.tr"], status: "live" },
  { id: "dunya", name: "Dünya Gazetesi", role: "discovery-context", tier: "financial-news", domains: ["dunya.com"], status: "live" },
  // TIER 3 — social / competitor intelligence (seam only; no integration,
  // no scraping — handles are added only once verified).
  { id: "emlak-haber", name: "Emlak Haber", role: "social-intelligence", tier: "commentary", domains: [], status: "planned", platform: "instagram" },
  { id: "emlak-fikirleri", name: "Emlak Fikirleri", role: "social-intelligence", tier: "commentary", domains: [], status: "planned", platform: "instagram" },
  { id: "emlak-haber-turkiye", name: "Emlak Haber Türkiye", role: "social-intelligence", tier: "commentary", domains: [], status: "planned", platform: "instagram" },
  { id: "gayrimenkul-gundemi", name: "Gayrimenkul Gündemi", role: "social-intelligence", tier: "commentary", domains: [], status: "planned", platform: "instagram" },
];

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function findRegistryEntry(url: string): SourceRegistryEntry | undefined {
  const hostname = hostnameOf(url);
  if (!hostname) return undefined;
  return SOURCE_REGISTRY.find((entry) =>
    entry.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)),
  );
}

// Unknown sources are never promoted: an unregistered URL is treated as
// discovery-context at most when its tier says news, otherwise as social/
// commentary-level intelligence — never as a fact authority.
export function sourceRoleFor(source: { url: string; tier?: SourceTier }): SourceRole {
  const entry = findRegistryEntry(source.url);
  if (entry) return entry.role;
  // No tier at all (older/hand-built payloads): never a fact authority,
  // but its evidence stays usable exactly as before this registry existed.
  if (source.tier === undefined) return "discovery-context";
  if (source.tier === "official-authority" || source.tier === "primary-data") return "fact-authority";
  if (source.tier === "financial-news" || source.tier === "specialist") return "discovery-context";
  return "social-intelligence";
}

// Only these roles may contribute evidence text to the grounding bundle.
export function mayProvideFactEvidence(role: SourceRole): boolean {
  return role === "fact-authority" || role === "discovery-context";
}

const ROLE_RANK: Record<SourceRole, number> = { "fact-authority": 0, "discovery-context": 1, "social-intelligence": 2 };

// Stable: fact authorities first, original order otherwise.
export function orderSourcesByAuthority<T extends { url: string; tier?: SourceTier }>(sources: T[]): T[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => ROLE_RANK[sourceRoleFor(a.source)] - ROLE_RANK[sourceRoleFor(b.source)] || a.index - b.index)
    .map(({ source }) => source);
}
