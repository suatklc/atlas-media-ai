import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverCurrentContentOpportunities } from "@/lib/ai/research/discover";
import { errorKind, radarDiag } from "@/lib/ai/research/retrieval/diagnostics";
import { describeSourceReport } from "@/lib/ai/research/sourceIssues";
import type { AdapterRunReport } from "@/lib/ai/research/retrieval/types";
import { buildOwnerProposals } from "@/lib/ai/content/ownerProposals";
import { runOwnerWebSearch } from "@/lib/ai/research/ownerWebSearch";
import { collectOwnerFeedOpportunities } from "@/lib/ai/research/ownerFeeds";
import { AI_MODEL, getAnthropicClient } from "@/lib/ai/client";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";

// Phase 2 (Current Content Engine — live research foundation): the
// smallest safe server-side entry point to trigger research manually. No
// scheduler, no cron — this only runs when a signed-in user's request
// reaches it. Returns ContentOpportunity[] only: never generates a post,
// a visual, or touches approval/publishing (those remain separate,
// explicit user actions elsewhere in this app, entirely untouched by this
// route). No dashboard UI is added — this route is itself the testable
// entry point, per this task's own scope instruction.
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;
// Hard freshness rule (Handoff — Current Content Opportunities UI): this
// is the ONE caller that applies discoverCurrentContentOpportunities'
// maxAgeDays cutoff — "Güncel İçerik Fırsatları" must actually mean
// current; material older than 30 days is excluded before ranking, never
// merely down-ranked, so it can never appear in this dashboard surface
// "to fill the list."
const MAX_OPPORTUNITY_AGE_DAYS = 30;

// A full run takes ~20-25 s in production (TKGM detail pages + PDFs; the
// Resmî Gazete archive and ÇŞİDB pages run in parallel with it).
// Bounded so a hung source ends in a clear error, never an endless spinner.
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  const { limit: rawLimit } = body as { limit?: unknown };

  // Defensive bound on client-supplied input, same posture as every other
  // route in this codebase — never trusted as-is. Falls back to the
  // default rather than rejecting the request for anything malformed.
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Temporary Radar diagnostics (Handoff 9): request start/end with the
  // function's actual region, so a missing later log line can be told
  // apart from a request that never finished.
  const startedAt = Date.now();
  radarDiag("discover-request", { phase: "start", region: process.env.VERCEL_REGION ?? "local", limit });
  const sourceReports: Record<string, AdapterRunReport> = {};
  try {
    // The owner web search (one billed Anthropic call, OFF unless
    // OWNER_WEB_SEARCH_ENABLED=true) runs in parallel with Radar; it never
    // throws and never blocks Radar's own results.
    // The business's own news feeds (free RSS, research/ownerFeeds.ts) also
    // run in parallel; same 30-day window, own coverage reports.
    const now = new Date();
    const searchWindow = { notBefore: new Date(now.getTime() - MAX_OPPORTUNITY_AGE_DAYS * 24 * 60 * 60 * 1000) };
    const [radarOpportunities, webSearch, feeds] = await Promise.all([
      discoverCurrentContentOpportunities({
        limit,
        maxAgeDays: MAX_OPPORTUNITY_AGE_DAYS,
        onSourceReport: (source, report) => {
          sourceReports[source] = report;
        },
      }),
      runOwnerWebSearch({ profile: ATLAS_DEFAULT_BUSINESS_PROFILE, model: AI_MODEL, getClient: getAnthropicClient }),
      collectOwnerFeedOpportunities(ATLAS_DEFAULT_BUSINESS_PROFILE, searchWindow, now),
    ]);
    Object.assign(sourceReports, feeds.reports);
    const opportunities = [...radarOpportunities, ...feeds.opportunities];
    radarDiag("discover-request", { phase: "end", ms: Date.now() - startedAt, opportunities: opportunities.length });
    // accessIssues (a source could not be read) and coverageGaps (a source
    // was scanned only part of the 30 days) are separate on purpose; the
    // dashboard must not present an empty list as "nothing in 30 days"
    // when either is non-empty.
    const { accessIssues, coverageGaps } = describeSourceReport(sourceReports);
    if (webSearch.status === "error") accessIssues.push("Web araması (yanıt alınamadı)");
    // Owner-facing proposals (content/ownerProposals.ts): one per theme in
    // the business profile — a sourced current item when one fits, else a
    // labelled evergreen idea. Deterministic; nothing is generated here.
    const proposals = buildOwnerProposals(ATLAS_DEFAULT_BUSINESS_PROFILE, opportunities, webSearch.proposals, now);
    return Response.json({ opportunities, proposals, accessIssues, coverageGaps });
  } catch (error) {
    radarDiag("discover-request", { phase: "error", ms: Date.now() - startedAt, error: errorKind(error) });
    console.error("Research discovery error:", error instanceof Error ? error.message : String(error));
    return jsonError("Güncel içerik fırsatları alınamadı. Lütfen tekrar deneyin.", 502);
  }
}
