// Current Content Opportunities UI: a user-facing freshness LABEL,
// distinct from the existing internal ContentOpportunityFreshness
// classification (breaking/recent/evergreen-adjacent, 3/30-day
// thresholds — still used for scoring/ranking, unchanged). This is purely
// presentational — Turkish labels for the specific 0-7 / 8-14 / 15-30 day
// bands this UI's own hard freshness rule defines, never read by
// discover.ts's ranking or by anything in content/creative/. A missing or
// unparsable date, or anything older than 30 days, has no band at all
// (the caller — discover.ts's own maxAgeDays cutoff — is what keeps
// >30-day material out of this UI in the first place; this function
// itself does not exclude anything, it only labels).
export type FreshnessBand = "very-fresh" | "fresh" | "recent";

export type FreshnessBandInfo = {
  band: FreshnessBand;
  label: string;
};

export function describeFreshnessBand(publishedAt: string, now: Date): FreshnessBandInfo | undefined {
  if (!publishedAt) return undefined;
  const published = new Date(publishedAt);
  if (Number.isNaN(published.getTime())) return undefined;

  const ageDays = (now.getTime() - published.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays < 0) return undefined;

  if (ageDays <= 7) return { band: "very-fresh", label: "Güncel" };
  if (ageDays <= 14) return { band: "fresh", label: "Yakın Zamanlı" };
  if (ageDays <= 30) return { band: "recent", label: "Bu Ay İçinde" };
  return undefined;
}
