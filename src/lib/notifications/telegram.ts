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

// ============================================================
// Telegram review flow (bot commands). Every call goes only to the one
// authorized chat (TELEGRAM_CHAT_ID). Same token rule as above.
// ============================================================

export type TelegramButton = { text: string; data: string };
export type TelegramCallResult = { ok: true; result: unknown } | { ok: false; error: string };

const MAX_VOICE_BYTES = 10 * 1024 * 1024;

async function telegramCall(method: string, body: Record<string, unknown>): Promise<TelegramCallResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "Telegram is not configured." };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; description?: unknown } | null;
    if (response.ok && data?.ok) return { ok: true, result: data.result };
    const description = typeof data?.description === "string" ? data.description.slice(0, 200) : "";
    return { ok: false, error: `Telegram ${method} ${response.status}${description ? `: ${description}` : ""}` };
  } catch (error) {
    return { ok: false, error: `Telegram ${method} failed (${error instanceof Error ? error.name : "error"})` };
  }
}

export function authorizedChatId(): string | undefined {
  return process.env.TELEGRAM_CHAT_ID || undefined;
}

// Telegram limits a message to 4096 characters.
export function sendTelegramText(text: string, buttons?: TelegramButton[][]): Promise<TelegramCallResult> {
  return telegramCall("sendMessage", {
    chat_id: authorizedChatId(),
    text: text.slice(0, 4096),
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
  });
}

// Up to 10 photos as one album, by public URL (Telegram fetches them).
// sendMediaGroup needs 2–10 items; a single image goes through sendPhoto.
export function sendTelegramPhotos(urls: string[], caption?: string): Promise<TelegramCallResult> {
  if (urls.length === 1) {
    return telegramCall("sendPhoto", { chat_id: authorizedChatId(), photo: urls[0], ...(caption ? { caption: caption.slice(0, 1024) } : {}) });
  }
  return telegramCall("sendMediaGroup", {
    chat_id: authorizedChatId(),
    media: urls.slice(0, 10).map((url, i) => ({ type: "photo", media: url, ...(i === 0 && caption ? { caption: caption.slice(0, 1024) } : {}) })),
  });
}

export function answerTelegramCallback(callbackQueryId: string, text?: string): Promise<TelegramCallResult> {
  return telegramCall("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(text ? { text: text.slice(0, 200) } : {}) });
}

// Removes the buttons from a message once it has been acted on.
export function clearTelegramButtons(messageId: number): Promise<TelegramCallResult> {
  return telegramCall("editMessageReplyMarkup", { chat_id: authorizedChatId(), message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

// A voice note's audio bytes (getFile + file download), capped at 10 MB.
export async function downloadTelegramVoice(fileId: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }> {
  const file = await telegramCall("getFile", { file_id: fileId });
  const filePath = file.ok ? (file.result as { file_path?: unknown }).file_path : undefined;
  if (!file.ok || typeof filePath !== "string") return { ok: false, error: file.ok ? "Telegram getFile: no file path" : file.error };
  try {
    const response = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`, {
      signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: `Telegram file download ${response.status}` };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_VOICE_BYTES) return { ok: false, error: "Voice note too large." };
    return { ok: true, bytes };
  } catch (error) {
    return { ok: false, error: `Telegram file download failed (${error instanceof Error ? error.name : "error"})` };
  }
}
