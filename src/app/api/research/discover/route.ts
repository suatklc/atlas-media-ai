import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { discoverCurrentContentOpportunities } from "@/lib/ai/research/discover";

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

  try {
    const opportunities = await discoverCurrentContentOpportunities({ limit });
    return Response.json({ opportunities });
  } catch (error) {
    console.error("Research discovery error:", error instanceof Error ? error.message : String(error));
    return jsonError("Güncel içerik fırsatları alınamadı. Lütfen tekrar deneyin.", 502);
  }
}
