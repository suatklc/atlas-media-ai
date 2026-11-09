import { timingSafeEqual } from "node:crypto";
import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAsAutomationUser } from "@/lib/supabase/server";
import { handleTelegramUpdate, type HandlerResult, type TelegramUpdate } from "@/lib/automation/telegramReview";
import {
  answerTelegramCallback,
  authorizedChatId,
  clearTelegramButtons,
  downloadTelegramVoice,
  sendTelegramPhotos,
  sendTelegramText,
} from "@/lib/notifications/telegram";
import { transcribeVoice } from "@/lib/ai/transcribe";
import { withReusedBaseImage } from "@/lib/ai/media/reusedBaseImage";
import { publishToSelectedPlatforms } from "@/lib/publishing/publishSelectedPlatforms";
import { listConnectedMetaAccounts } from "@/lib/publishing/connections/query";
import { getConnectedAccountCredential } from "@/lib/publishing/connections/credentials";
import { META_GRAPH_API_VERSION } from "@/lib/publishing/connections/meta-oauth";
import { POST as generateContentPackage } from "@/app/api/content-package/route";
import { POST as generateVisual } from "@/app/api/generate-visual/route";

// Telegram bot webhook (Telegram review flow). Telegram calls it with the
// secret set at setWebhook time in X-Telegram-Bot-Api-Secret-Token; only
// that, then only the one authorized chat (TELEGRAM_CHAT_ID, checked in
// handleTelegramUpdate before anything is stored), is served. The reply is
// immediate; generation/publishing continue in after() so Telegram never
// re-sends a slow update. Publishing happens only after the explicit
// platform choice, through the existing publishToSelectedPlatforms.
export const maxDuration = 300;

function hasValidSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(request.headers.get("x-telegram-bot-api-secret-token") ?? "");
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

export async function POST(request: Request) {
  if (!hasValidSecret(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const userId = process.env.ATLAS_AUTOMATION_USER_ID;
  const chatId = authorizedChatId();
  if (!update || !userId || !chatId) {
    // 200 so Telegram does not retry an update that can never be served.
    return Response.json({ ok: true });
  }

  const origin = new URL(request.url).origin;
  after(async () => {
    try {
      const admin = createAdminClient();
      const outcome = await runAsAutomationUser(admin, userId, () =>
        handleTelegramUpdate(update, {
          admin,
          userId,
          authorizedChatId: chatId,
          // Each off unless exactly "true"; both off: only /start answers.
          // AI generation (instructions, voice, corrections):
          generationEnabled: process.env.TELEGRAM_ACTIONS_ENABLED === "true",
          // Reviewing/publishing existing drafts (/taslaklar, approve, reject, platform choice):
          reviewEnabled: process.env.TELEGRAM_REVIEW_ENABLED === "true",
          generatePackage: async (body) => toResult(await generateContentPackage(postRequest(origin, "/api/content-package", body))),
          generateVisual: async (body, reuseBaseImageUrl) => {
            const run = async () => toResult(await generateVisual(postRequest(origin, "/api/generate-visual", body)));
            return reuseBaseImageUrl ? withReusedBaseImage(reuseBaseImageUrl, run) : run();
          },
          publish: (postId, platforms) => publishToSelectedPlatforms(admin, userId, postId, platforms),
          instagramPermalink: async (mediaId) => {
            const account = (await listConnectedMetaAccounts(admin, userId)).find((a) => a.platform === "instagram" && a.hasCredential);
            const token = account ? await getConnectedAccountCredential(admin, account.id) : null;
            if (!token) return undefined;
            const url = new URL(`https://graph.instagram.com/${META_GRAPH_API_VERSION}/${mediaId}`);
            url.searchParams.set("fields", "permalink");
            url.searchParams.set("access_token", token);
            const response = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
            const data = (await response?.json().catch(() => null)) as { permalink?: unknown } | null;
            return typeof data?.permalink === "string" ? data.permalink : undefined;
          },
          transcribe: transcribeVoice,
          telegram: {
            sendText: sendTelegramText,
            sendPhotos: sendTelegramPhotos,
            answerCallback: answerTelegramCallback,
            clearButtons: clearTelegramButtons,
            downloadVoice: downloadTelegramVoice,
          },
        }),
      );
      console.log(`Telegram update ${update.update_id}: ${outcome}`);
    } catch (error) {
      console.error("Telegram update failed:", error instanceof Error ? error.message : "error");
    }
  });
  return Response.json({ ok: true });
}
