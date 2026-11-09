import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramButton, TelegramCallResult } from "../notifications/telegram";
import type { PublishPlatform, PublishSelectedResult } from "../publishing/publishSelectedPlatforms";
import { isRejectedDraft } from "./review";

// Telegram review flow: instruction (text or voice) -> existing content
// pipeline -> draft -> preview in Telegram -> Onayla / Düzelt / Reddet ->
// an explicit platform choice -> the existing publishToSelectedPlatforms.
//
// Safety model:
// - Only the one authorized chat/user is served; everything else is ignored.
// - Each Telegram update_id is processed once (telegram_updates PK).
// - Every state change is a conditional update on (state, revision); a
//   repeated tap or a button from an earlier preview changes nothing.
// - A correction bumps the revision and withdraws the previous draft (back
//   to draft + rejected), so an earlier approval can no longer publish it.
// - Approval only sets status "approved"; publishing happens only after the
//   separate platform choice, through the existing publish code (which
//   itself refuses to publish anything twice).

const MIN_INSTRUCTION_LENGTH = 15;
const MAX_INSTRUCTION_LENGTH = 1000;
const STALE_GENERATION_MS = 10 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

export type HandlerResult = { status: number; data: Record<string, unknown> | null };

export type TelegramReviewDeps = {
  admin: SupabaseClient;
  userId: string;
  authorizedChatId: string;
  // TELEGRAM_ACTIONS_ENABLED. Off: only /start answers; no generation,
  // approval or publishing from Telegram.
  actionsEnabled: boolean;
  generatePackage: (body: Record<string, unknown>) => Promise<HandlerResult>;
  // reuseBaseImageUrl: a correction re-renders on the same photo (no new image cost).
  generateVisual: (body: Record<string, unknown>, reuseBaseImageUrl?: string) => Promise<HandlerResult>;
  publish: (postId: string, platforms: PublishPlatform[]) => Promise<PublishSelectedResult>;
  instagramPermalink: (mediaId: string) => Promise<string | undefined>;
  transcribe: (bytes: Buffer) => Promise<{ ok: true; text: string } | { ok: false; error: string }>;
  telegram: {
    sendText: (text: string, buttons?: TelegramButton[][]) => Promise<TelegramCallResult>;
    sendPhotos: (urls: string[], caption?: string) => Promise<TelegramCallResult>;
    answerCallback: (id: string, text?: string) => Promise<TelegramCallResult>;
    clearButtons: (messageId: number) => Promise<TelegramCallResult>;
    downloadVoice: (fileId: string) => Promise<{ ok: true; bytes: Buffer } | { ok: false; error: string }>;
  };
};

type TelegramUser = { id?: number | string };
type TelegramChat = { id?: number | string; type?: string };
export type TelegramUpdate = {
  update_id?: number;
  message?: { message_id?: number; date?: number; from?: TelegramUser; chat?: TelegramChat; text?: string; voice?: { file_id?: string } };
  callback_query?: { id?: string; from?: TelegramUser; data?: string; message?: { message_id?: number; chat?: TelegramChat } };
};

export type UpdateOutcome =
  | "ignored-unauthorized"
  | "ignored-invalid"
  | "duplicate"
  | "help"
  | "started"
  | "busy"
  | "corrected"
  | "callback"
  | "rejected-input"
  | "disabled"
  | "stale-message";

type Job = { id: string; instruction: string; post_id: string | null; state: string; revision: number; publish_results?: unknown };

// Per-platform publish state kept on the job (telegram_jobs.publish_results).
// "sending" is written BEFORE the Meta call; "uncertain" means a call may
// have reached Meta but its outcome was never recorded — Telegram never
// publishes that platform again (no automatic republish).
type PlatformState = "sending" | "published" | "failed" | "uncertain";
type PlatformStates = Partial<Record<PublishPlatform, PlatformState>>;
const ALL_PLATFORMS: PublishPlatform[] = ["instagram", "facebook"];
const PLATFORM_LABELS: Record<PublishPlatform, string> = { instagram: "Instagram", facebook: "Facebook" };

function platformStates(job: Job): PlatformStates {
  const value = job.publish_results;
  return value && typeof value === "object" && !Array.isArray(value) ? ({ ...(value as PlatformStates) }) : {};
}

function availablePlatforms(states: PlatformStates): PublishPlatform[] {
  return ALL_PLATFORMS.filter((platform) => states[platform] !== "published" && states[platform] !== "uncertain");
}

// A message older than this (e.g. queued while no webhook was set) never
// starts paid work.
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;
const JOB_COLUMNS = "id, instruction, post_id, state, revision, publish_results";

const HELP_TEXT =
  "Atlas içerik asistanı\n\nBir içerik talimatı yazın veya sesli gönderin (ör. \"Zekeriyaköy'de villasını satmak isteyenlere doğru fiyatlandırmayı anlatan bir paylaşım hazırla\").\n\nAtlas taslağı hazırlar ve önizlemeyi gönderir: Onayla / Düzelt / Reddet. Onay yayın değildir; yayın için ayrıca platform seçersiniz.";

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

function handlerError(step: string, result: HandlerResult): Error {
  const message = typeof result.data?.error === "string" ? result.data.error : "beklenmeyen yanıt";
  return new Error(`${step} (${result.status}): ${message}`);
}

// The sender AND the chat must both be the authorized user, and the chat
// must be the private one-to-one chat (never a group or channel, even one
// the user is in).
function isAuthorized(update: TelegramUpdate, chatId: string): boolean {
  const from = update.message?.from?.id ?? update.callback_query?.from?.id;
  const chat = update.message?.chat ?? update.callback_query?.message?.chat;
  return (
    from !== undefined &&
    chat?.id !== undefined &&
    chat.type === "private" &&
    String(from) === chatId &&
    String(chat.id) === chatId
  );
}

const reviewButtons = (jobId: string, revision: number): TelegramButton[][] => [
  [
    { text: "✅ Onayla", data: `a:${jobId}:${revision}` },
    { text: "✏️ Düzelt", data: `d:${jobId}:${revision}` },
    { text: "🗑 Reddet", data: `r:${jobId}:${revision}` },
  ],
];

// Only platforms that are neither published nor uncertain get a button.
const publishButtons = (jobId: string, revision: number, available: PublishPlatform[] = ALL_PLATFORMS): TelegramButton[][] => {
  const rows: TelegramButton[][] = [];
  if (available.includes("instagram") && available.includes("facebook")) {
    rows.push([{ text: "Instagram + Facebook'ta yayınla", data: `p:${jobId}:${revision}:both` }]);
  }
  const singles: TelegramButton[] = [];
  if (available.includes("instagram")) singles.push({ text: "Yalnız Instagram", data: `p:${jobId}:${revision}:ig` });
  if (available.includes("facebook")) singles.push({ text: "Yalnız Facebook", data: `p:${jobId}:${revision}:fb` });
  if (singles.length) rows.push(singles);
  rows.push([{ text: "✏️ Düzelt", data: `d:${jobId}:${revision}` }]);
  return rows;
};

const PLATFORM_CHOICES: Record<string, PublishPlatform[]> = { both: ["instagram", "facebook"], ig: ["instagram"], fb: ["facebook"] };

// ===== Entry point =====

export async function handleTelegramUpdate(update: TelegramUpdate, deps: TelegramReviewDeps): Promise<UpdateOutcome> {
  if (typeof update?.update_id !== "number") return "ignored-invalid";
  if (!isAuthorized(update, deps.authorizedChatId)) return "ignored-unauthorized";

  const { error: dedupeError } = await deps.admin.from("telegram_updates").insert({ update_id: update.update_id });
  if (dedupeError) {
    if (dedupeError.code === "23505") return "duplicate";
    throw new Error(`update dedupe failed: ${dedupeError.message}`);
  }

  if (update.callback_query) return handleCallback(update.callback_query, deps);
  return handleMessage(update.message ?? {}, deps);
}

// ===== Messages: instructions and corrections =====

// What Atlas's own record says about a post on each platform: Instagram is
// confirmed when the post is "posted", Facebook when publishResults says
// "published" (both written only after Meta reported success).
async function confirmedPlatforms(postId: string | null, deps: TelegramReviewDeps): Promise<Set<PublishPlatform>> {
  const confirmed = new Set<PublishPlatform>();
  if (!postId) return confirmed;
  const { data: post } = await deps.admin.from("generated_posts").select("status, metadata").eq("id", postId).eq("user_id", deps.userId).maybeSingle();
  if (post?.status === "posted") confirmed.add("instagram");
  const facebook = (post?.metadata as { publishResults?: { facebook?: { state?: unknown } } } | null)?.publishResults?.facebook;
  if (facebook?.state === "published") confirmed.add("facebook");
  return confirmed;
}

function describeStates(states: PlatformStates): string[] {
  return ALL_PLATFORMS.filter((p) => states[p]).map((p) => {
    const state = states[p];
    const label = PLATFORM_LABELS[p];
    if (state === "published") return `✅ ${label}: yayında (Atlas kaydı doğruluyor)`;
    if (state === "uncertain") return `⚠️ ${label}: durumu belirsiz — Meta'ya gönderilmiş olabilir. Lütfen ${label}'da kontrol edin; Atlas bu platformu Telegram'dan tekrar yayınlamaz.`;
    if (state === "failed") return `❌ ${label}: yayınlanmadı`;
    return `${label}: ${state}`;
  });
}

// A job whose after() work was cut off (function timeout/crash) stays in
// "generating" or "publishing". On the next authorized message, any such
// job older than any function can live is recovered with a guarded update:
// generating -> failed (reported); publishing -> approved, where every
// platform that was being sent is checked against Atlas's own record:
// confirmed -> "published", otherwise -> "uncertain" (never republished
// from Telegram). Only platforms that are still safe get a button.
async function recoverStaleJobs(deps: TelegramReviewDeps): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_GENERATION_MS).toISOString();
  const { data } = await deps.admin
    .from("telegram_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", deps.userId)
    .in("state", ["generating", "publishing"])
    .lt("updated_at", staleBefore);
  for (const job of (data ?? []) as Job[]) {
    if (job.state === "generating") {
      const { data: recovered } = await deps.admin
        .from("telegram_jobs")
        .update({ state: "failed", error: "zaman aşımı", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("user_id", deps.userId)
        .eq("state", "generating")
        .eq("revision", job.revision)
        .select("id");
      if (recovered?.length) {
        await deps.telegram.sendText("Önceki içerik hazırlanırken yarıda kaldı (zaman aşımı). Atlas'taki taslakları kontrol edip yeni talimat gönderebilirsiniz.");
      }
      continue;
    }

    const states = platformStates(job);
    const confirmed = await confirmedPlatforms(job.post_id, deps);
    for (const platform of ALL_PLATFORMS) {
      if (states[platform] === "sending") states[platform] = confirmed.has(platform) ? "published" : "uncertain";
    }
    const { data: recovered } = await deps.admin
      .from("telegram_jobs")
      .update({ state: "approved", publish_results: states, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", deps.userId)
      .eq("state", "publishing")
      .eq("revision", job.revision)
      .select("id");
    if (!recovered?.length) continue;
    const available = availablePlatforms(states);
    await deps.telegram.sendText(
      `Önceki yayın yarıda kaldı.\n${describeStates(states).join("\n")}`,
      available.length ? publishButtons(job.id, job.revision, available) : undefined,
    );
  }
}

async function handleMessage(message: NonNullable<TelegramUpdate["message"]>, deps: TelegramReviewDeps): Promise<UpdateOutcome> {
  const text = message.text?.trim();
  if (text && /^\/(start|yardim|yardım|help)\b/i.test(text)) {
    await deps.telegram.sendText(deps.actionsEnabled ? HELP_TEXT : `${HELP_TEXT}\n\n(Şu an yalnız bu komut etkin; içerik üretimi ve yayın henüz açık değil.)`);
    return "help";
  }
  if (!deps.actionsEnabled) {
    await deps.telegram.sendText("Atlas'ın Telegram üzerinden içerik üretimi henüz etkin değil; şimdilik yalnız /start çalışıyor.");
    return "disabled";
  }
  if (typeof message.date === "number" && Date.now() - message.date * 1000 > MAX_MESSAGE_AGE_MS) {
    await deps.telegram.sendText("Bu mesaj gecikmeli ulaştığı için işlenmedi. Talimatı istiyorsanız yeniden gönderin.");
    return "stale-message";
  }
  await recoverStaleJobs(deps);

  let instruction = text ?? "";
  if (!instruction && message.voice?.file_id) {
    const voice = await deps.telegram.downloadVoice(message.voice.file_id);
    const transcript = voice.ok ? await deps.transcribe(voice.bytes) : voice;
    if (!transcript.ok) {
      await deps.telegram.sendText(`Sesli mesaj anlaşılamadı: ${transcript.error}`);
      return "rejected-input";
    }
    instruction = transcript.text;
    await deps.telegram.sendText(`Anladığım talimat:\n"${instruction}"`);
  }
  if (!instruction) {
    await deps.telegram.sendText("Yalnız yazılı veya sesli talimat kabul ediliyor.");
    return "rejected-input";
  }

  const { data: jobs } = await deps.admin
    .from("telegram_jobs")
    .select("id, instruction, post_id, state, revision, updated_at")
    .eq("user_id", deps.userId)
    .in("state", ["awaiting_correction", "generating"])
    .order("updated_at", { ascending: false })
    .limit(5);
  const open = (jobs ?? []) as (Job & { updated_at: string })[];

  const correcting = open.find((job) => job.state === "awaiting_correction");
  if (correcting) return applyCorrection(correcting, instruction, deps);

  const generating = open.find((job) => job.state === "generating" && Date.now() - Date.parse(job.updated_at) < STALE_GENERATION_MS);
  if (generating) {
    await deps.telegram.sendText("Önceki içerik hâlâ hazırlanıyor; bitince yeni talimat gönderebilirsiniz.");
    return "busy";
  }

  if (instruction.length < MIN_INSTRUCTION_LENGTH) {
    await deps.telegram.sendText("Lütfen konuyu ve kime hitap edeceğini birkaç kelimeyle anlatın (en az 15 karakter).");
    return "rejected-input";
  }

  const { data: job, error } = await deps.admin
    .from("telegram_jobs")
    .insert({ user_id: deps.userId, instruction: instruction.slice(0, MAX_INSTRUCTION_LENGTH), state: "generating", revision: 1 })
    .select("id, instruction, post_id, state, revision")
    .single();
  if (error || !job) throw new Error(`job insert failed: ${error?.message ?? "no row"}`);

  await deps.telegram.sendText("Talimat alındı. İçerik ve görseller hazırlanıyor (1–2 dakika).");
  await produceDraft(job as Job, (job as Job).instruction, 1, undefined, deps);
  return "started";
}

async function applyCorrection(job: Job, correction: string, deps: TelegramReviewDeps): Promise<UpdateOutcome> {
  const revision = job.revision + 1;
  const { data: claimed } = await deps.admin
    .from("telegram_jobs")
    .update({ state: "generating", revision, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("user_id", deps.userId)
    .eq("state", "awaiting_correction")
    .eq("revision", job.revision)
    .select("id");
  if (!claimed?.length) return "duplicate";

  // The previous draft is withdrawn: back to draft (an earlier approval no
  // longer applies) and marked rejected. A published post is never touched.
  let baseImageUrl: string | undefined;
  if (job.post_id) {
    const { data: old } = await deps.admin
      .from("generated_posts")
      .select("status, metadata, base_image_url")
      .eq("id", job.post_id)
      .eq("user_id", deps.userId)
      .maybeSingle();
    if (old && old.status !== "posted") {
      baseImageUrl = typeof old.base_image_url === "string" ? old.base_image_url : undefined;
      const metadata = old.metadata && typeof old.metadata === "object" ? (old.metadata as Record<string, unknown>) : {};
      await deps.admin
        .from("generated_posts")
        .update({ status: "draft", metadata: { ...metadata, review: { state: "rejected", at: new Date().toISOString(), reason: "superseded" } } })
        .eq("id", job.post_id)
        .eq("user_id", deps.userId)
        .in("status", ["draft", "approved"]);
    }
  }

  await deps.telegram.sendText("Düzeltme alındı. Metin yeniden yazılıyor; mevcut görsel kullanılıyor.");
  const instruction = `${job.instruction}\n\nDÜZELTME: ${correction}`.slice(0, MAX_INSTRUCTION_LENGTH);
  await produceDraft(job, instruction, revision, baseImageUrl, deps);
  return "corrected";
}

async function produceDraft(job: Job, instruction: string, revision: number, reuseBaseImageUrl: string | undefined, deps: TelegramReviewDeps): Promise<void> {
  try {
    const packageResult = await deps.generatePackage({ instruction, visualFormat: "carousel" });
    const contentPackage = packageResult.data?.contentPackage as { caption?: string; hashtags?: string[] } | undefined;
    if (packageResult.status !== 200 || !contentPackage) throw handlerError("içerik", packageResult);

    const visualResult = await deps.generateVisual({ message: instruction, visualFormat: "carousel", contentPackage }, reuseBaseImageUrl);
    const images = (visualResult.data?.images as { slide?: number; imageUrl?: string }[] | undefined) ?? [];
    const urls = images
      .slice()
      .sort((a, b) => (a.slide ?? 0) - (b.slide ?? 0))
      .map((image) => image.imageUrl)
      .filter((url): url is string => typeof url === "string");
    if (visualResult.status !== 200 || urls.length !== 5) throw handlerError("görsel", visualResult);

    const { data: post } = await deps.admin
      .from("generated_posts")
      .select("id")
      .eq("user_id", deps.userId)
      .eq("final_image_url", urls[0])
      .maybeSingle();
    if (!post?.id) throw new Error("taslak kaydı bulunamadı");

    await deps.admin
      .from("telegram_jobs")
      .update({ post_id: post.id, state: "awaiting_review", error: null, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", deps.userId)
      .eq("revision", revision);

    const caption = typeof contentPackage.caption === "string" ? contentPackage.caption : "";
    const hashtags = Array.isArray(contentPackage.hashtags) ? contentPackage.hashtags.join(" ") : "";
    await deps.telegram.sendPhotos(urls, `Taslak önizleme (revizyon ${revision})`);
    await deps.telegram.sendText(`${caption}\n\n${hashtags}`.trim(), reviewButtons(job.id, revision));
  } catch (error) {
    const message = shortError(error);
    console.error("Telegram draft failed:", message);
    await deps.admin
      .from("telegram_jobs")
      .update({ state: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", deps.userId)
      .eq("revision", revision);
    await deps.telegram.sendText(`Taslak hazırlanamadı: ${message}\nYeni bir talimatla tekrar deneyebilirsiniz.`);
  }
}

// ===== Buttons =====

async function handleCallback(query: NonNullable<TelegramUpdate["callback_query"]>, deps: TelegramReviewDeps): Promise<UpdateOutcome> {
  const callbackId = query.id ?? "";
  const messageId = query.message?.message_id;
  if (!deps.actionsEnabled) {
    await deps.telegram.answerCallback(callbackId, "Telegram işlemleri henüz etkin değil.");
    return "disabled";
  }
  const [action, jobId, revisionText, platformKey] = (query.data ?? "").split(":");
  const revision = Number(revisionText);
  if (!jobId || !Number.isInteger(revision)) {
    await deps.telegram.answerCallback(callbackId, "Geçersiz işlem.");
    return "ignored-invalid";
  }

  const { data: jobRow } = await deps.admin
    .from("telegram_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("user_id", deps.userId)
    .maybeSingle();
  const job = jobRow as Job | null;
  if (!job || job.revision !== revision) {
    await deps.telegram.answerCallback(callbackId, "Bu buton artık geçerli değil (içerik düzeltildi veya kapandı).");
    return "callback";
  }

  // (state, revision) guarded transition: false = already handled.
  const transition = async (from: string[], to: string): Promise<boolean> => {
    const { data } = await deps.admin
      .from("telegram_jobs")
      .update({ state: to, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", deps.userId)
      .eq("revision", revision)
      .in("state", from)
      .select("id");
    return Boolean(data?.length);
  };

  if (action === "a") {
    if (!job.post_id || !(await transition(["awaiting_review"], "approved"))) {
      await deps.telegram.answerCallback(callbackId, "Bu taslak zaten işlendi.");
      return "callback";
    }
    const { data: current } = await deps.admin.from("generated_posts").select("metadata").eq("id", job.post_id).eq("user_id", deps.userId).maybeSingle();
    const { data: approved } = isRejectedDraft(current?.metadata)
      ? { data: [] }
      : await deps.admin
          .from("generated_posts")
          .update({ status: "approved" })
          .eq("id", job.post_id)
          .eq("user_id", deps.userId)
          .eq("status", "draft")
          .select("id");
    if (!approved?.length) {
      await transition(["approved"], "awaiting_review");
      await deps.telegram.answerCallback(callbackId, "Taslak onaylanamadı.");
      return "callback";
    }
    await deps.telegram.answerCallback(callbackId, "Onaylandı");
    if (messageId) await deps.telegram.clearButtons(messageId);
    await deps.telegram.sendText(
      "Onaylandı. Onay yayın değildir — hangi platformlarda yayınlansın?",
      publishButtons(job.id, revision, availablePlatforms(platformStates(job))),
    );
    return "callback";
  }

  if (action === "d") {
    if (!(await transition(["awaiting_review", "approved"], "awaiting_correction"))) {
      await deps.telegram.answerCallback(callbackId, "Bu taslak zaten işlendi.");
      return "callback";
    }
    await deps.telegram.answerCallback(callbackId, "Düzeltme bekleniyor");
    if (messageId) await deps.telegram.clearButtons(messageId);
    await deps.telegram.sendText("Ne değişsin? Düzeltmeyi yazın veya sesli gönderin. Bu taslağın önceki onayı geçersiz olacak.");
    return "callback";
  }

  if (action === "r") {
    if (!(await transition(["awaiting_review", "awaiting_correction"], "rejected"))) {
      await deps.telegram.answerCallback(callbackId, "Bu taslak zaten işlendi.");
      return "callback";
    }
    if (job.post_id) {
      const { data: post } = await deps.admin.from("generated_posts").select("metadata").eq("id", job.post_id).eq("user_id", deps.userId).maybeSingle();
      const metadata = post?.metadata && typeof post.metadata === "object" ? (post.metadata as Record<string, unknown>) : {};
      await deps.admin
        .from("generated_posts")
        .update({ metadata: { ...metadata, review: { state: "rejected", at: new Date().toISOString() } } })
        .eq("id", job.post_id)
        .eq("user_id", deps.userId)
        .eq("status", "draft");
    }
    await deps.telegram.answerCallback(callbackId, "Reddedildi");
    if (messageId) await deps.telegram.clearButtons(messageId);
    await deps.telegram.sendText("Taslak reddedildi; yayınlanmayacak.");
    return "callback";
  }

  if (action === "p") {
    const platforms = PLATFORM_CHOICES[platformKey ?? ""];
    const states = platformStates(job);
    const uncertain = (platforms ?? []).filter((p) => states[p] === "uncertain");
    if (uncertain.length) {
      await deps.telegram.answerCallback(callbackId, `${uncertain.map((p) => PLATFORM_LABELS[p]).join(", ")} yayın durumu belirsiz; Telegram'dan tekrar yayınlanmaz.`);
      return "callback";
    }
    if (platforms?.length && platforms.every((p) => states[p] === "published")) {
      await deps.telegram.answerCallback(callbackId, "Seçilen platformda zaten yayında.");
      return "callback";
    }
    if (!platforms || !job.post_id || !(await transition(["approved"], "publishing"))) {
      await deps.telegram.answerCallback(callbackId, "Bu yayın isteği zaten işlendi.");
      return "callback";
    }
    await deps.telegram.answerCallback(callbackId, "Yayınlanıyor…");
    if (messageId) await deps.telegram.clearButtons(messageId);

    // Recorded BEFORE Meta is called, so a cut-off run is recognized later.
    for (const platform of platforms) if (states[platform] !== "published") states[platform] = "sending";
    await deps.admin.from("telegram_jobs").update({ publish_results: states }).eq("id", job.id).eq("user_id", deps.userId);

    let lines: string[];
    try {
      const result = await deps.publish(job.post_id, platforms);
      if (result.error) {
        // Refused before any Meta call (e.g. not approved): nothing was sent.
        for (const platform of platforms) if (states[platform] === "sending") states[platform] = "failed";
        lines = [`Yayın başlatılamadı: ${result.error}`];
      } else {
        for (const outcome of result.results) states[outcome.platform] = outcome.status === "failed" ? "failed" : "published";
        // A chosen platform the publisher did not report on may have been sent.
        for (const platform of platforms) if (states[platform] === "sending") states[platform] = "uncertain";
        lines = await describePublishResults(job.post_id, result, deps);
      }
    } catch (error) {
      // Unknown how far the publisher got: never assume nothing was sent.
      for (const platform of platforms) if (states[platform] === "sending") states[platform] = "uncertain";
      lines = [`Yayın sırasında hata: ${shortError(error)}`];
    }
    const uncertainLines = describeStates(states).filter((line) => line.startsWith("⚠️"));
    const allDone = ALL_PLATFORMS.filter((p) => platforms.includes(p)).every((p) => states[p] === "published");
    await deps.admin.from("telegram_jobs").update({ publish_results: states }).eq("id", job.id).eq("user_id", deps.userId);
    await transition(["publishing"], allDone ? "published" : "approved");
    const available = availablePlatforms(states);
    await deps.telegram.sendText(
      `Yayın sonucu:\n${[...lines, ...uncertainLines].join("\n")}`,
      allDone || !available.length ? undefined : publishButtons(job.id, revision, available),
    );
    return "callback";
  }

  await deps.telegram.answerCallback(callbackId, "Geçersiz işlem.");
  return "ignored-invalid";
}

async function describePublishResults(postId: string, result: PublishSelectedResult, deps: TelegramReviewDeps): Promise<string[]> {
  const { data: post } = await deps.admin.from("generated_posts").select("metadata").eq("id", postId).eq("user_id", deps.userId).maybeSingle();
  const metadata = (post?.metadata ?? {}) as { instagramMediaId?: unknown; publishResults?: { facebook?: { postId?: unknown } } };
  const lines: string[] = [];
  for (const outcome of result.results) {
    const label = outcome.platform === "instagram" ? "Instagram" : "Facebook";
    if (outcome.status === "failed") {
      lines.push(`❌ ${label}: ${outcome.message}`);
      continue;
    }
    let link: string | undefined;
    if (outcome.platform === "instagram" && typeof metadata.instagramMediaId === "string") {
      link = await deps.instagramPermalink(metadata.instagramMediaId).catch(() => undefined);
    }
    if (outcome.platform === "facebook" && typeof metadata.publishResults?.facebook?.postId === "string") {
      link = `https://www.facebook.com/${metadata.publishResults.facebook.postId}`;
    }
    const verb = outcome.status === "already-published" ? "zaten yayında" : "yayınlandı";
    lines.push(`✅ ${label}: ${verb}${link ? ` — ${link}` : ""}`);
  }
  return lines;
}
