import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAsAutomationUser } from "@/lib/supabase/server";
import { runDailyContent, type HandlerResult } from "@/lib/automation/dailyContent";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { POST as buildContentPlan } from "@/app/api/content-plan/route";
import { POST as generateContentPackage } from "@/app/api/content-package/route";
import { POST as generateVisual } from "@/app/api/generate-visual/route";

// Automation V1 — Vercel Cron (vercel.json: Mon/Tue/Thu/Sat 04:00 UTC =
// 07:00 Turkey; Hobby fires anywhere within that hour). Produces at most
// one DRAFT per day through the existing, unchanged handlers and notifies;
// never approves, never publishes. Off unless AUTOMATION_ENABLED=true.
// Runs in fra1 (vercel.json) because the weekly plan calls Radar.
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function toResult(response: Response): Promise<HandlerResult> {
  return { status: response.status, data: (await response.json().catch(() => null)) as Record<string, unknown> | null };
}

function postRequest(origin: string, path: string, body: Record<string, unknown>): NextRequest {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.AUTOMATION_ENABLED !== "true") {
    return Response.json({ status: "disabled" });
  }

  const userId = process.env.ATLAS_AUTOMATION_USER_ID;
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    admin = null;
  }
  if (!userId || !admin) {
    console.error("Automation is not configured (ATLAS_AUTOMATION_USER_ID / SUPABASE_SERVICE_ROLE_KEY).");
    return Response.json({ error: "Automation is not configured." }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? origin).replace(/\/+$/, "");
  const client = admin;
  const outcome = await runAsAutomationUser(client, userId, () =>
    runDailyContent(new Date(), {
      admin: client,
      userId,
      siteUrl,
      buildPlan: async () => toResult(await buildContentPlan()),
      generatePackage: async (body) => toResult(await generateContentPackage(postRequest(origin, "/api/content-package", body))),
      generateVisual: async (body) => toResult(await generateVisual(postRequest(origin, "/api/generate-visual", body))),
      sendTelegram: sendTelegramMessage,
    }),
  );

  console.log(`Automation run: ${outcome.status} ${outcome.runKey}`);
  return Response.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
}
