// ============================================================
// Source Intelligence — TIER 3 social/competitor intelligence seam.
// SEAM ONLY: no adapter, no scraping, no authentication (see
// sourceRegistry.ts's "planned" social entries).
//
// SOCIAL = discovery / trend / format / hook / engagement intelligence.
// SOCIAL ≠ fact authority. A social signal can never become a
// ResearchSource or evidence text: the only thing it can produce is a
// DiscoveryLead, and a lead that implies a factual development must be
// resolved to a fact-authority primary source (through the normal Radar
// adapters) before any content is generated from it. Engagement never
// raises trust.
//
// Future feeds into the same Atlas Content Agent:
//   - CURRENT DEVELOPMENTS: a lead → primary-source lookup → normal Radar.
//   - SOCIAL / MARKET INTELLIGENCE: format/hook/question patterns for the
//     Content Strategist (never facts).
//   - EVERGREEN EXPERT CONTENT: recurring audience questions as topics.
// ============================================================

export type SocialSignal = {
  platform: "instagram";
  accountName: string;
  postUrl: string;
  observedAt: string;
  topicHint: string;
  format?: "carousel" | "reel" | "single";
  hookText?: string;
  engagement?: { likes?: number; comments?: number; saves?: number };
};

export type DiscoveryLeadKind = "factual-development" | "format-or-hook" | "audience-question";

export type DiscoveryLead = {
  kind: DiscoveryLeadKind;
  topicHint: string;
  discoveredVia: { platform: SocialSignal["platform"]; accountName: string; postUrl: string };
  // Always true for a factual lead: content generation must wait for a
  // fact-authority source. Format/hook/question leads only steer style or
  // topic choice and never carry facts.
  requiresPrimarySource: boolean;
};

export function toDiscoveryLead(signal: SocialSignal, kind: DiscoveryLeadKind): DiscoveryLead {
  return {
    kind,
    topicHint: signal.topicHint,
    discoveredVia: { platform: signal.platform, accountName: signal.accountName, postUrl: signal.postUrl },
    requiresPrimarySource: kind === "factual-development",
  };
}
