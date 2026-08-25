"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  Briefcase,
  Camera,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  Mail,
  MessageCircle,
  Send,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import { quickActions } from "@/lib/mock-data";
import { buildPublishableCaption, extractVisualHeadlineMarker, stripLeadingLabel } from "@/lib/ai/creative/caption";
import { PLATFORM_CONFIGS, DEFAULT_PLATFORM, type PlatformId } from "@/lib/ai/platform/config";

const PLATFORM_OPTIONS = Object.values(PLATFORM_CONFIGS);

const markdownComponents: Components = {
  h1: ({ children }) => <h3 className="mb-1.5 mt-2 text-base font-semibold text-white first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-2 text-base font-semibold text-white first:mt-0">{children}</h3>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold text-white first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
    >
      {children}
    </a>
  ),
};

type TransformAction = {
  id: string;
  label: string;
  prompt: string;
  icon: LucideIcon;
};

const transformActions: TransformAction[] = [
  {
    id: "instagram",
    label: "Instagram",
    prompt:
      "Bir önceki yanıtını, kullanıma hazır ve dikkat çekici bir Instagram paylaşımına dönüştür. Yalnızca son paylaşım metnini ver; not, açıklama, öneri, soru veya ek yorum ekleme.",
    icon: Camera,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    prompt:
      "Bir önceki yanıtını, müşterime gönderebileceğim kısa ve profesyonel bir WhatsApp mesajına dönüştür. Yalnızca son mesaj metnini ver; not, açıklama, öneri, soru veya ek yorum ekleme.",
    icon: MessageCircle,
  },
  {
    id: "email",
    label: "E-posta",
    prompt:
      "Bir önceki yanıtını, müşterime gönderebileceğim profesyonel bir e-posta metnine dönüştür. Yalnızca konu satırı ve e-posta gövdesini ver; not, açıklama, öneri, soru veya ek yorum ekleme.",
    icon: Mail,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    prompt:
      "Bir önceki yanıtını, profesyonel bir LinkedIn paylaşımına dönüştür. Güven veren, uzmanlık odaklı ve etkileşim oluşturacak bir dil kullan. Yalnızca son paylaşım metnini ver; not, açıklama, öneri, soru veya ek yorum ekleme.",
    icon: Briefcase,
  },
];

type GeneratedVisual = {
  status: "loading" | "done" | "error";
  imageUrl?: string;
  baseImageUrl?: string;
  isConceptual?: boolean;
  disclaimer?: string | null;
  format?: { aspectRatio: string; dimensions: string };
  error?: string;
  showBase?: boolean;
};

type Message = {
  id: string;
  role: "assistant" | "user";
  text: string;
  image?: GeneratedVisual;
  visualHeadline?: string;
  educationalPoints?: string[];
  assistantResponseText?: string;
  // Captured once, at the moment this assistant response was generated —
  // never re-read from the global selector afterward. Absent on the
  // hardcoded welcome message and on user messages (neither ever renders a
  // "Görsel Oluştur" action, so neither needs one).
  platform?: PlatformId;
};

const MAX_MESSAGE_LENGTH = 4000;

// The nearest preceding user message that isn't itself a transform-rewrite
// prompt — so "Görsel Oluştur" always targets the original real-estate
// request, not an Instagram/WhatsApp/etc. rewrite of a prior reply.
const transformPromptTexts = new Set(transformActions.map((action) => action.prompt));

function findOriginalUserMessage(list: Message[], fromIndex: number): string | null {
  for (let i = fromIndex; i >= 0; i--) {
    if (list[i].role === "user" && !transformPromptTexts.has(list[i].text)) {
      return list[i].text;
    }
  }
  return null;
}

// Generous on purpose: a full Turkish opening sentence should normally fit
// under this without needing any truncation at all. This is a hard safety
// bound for pathological input, not the routine fitting mechanism — that's
// compose.ts's job (word-safe multi-line wrap). Kept aligned with the
// server's own MAX_HEADLINE_LENGTH in generate-visual/route.ts.
const MAX_HEADLINE_LENGTH = 140;
const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";

// Internal Content Planning/Creative Intelligence section labels that must
// never be mistaken for the actual headline if a reply happens to lead with
// one (defensive — the directive already tells the model not to repeat
// these, but the extractor stays robust either way).
const SECTION_LABEL_PATTERNS = [
  /^görsel spesifikasyonu/i,
  /^öne çıkan özellikler/i,
  /^kapanış\s*\/?\s*cta/i,
  /^etiketler/i,
  /^tamamlanması gereken/i,
];

// Deterministic, no AI call: the first meaningful line of the assistant's
// own already-generated reply, stripped of markdown wrappers/separators/
// section labels. Deliberately simple — this is a small text heuristic, not
// a new parsing subsystem.
function extractHeadline(assistantText: string): string {
  const lines = assistantText.split("\n").map((line) => line.trim());

  for (const rawLine of lines) {
    if (!rawLine || /^-{3,}$/.test(rawLine)) {
      continue;
    }

    const unlabeled = rawLine
      // \s+ (not \s*): markdown headings require a space after the #'s —
      // \s* would also eat a lone leading "#" from an unspaced hashtag line.
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\*\*(.+)\*\*$/, "$1")
      .replace(/\*\*/g, "")
      .trim();

    // Checked against the still-labeled line: a known internal section
    // (e.g. "Görsel Spesifikasyonu: ...") must be recognized and skipped
    // whole, even when its content shares a line with its label — checking
    // this AFTER stripping the label would let that content slip through.
    if (SECTION_LABEL_PATTERNS.some((pattern) => pattern.test(unlabeled))) {
      continue;
    }

    // Strip a leading short "Label:" prefix (e.g. "Ana Başlık:", "Caption:")
    // for labels that AREN'T a known internal section — generic shape match
    // rather than an enumerated list, since Claude's exact section names
    // vary by content type and can't be fully enumerated. This surfaces the
    // real content that follows a label on the same line instead of
    // discarding it.
    const line = stripLeadingLabel(unlabeled).trim();

    if (!line) {
      continue;
    }

    return selectHeadlineCandidate(line);
  }

  return FALLBACK_HEADLINE;
}

// Prefers a complete semantic unit over an arbitrary character-boundary cut:
// 1. A genuine first sentence (., !, ?) exists and is a reasonable size —
//    always prefer it, even if the whole line would also fit under the
//    bound. A single complete sentence reads better than "sentence one plus
//    a fragment of sentence two", which is otherwise what a multi-sentence
//    first line under the bound would produce. A 15-char floor filters out
//    decimal points ("1.5 milyon") and abbreviations ("Dr.") being mistaken
//    for sentence boundaries.
// 2. No usable sentence boundary, but the whole line is short enough — use
//    it as-is (trailing period trimmed, headline style).
// 3. Otherwise pass the fuller text through untruncated (still hard-capped
//    at MAX_HEADLINE_LENGTH as a pathological-input safety net) and let
//    compose.ts's own word-safe multi-line wrap do the visual fitting — its
//    ellipsis is the genuine last resort, not this function's routine job.
function selectHeadlineCandidate(line: string): string {
  const sentenceMatch = line.match(/^.+?[.!?]/);
  if (sentenceMatch) {
    const sentence = sentenceMatch[0].replace(/[.!?]+$/, "").trim();
    if (sentence.length >= 15 && sentence.length <= MAX_HEADLINE_LENGTH) {
      return sentence;
    }
  }

  if (line.length <= MAX_HEADLINE_LENGTH) {
    return line.replace(/\.$/, "").trim();
  }

  return hardCapAtWordBoundary(line, MAX_HEADLINE_LENGTH);
}

// Safety net only, for pathological input with no usable sentence boundary
// within the bound. Cuts at the nearest word boundary, never mid-word.
function hardCapAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > maxLength * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

// extractVisualHeadlineMarker (see creative/directive.ts's "Son satır
// (Etiketler'den SONRA): [[VISUAL_HEADLINE: ...]]" instruction) is now
// shared with generate-visual/route.ts, which needs the identical marker
// pattern for its own defensive re-clean of the persisted caption — see
// src/lib/ai/creative/caption.ts. extractHeadline() below is untouched in
// spirit and remains the fallback whenever no valid marker is present
// (older messages, malformed/non-compliant responses, or messages with no
// CreativeBrief at all).

let messageId = 0;
function nextId() {
  messageId += 1;
  return `msg-${messageId}`;
}

export default function AIAssistantPanel() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      role: "assistant",
      text: "Merhaba! Ben Atlas AI asistanınızım. İçerik üretimi, ilanlar veya fırsatlarınızla ilgili size nasıl yardımcı olabilirim?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isWaitingFirstChunk, setIsWaitingFirstChunk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Single, panel-level choice (not per-message) — applies to whichever
  // "Görsel Oluştur" button is clicked next. Instagram by default, matching
  // today's only prior behavior.
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>(DEFAULT_PLATFORM);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isWaitingFirstChunk]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      setError(`Mesajınız çok uzun. En fazla ${MAX_MESSAGE_LENGTH} karakter girebilirsiniz.`);
      return;
    }

    setError(null);
    const history = messages.slice(-10).map((message) => ({
      role: message.role,
      content: message.text,
    }));

    // Frozen at request start, not re-read from the selector later — the
    // user may change the global selector while this request is still in
    // flight (streaming can take a while), and the response being built
    // right now must stay bound to the platform it was actually generated
    // for, per the "no hidden mismatch" consistency rule.
    const requestPlatform = selectedPlatform;

    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: trimmed }]);
    setInput("");
    setIsSending(true);
    setIsWaitingFirstChunk(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const assistantId = nextId();
    let started = false;
    let fullText = "";

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history, platform: requestPlatform }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Bir hata oluştu. Lütfen tekrar deneyin.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        fullText += chunk;

        if (!started) {
          started = true;
          setIsWaitingFirstChunk(false);
          setMessages((prev) => [
            ...prev,
            { id: assistantId, role: "assistant", text: chunk, platform: requestPlatform },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, text: message.text + chunk } : message,
            ),
          );
        }
      }

      if (!started) {
        setError("Yanıt alınamadı. Lütfen tekrar deneyin.");
      } else {
        // Streaming UX is unchanged above — this is a one-time cleanup pass
        // once the full response is in: extractVisualHeadlineMarker captures
        // the explicit headline/educational points, and buildPublishableCaption
        // (the same shared cleanup already used for the visual-generation
        // caption) drops internal-only sections (Görsel Spesifikasyonu,
        // Tamamlanması Gerekenler, marker syntax) from what's actually
        // stored/displayed/copied/sent as history — the user should never
        // see Atlas's own internal production scaffolding. The raw response
        // is kept separately in assistantResponseText: generate-visual's
        // resolveEducationalPoints() re-extracts from it server-side, so it
        // must stay intact even though the display text is now cleaned.
        const { visualHeadline, educationalPoints } = extractVisualHeadlineMarker(fullText);
        const publishableText = buildPublishableCaption(fullText);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, text: publishableText, visualHeadline, educationalPoints, assistantResponseText: fullText }
              : message,
          ),
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setIsSending(false);
      setIsWaitingFirstChunk(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(input);
  }

  async function handleGenerateVisual(
    assistantMessageId: string,
    originalMessage: string,
    assistantText: string,
    visualHeadline: string | undefined,
    educationalPoints: string[] | undefined,
    assistantResponseText: string | undefined,
    // The platform THIS message was generated for — passed explicitly by
    // the caller (message.platform ?? DEFAULT_PLATFORM), never read from
    // the current global selectedPlatform here, so a later change to the
    // global selector can never retroactively alter which platform an
    // already-generated response's visual is rendered for.
    platform: PlatformId,
  ) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId ? { ...message, image: { status: "loading" } } : message,
      ),
    );

    // Explicit headline from the same Claude call (see the VISUAL_HEADLINE
    // marker) is the primary source; the heuristic stays untouched and only
    // runs as a fallback when no valid marker was present.
    const headline = visualHeadline || extractHeadline(assistantText);
    // Deterministic cleanup only (no rewrite): drops internal-only sections
    // (Görsel Spesifikasyonu, Tamamlanması Gerekenler) and any stray marker
    // text, keeping actual caption prose and hashtags — this is what gets
    // persisted as generated_posts.content and what "Caption'ı Kopyala"
    // copies, so it must never contain internal labels or marker syntax.
    const publishableCaption = buildPublishableCaption(assistantText);

    try {
      const response = await fetch("/api/generate-visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: originalMessage,
          headline,
          content: publishableCaption,
          educationalPoints,
          assistantResponseText,
          platform,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || typeof data?.imageUrl !== "string") {
        throw new Error(data?.error || "Görsel oluşturulamadı. Lütfen tekrar deneyin.");
      }

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                image: {
                  status: "done",
                  imageUrl: data.imageUrl,
                  baseImageUrl: typeof data.baseImageUrl === "string" ? data.baseImageUrl : undefined,
                  isConceptual: data.isConceptual,
                  disclaimer: data.disclaimer,
                  format: data.format,
                },
              }
            : message,
        ),
      );

      // GenerationHistory is a Server Component that fetched its rows at
      // the last page render — without this, the newly-inserted post stays
      // invisible (and "Caption'ı Kopyala" would only ever reach older
      // rows) until the user manually reloads the page.
      router.refresh();
    } catch (err) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                image: {
                  status: "error",
                  error: err instanceof Error ? err.message : "Görsel oluşturulamadı. Lütfen tekrar deneyin.",
                },
              }
            : message,
        ),
      );
    }
  }

  function toggleBaseImage(assistantMessageId: string) {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId && message.image
          ? { ...message, image: { ...message.image, showBase: !message.image.showBase } }
          : message,
      ),
    );
  }

  async function handleCopy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      // Clipboard write failed or unavailable — no UI change, no throw.
    }
  }

  return (
    <section className="animate-fade-up flex flex-col rounded-xl border border-indigo-500/20 bg-zinc-900/50">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
          <Bot className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Akıllı İş Asistanı</p>
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Çevrimiçi
          </p>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {messages.map((message, index) => {
          const originalMessage =
            message.role === "assistant" ? findOriginalUserMessage(messages, index - 1) : null;

          return (
            <div
              key={message.id}
              className={`animate-fade-up flex flex-col gap-2 ${
                message.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
                  message.role === "user"
                    ? "whitespace-pre-wrap bg-indigo-500 text-white"
                    : "border border-zinc-800 bg-zinc-950 text-zinc-200"
                }`}
              >
                {message.role === "assistant" ? (
                  <>
                    <ReactMarkdown remarkPlugins={[remarkBreaks]} components={markdownComponents}>
                      {message.text}
                    </ReactMarkdown>
                    <div className="mt-1.5 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleCopy(message.id, message.text)}
                        aria-label={copiedId === message.id ? "Kopyalandı" : "Yanıtı kopyala"}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
                      >
                        {copiedId === message.id ? (
                          <>
                            <Check className="h-3 w-3" />
                            Kopyalandı
                          </>
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    {!isSending && message.id === messages[messages.length - 1]?.id && (
                      <div className="mt-2">
                        <p className="mb-1.5 text-xs font-medium text-zinc-500">Bu içeriği dönüştür</p>
                        <div className="grid grid-cols-2 gap-2">
                          {transformActions.map((action) => (
                            <button
                              key={action.id}
                              type="button"
                              onClick={() => sendMessage(action.prompt)}
                              disabled={isSending}
                              className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <action.icon className="h-3 w-3 text-indigo-400" />
                              {action.label}
                            </button>
                          ))}
                        </div>
                        {originalMessage && (
                          <button
                            type="button"
                            onClick={() =>
                              handleGenerateVisual(
                                message.id,
                                originalMessage,
                                message.text,
                                message.visualHeadline,
                                message.educationalPoints,
                                message.assistantResponseText,
                                message.platform ?? DEFAULT_PLATFORM,
                              )
                            }
                            disabled={message.image?.status === "loading"}
                            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {message.image?.status === "loading" ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />
                                Görsel oluşturuluyor…
                              </>
                            ) : (
                              <>
                                <ImagePlus className="h-3 w-3 text-indigo-400" />
                                Görsel Oluştur ({PLATFORM_CONFIGS[message.platform ?? DEFAULT_PLATFORM].label})
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    {message.image?.status === "loading" && (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-400">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />
                        Görsel oluşturuluyor, bu işlem 60-90 saniye sürebilir…
                      </div>
                    )}
                    {message.image?.status === "error" && (
                      <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                        {message.image.error}
                      </div>
                    )}
                  </>
                ) : (
                  message.text
                )}
              </div>

              {message.role === "assistant" && message.image?.status === "done" && message.image.imageUrl && (
                <div className="w-full max-w-xl self-center">
                  {/* Preview: reuses the already-generated final image and the
                      already-cleaned publishable caption (message.text) —
                      no new image, no new Claude call. Platform comes from
                      the message itself (locked at generation time), never
                      the live global selector, so an older post keeps
                      showing the platform it was actually generated for. */}
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-zinc-500">Paylaşıma Hazır Post</p>
                    <span className="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                      {PLATFORM_CONFIGS[message.platform ?? DEFAULT_PLATFORM].label}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL; avoids adding a next.config remotePatterns entry for this MVP slice */}
                  <img
                    src={message.image.imageUrl}
                    alt="Paylaşıma hazır post"
                    className="h-auto w-full rounded-lg border border-zinc-800 object-contain"
                  />
                  {message.image.isConceptual && message.image.disclaimer && (
                    <p className="mt-1 text-[11px] text-zinc-500">{message.image.disclaimer}</p>
                  )}
                  <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Caption</p>
                    <p className="whitespace-pre-wrap text-xs text-zinc-300">{message.text}</p>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3">
                    {message.image.baseImageUrl && (
                      <button
                        type="button"
                        onClick={() => toggleBaseImage(message.id)}
                        className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-indigo-300"
                      >
                        {message.image.showBase ? (
                          <>
                            <EyeOff className="h-3 w-3" />
                            Temiz Görseli Gizle
                          </>
                        ) : (
                          <>
                            <Eye className="h-3 w-3" />
                            Temiz Görseli Göster
                          </>
                        )}
                      </button>
                    )}
                    <a
                      href={message.image.imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-indigo-300"
                    >
                      <Download className="h-3 w-3" />
                      Postu Aç / İndir
                    </a>
                  </div>

                  {message.image.showBase && message.image.baseImageUrl && (
                    <div className="mt-2">
                      <p className="mb-1 text-xs font-medium text-zinc-500">Temiz Görsel</p>
                      {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL; avoids adding a next.config remotePatterns entry for this MVP slice */}
                      <img
                        src={message.image.baseImageUrl}
                        alt="Markalama öncesi temiz AI görseli"
                        className="h-auto w-full rounded-lg border border-zinc-800 object-contain"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {isWaitingFirstChunk && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-500" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 px-5 py-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {messages.length < 3 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => sendMessage(action.prompt)}
                disabled={isSending}
                className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3 text-indigo-400" />
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Single source of truth for target platform — chosen before the
            idea is sent, used for both content generation (sendMessage)
            and, later, visual generation (handleGenerateVisual), so the two
            never silently disagree unless the user deliberately changes it
            and sends/generates again. */}
        <div className="mb-2 flex items-center gap-2">
          <label htmlFor="target-platform" className="text-xs font-medium text-zinc-500">
            Platform
          </label>
          <select
            id="target-platform"
            value={selectedPlatform}
            onChange={(event) => setSelectedPlatform(event.target.value as PlatformId)}
            disabled={isSending}
            className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {PLATFORM_OPTIONS.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.label}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Bir mesaj yazın..."
            disabled={isSending}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            aria-label="Gönder"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </section>
  );
}
