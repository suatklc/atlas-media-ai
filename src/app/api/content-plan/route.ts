import { createClient } from "@/lib/supabase/server";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";
import { discoverCurrentContentOpportunities } from "@/lib/ai/research/discover";
import type { RankedContentOpportunity } from "@/lib/ai/research/retrieval/types";
import { buildWeeklyContentPlan, type RecentDraft } from "@/lib/ai/content/weeklyPlan";

// Weekly content plan (dashboard "Haftalık Planı Oluştur"): the week's
// topic suggestions — regional, land/zoning, buyer-seller/investment,
// current-or-evergreen — from the business's content strategy plus Radar.
// Read-only: it never generates content, never writes generated_posts and
// never touches approval/publishing; a picked suggestion goes through the
// existing /api/content-package flow. Runs in fra1 (vercel.json) because
// Radar's sources are fetched from here.

const MAX_OPPORTUNITY_AGE_DAYS = 30;
const RADAR_LIMIT = 10;
const RECENT_DRAFT_DAYS = 56;
const RECENT_DRAFT_LIMIT = 60;

type StoredPackage = {
  topic?: unknown;
  hook?: unknown;
  slides?: { headline?: unknown }[];
  source?: { url?: unknown };
};

function toRecentDraft(metadata: unknown): RecentDraft | null {
  const contentPackage = (metadata as { contentPackage?: StoredPackage } | null)?.contentPackage;
  if (!contentPackage || typeof contentPackage !== "object") return null;
  const parts = [contentPackage.topic, contentPackage.hook, ...(Array.isArray(contentPackage.slides) ? contentPackage.slides.map((s) => s?.headline) : [])];
  const text = parts.filter((part): part is string => typeof part === "string").join(" ");
  const sourceUrl = typeof contentPackage.source?.url === "string" ? contentPackage.source.url : undefined;
  return text ? { text, sourceUrl } : null;
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Bu işlem için giriş yapmanız gerekiyor." }, { status: 401 });
  }

  const since = new Date(Date.now() - RECENT_DRAFT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [radarResult, draftsResult] = await Promise.allSettled([
    discoverCurrentContentOpportunities({ limit: RADAR_LIMIT, maxAgeDays: MAX_OPPORTUNITY_AGE_DAYS }),
    supabase
      .from("generated_posts")
      .select("metadata")
      .eq("user_id", user.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(RECENT_DRAFT_LIMIT),
  ]);

  // Radar failing never stops the plan; its slot falls back to evergreen.
  let radarOpportunities: RankedContentOpportunity[] | undefined;
  if (radarResult.status === "fulfilled") {
    radarOpportunities = radarResult.value;
  } else {
    console.error("Content plan: Radar unavailable:", radarResult.reason instanceof Error ? radarResult.reason.message : String(radarResult.reason));
  }

  const recentDrafts =
    draftsResult.status === "fulfilled" && !draftsResult.value.error
      ? (draftsResult.value.data ?? []).map((row) => toRecentDraft(row.metadata)).filter((draft): draft is RecentDraft => draft !== null)
      : [];

  const plan = buildWeeklyContentPlan({
    profile: ATLAS_DEFAULT_BUSINESS_PROFILE,
    now: new Date(),
    radarOpportunities,
    recentDrafts,
  });
  return Response.json(plan);
}
