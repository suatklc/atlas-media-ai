// Telegram Bot API notification (Automation V1). Sends only to the single
// authorized chat in TELEGRAM_CHAT_ID — never to a chat id from a request.
// The bot token is used only inside the request URL: it is never logged,
// never returned and never part of an error message (a fetch failure is
// reported by its error name only, since some runtimes echo the URL).

const TELEGRAM_TIMEOUT_MS = 10_000;

export type TelegramResult = { ok: true } | { ok: false; skipped?: true; error: string };

export async function sendTelegramMessage(text: string, buttonUrl?: string): Promise<TelegramResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, error: "Telegram is not configured." };
  }

  // Telegram rejects non-https (e.g. localhost) URL buttons; the link is
  // then left out rather than failing the whole message.
  const replyMarkup = buttonUrl?.startsWith("https://")
    ? { inline_keyboard: [[{ text: "Taslağı aç", url: buttonUrl }]] }
    : undefined;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, reply_markup: replyMarkup }),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const data = (await response.json().catch(() => null)) as { description?: unknown } | null;
    const description = typeof data?.description === "string" ? data.description.slice(0, 200) : "";
    return { ok: false, error: `Telegram ${response.status}${description ? `: ${description}` : ""}` };
  } catch (error) {
    return { ok: false, error: `Telegram request failed (${error instanceof Error ? error.name : "error"})` };
  }
}
