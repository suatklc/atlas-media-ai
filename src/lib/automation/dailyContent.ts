import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyContentPlan, WeeklyPlanItem } from "../ai/content/weeklyPlan";
import type { TelegramResult } from "../notifications/telegram";

// Automation V1 — one scheduled run = at most ONE draft. Picks the day's
// slot from the existing weekly plan, generates it through the existing
// content-package and generate-visual handlers (injected below; the cron
// route passes the real ones), then records the run and notifies (in-app +
// Telegram). It never approves and never publishes: the draft waits for
// Suat's explicit approval and publish step like any other.

// Monday, Tuesday, Thursday, Saturday (Turkey time) -> weekly plan slot.
const RUN_DAY_SLOTS: Record<number, number> = { 1: 0, 2: 1, 4: 2, 6: 3 };
const MAX_ERROR_LENGTH = 300;
// The day is read in the Europe/Istanbul zone itself (IANA data), never from
// a hard-coded UTC offset. Vercel Cron schedules are always UTC.
const TURKEY_DATE_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export type HandlerResult = { status: number; data: Record<string, unknown> | null };

export type DailyContentDeps = {
  admin: SupabaseClient;
  userId: string;
  siteUrl: string;
  buildPlan: () => Promise<HandlerResult>;
  generatePackage: (body: Record<string, unknown>) => Promise<HandlerResult>;
  generateVisual: (body: Record<string, unknown>) => Promise<HandlerResult>;
  sendTelegram: (text: string, buttonUrl?: string) => Promise<TelegramResult>;
};

export type DailyContentOutcome =
  | { status: "not-a-run-day"; runKey: string }
  | { status: "already-handled"; runKey: string }
  | { status: "succeeded"; runKey: string; postId: string }
  | { status: "failed"; runKey: string; error: string };

export function turkeyRunDay(now: Date): { runKey: string; weekday: number } {
  const parts = Object.fromEntries(TURKEY_DATE_PARTS.formatToParts(now).map((part) => [part.type, part.value]));
  return { runKey: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAYS[parts.weekday] };
}

export function slotForWeekday(weekday: number): number | undefined {
  return RUN_DAY_SLOTS[weekday];
}

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

function handlerError(step: string, result: HandlerResult): Error {
  const message = typeof result.data?.error === "string" ? result.data.error : "beklenmeyen yanıt";
  return new Error(`${step} (${result.status}): ${message}`);
}

// The unique (user_id, run_key) row is the lock: a concurrent or repeated
// invocation cannot insert it. A day whose run FAILED may be claimed again
// (manual re-trigger), and so may a "running" row older than any function
// can live (Hobby max 300 s) — a run Vercel terminated mid-way. A live
// running or a succeeded day never is.
const STALE_RUN_MS = 10 * 60 * 1000;

async function claimRun(deps: DailyContentDeps, runKey: string, now: Date): Promise<boolean> {
  const { error } = await deps.admin.from("automation_runs").insert({ user_id: deps.userId, run_key: runKey, status: "running" });
  if (!error) return true;
  if (error.code !== "23505") throw new Error(`run claim failed: ${error.message}`);
  const staleBefore = new Date(now.getTime() - STALE_RUN_MS).toISOString();
  const { data } = await deps.admin
    .from("automation_runs")
    .update({ status: "running", error: null, post_id: null, started_at: now.toISOString(), finished_at: null })
    .eq("user_id", deps.userId)
    .eq("run_key", runKey)
    .or(`status.eq.failed,and(status.eq.running,started_at.lt.${staleBefore})`)
    .select("id");
  return Array.isArray(data) && data.length > 0;
}

function requestBodies(item: WeeklyPlanItem, contentPackage?: unknown) {
  return item.kind === "idea"
    ? { pkg: { instruction: item.instruction, visualFormat: "carousel" }, visual: { message: item.instruction, visualFormat: "carousel", contentPackage } }
    : { pkg: { contentOpportunity: item.opportunity, visualFormat: "carousel" }, visual: { contentOpportunity: item.opportunity, visualFormat: "carousel", contentPackage } };
}

async function notify(
  deps: DailyContentDeps,
  notification: { kind: "draft_ready" | "run_failed"; title: string; body: string; link: string; postId?: string },
  telegramText: string,
): Promise<void> {
  const { data, error } = await deps.admin
    .from("notifications")
    .insert({
      user_id: deps.userId,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      link: notification.link,
      post_id: notification.postId ?? null,
    })
    .select("id")
    .single();
  if (error) console.error("Automation notification insert error:", error.message);

  const telegram = await deps.sendTelegram(telegramText, `${deps.siteUrl}${notification.link}`);
  if (!telegram.ok) console.error("Automation Telegram notification not sent:", telegram.error);
  if (data?.id) {
    await deps.admin
      .from("notifications")
      .update({
        telegram_status: telegram.ok ? "sent" : telegram.skipped ? "skipped" : "failed",
        telegram_error: telegram.ok ? null : telegram.error,
      })
      .eq("id", data.id);
  }
}

export async function runDailyContent(now: Date, deps: DailyContentDeps): Promise<DailyContentOutcome> {
  const { runKey, weekday } = turkeyRunDay(now);
  const slot = slotForWeekday(weekday);
  if (slot === undefined) return { status: "not-a-run-day", runKey };
  if (!(await claimRun(deps, runKey, now))) return { status: "already-handled", runKey };

  let item: WeeklyPlanItem | undefined;
  try {
    const planResult = await deps.buildPlan();
    const plan = planResult.data as WeeklyContentPlan | null;
    if (planResult.status !== 200 || !Array.isArray(plan?.items)) throw handlerError("haftalık plan", planResult);
    item = plan.items[slot] ?? plan.items[0];
    if (!item) throw new Error("haftalık planda konu yok");

    const packageResult = await deps.generatePackage(requestBodies(item).pkg);
    if (packageResult.status !== 200 || !packageResult.data?.contentPackage) throw handlerError("içerik", packageResult);

    const visualResult = await deps.generateVisual(requestBodies(item, packageResult.data.contentPackage).visual);
    const images = visualResult.data?.images as { imageUrl?: string }[] | undefined;
    const coverUrl = images?.[0]?.imageUrl;
    if (visualResult.status !== 200 || !coverUrl) throw handlerError("görsel", visualResult);

    // generate-visual saved the draft; find it by its own cover image.
    const { data: post } = await deps.admin
      .from("generated_posts")
      .select("id")
      .eq("user_id", deps.userId)
      .eq("final_image_url", coverUrl)
      .maybeSingle();
    if (!post?.id) throw new Error("taslak kaydı bulunamadı");

    await deps.admin
      .from("automation_runs")
      .update({ status: "succeeded", post_id: post.id, slot_label: item.label, topic: item.title, finished_at: new Date().toISOString() })
      .eq("user_id", deps.userId)
      .eq("run_key", runKey);

    const link = `/dashboard#draft-${post.id}`;
    await notify(
      deps,
      { kind: "draft_ready", title: "Yeni taslak hazır", body: `${item.label}: ${item.title}`, link, postId: post.id },
      `Atlas: yeni taslak hazır\n${item.label}: ${item.title}\n\nOnaylamadan hiçbir yerde yayınlanmaz.`,
    );
    return { status: "succeeded", runKey, postId: post.id };
  } catch (error) {
    const message = shortError(error);
    console.error("Automation run failed:", message);
    await deps.admin
      .from("automation_runs")
      .update({ status: "failed", error: message, slot_label: item?.label ?? null, topic: item?.title ?? null, finished_at: new Date().toISOString() })
      .eq("user_id", deps.userId)
      .eq("run_key", runKey);
    await notify(
      deps,
      { kind: "run_failed", title: "Otomatik taslak hazırlanamadı", body: message, link: "/dashboard" },
      `Atlas: bugünkü otomatik taslak hazırlanamadı.\n${message}`,
    );
    return { status: "failed", runKey, error: message };
  }
}
