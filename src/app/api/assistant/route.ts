import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, AI_MODEL } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { knowledgeEntries } from "@/lib/ai/knowledge";
import { matchTopics } from "@/lib/ai/knowledge/router";
import { buildSystemContext } from "@/lib/ai/knowledge/context";
import { assessRequest } from "@/lib/ai/reasoning/assess";
import { buildReasoningDirective } from "@/lib/ai/reasoning/directive";
import { buildContentPlan } from "@/lib/ai/content/plan";
import { buildContentDirective } from "@/lib/ai/content/directive";
import { buildCreativeBrief } from "@/lib/ai/creative/brief";
import { buildCreativeDirective } from "@/lib/ai/creative/directive";
import { DEFAULT_PLATFORM, isPlatformId } from "@/lib/ai/platform/config";
import { buildPlatformDirective } from "@/lib/ai/platform/copy";
import { buildSeedMessage, buildResearchDirective, isContentOpportunity } from "@/lib/ai/research/opportunity";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_MESSAGE_LENGTH = 8000;
const MAX_HISTORY_CHARS = 20000;
const HISTORY_TRUNCATION_TAIL_LENGTH = 3000;
const HISTORY_TRUNCATION_MARKER =
  "\n\n[İçeriğin orta bölümü uzunluk sınırı nedeniyle kısaltıldı]\n\n";
const HISTORY_TRUNCATION_HEAD_LENGTH =
  MAX_HISTORY_MESSAGE_LENGTH - HISTORY_TRUNCATION_TAIL_LENGTH - HISTORY_TRUNCATION_MARKER.length;
const MIN_REQUEST_INTERVAL_MS = 3000;

// In-memory, per-process abuse guard. No external infra: resets on restart
// and does not coordinate across multiple server instances.
const lastRequestAt = new Map<string, number>();
const inFlight = new Set<string>();

type ChatMessage = { role: "user" | "assistant"; content: string };

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function truncateHistoryContent(content: string): string {
  if (content.length <= MAX_HISTORY_MESSAGE_LENGTH) {
    return content;
  }
  const head = content.slice(0, HISTORY_TRUNCATION_HEAD_LENGTH);
  const tail = content.slice(content.length - HISTORY_TRUNCATION_TAIL_LENGTH);
  return head + HISTORY_TRUNCATION_MARKER + tail;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  const { message, history, platform, contentOpportunity: rawContentOpportunity } = body as {
    message?: unknown;
    history?: unknown;
    platform?: unknown;
    // Optional (Research -> Content Opportunity): when present and valid,
    // its rendered seed message drives content planning and the Claude
    // call in place of `message` below (see effectiveMessage) — see
    // isContentOpportunity for the validation this goes through. `message`
    // is required and validated exactly as before ONLY when this is
    // absent/invalid — see below.
    contentOpportunity?: unknown;
  };

  // Optional (Research -> Content Opportunity): malformed/absent input
  // silently falls back to undefined here (never a 400) since this is an
  // additive enrichment, not a required part of the request contract — see
  // isContentOpportunity for what "valid" means. Computed BEFORE the
  // message-required check below, since a valid ContentOpportunity
  // supplies its own seed message and makes `message` itself optional for
  // this request (Handoff — Current Content Opportunities UI: this is the
  // first real caller that omits `message` entirely).
  const contentOpportunity = isContentOpportunity(rawContentOpportunity) ? rawContentOpportunity : undefined;

  // Every ordinary chat message (no contentOpportunity at all) is
  // completely unaffected by the branch below — this is exactly the same
  // required/non-empty/length-bounded validation as before.
  if (!contentOpportunity) {
    if (typeof message !== "string" || message.trim().length === 0) {
      return jsonError("Mesaj boş olamaz.", 400);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonError(
        `Mesajınız çok uzun. En fazla ${MAX_MESSAGE_LENGTH} karakter girebilirsiniz.`,
        400,
      );
    }
  }

  // Missing/undefined -> Instagram (today's only prior behavior); anything
  // present but not one of the allowlisted ids is rejected outright — never
  // silently coerced into arbitrary prompt text — same validation as
  // generate-visual/route.ts's own platform handling.
  if (platform !== undefined && platform !== null && !isPlatformId(platform)) {
    return jsonError("Geçersiz platform.", 400);
  }
  const selectedPlatform = isPlatformId(platform) ? platform : DEFAULT_PLATFORM;

  // effectiveMessage: byte-identical to the prior message.trim() whenever
  // contentOpportunity is absent (the cast is safe — the guard above
  // already proved `message` is a validated non-empty string in that
  // branch). When present, the EXISTING carousel-visual-generation gap
  // (generate-visual/route.ts still rejects outputMode "carousel" — see
  // that file's own unchanged 422) means every ContentOpportunity-driven
  // request forces single-image framing via this fixed Turkish suffix, so
  // the workflow this feeds (Current Content Opportunities UI) actually
  // completes end to end regardless of which visual format the user picks
  // in that UI — that choice instead changes suggestedContentType itself
  // (the frontend sends it already adjusted), not this suffix. This is the
  // smallest integration change for a real, pre-existing limitation, not a
  // new one introduced here; content/format.ts's own SINGLE_PATTERNS is
  // what recognizes this exact phrase.
  const effectiveMessage = contentOpportunity
    ? `${buildSeedMessage(contentOpportunity)} Tek görsel üret.`
    : (message as string).trim();

  const cleanHistory: ChatMessage[] = [];
  if (Array.isArray(history)) {
    for (const item of history.slice(-MAX_HISTORY_MESSAGES)) {
      if (
        item &&
        typeof item === "object" &&
        ((item as ChatMessage).role === "user" || (item as ChatMessage).role === "assistant") &&
        typeof (item as ChatMessage).content === "string" &&
        (item as ChatMessage).content.length > 0
      ) {
        cleanHistory.push({
          role: (item as ChatMessage).role,
          content: truncateHistoryContent((item as ChatMessage).content),
        });
      }
    }
  }

  // Keep the most recent history within budget; drop oldest entries first,
  // preserving chronological order in the result.
  const budgetedHistory: ChatMessage[] = [];
  let totalHistoryChars = 0;
  for (let i = cleanHistory.length - 1; i >= 0; i--) {
    const entry = cleanHistory[i];
    if (totalHistoryChars + entry.content.length > MAX_HISTORY_CHARS) {
      break;
    }
    totalHistoryChars += entry.content.length;
    budgetedHistory.unshift(entry);
  }

  // Anthropic requires the conversation to start with a "user" turn — drop
  // any leading assistant messages (e.g. the client's local welcome bubble).
  while (budgetedHistory.length > 0 && budgetedHistory[0].role === "assistant") {
    budgetedHistory.shift();
  }

  if (inFlight.has(user.id)) {
    return jsonError("Önceki mesajınız hâlâ işleniyor. Lütfen yanıtı bekleyin.", 429);
  }

  const lastAt = lastRequestAt.get(user.id) ?? 0;
  const now = Date.now();
  if (now - lastAt < MIN_REQUEST_INTERVAL_MS) {
    return jsonError(
      "Çok hızlı istek gönderiyorsunuz. Lütfen birkaç saniye bekleyip tekrar deneyin.",
      429,
    );
  }

  let anthropic;
  try {
    anthropic = getAnthropicClient();
  } catch {
    return jsonError("Yapay zeka servisi şu anda kullanılamıyor.", 500);
  }

  lastRequestAt.set(user.id, now);
  inFlight.add(user.id);

  const messages: ChatMessage[] = [...budgetedHistory, { role: "user", content: effectiveMessage }];

  const matchedKnowledge = matchTopics(effectiveMessage, knowledgeEntries);
  const systemContext = buildSystemContext(SYSTEM_PROMPT, matchedKnowledge);

  const requestAssessment = assessRequest(effectiveMessage, matchedKnowledge);
  const reasoningDirective = buildReasoningDirective(requestAssessment);
  const finalSystemContext = reasoningDirective
    ? `${systemContext}\n\n${reasoningDirective}`
    : systemContext;

  // Research-opportunity intent seam (Handoff — quality gate before UI):
  // when a valid ContentOpportunity drove this request, its own grounded
  // suggestedContentType is passed straight through as buildContentPlan's
  // override — never re-derived from the synthetic seed message text,
  // which can otherwise collide with an unrelated keyword trigger. Absent
  // a ContentOpportunity (every ordinary chat message), this is
  // `undefined` and buildContentPlan's own detectContentIntent call runs
  // exactly as it always has.
  const contentPlan = buildContentPlan(effectiveMessage, contentOpportunity?.suggestedContentType);
  const contentDirective = buildContentDirective(contentPlan);
  const combinedSystemContext = contentDirective
    ? `${finalSystemContext}\n\n${contentDirective}`
    : finalSystemContext;

  const creativeBrief = buildCreativeBrief(contentPlan);
  const creativeDirective = buildCreativeDirective(creativeBrief, contentPlan.intent);
  const finalCombinedSystemContext = creativeDirective
    ? `${combinedSystemContext}\n\n${creativeDirective}`
    : combinedSystemContext;

  // Optional (Research -> Content Opportunity, Phase 1): factual-grounding
  // instructions — source attribution, date preservation, no invented
  // statistics, prediction/fact separation — appended only when a valid
  // ContentOpportunity was supplied; a no-op ("") otherwise, same pattern
  // as every other optional directive above.
  const researchDirective = contentOpportunity ? buildResearchDirective(contentOpportunity) : "";
  const finalCombinedSystemContextWithResearch = researchDirective
    ? `${finalCombinedSystemContext}\n\n${researchDirective}`
    : finalCombinedSystemContext;

  // Always appended, unlike the directives above (which can be a no-op) —
  // every request has a resolved platform (default or explicit). The most
  // specific/last instruction: it only shapes phrasing/structure, never
  // what the content plan/creative brief already decided the response
  // should contain.
  const platformDirective = buildPlatformDirective(selectedPlatform);
  const finalSystemContextWithPlatform = `${finalCombinedSystemContextWithResearch}\n\n${platformDirective}`;

  const encoder = new TextEncoder();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      inFlight.delete(user.id);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const anthropicStream = anthropic.messages.stream({
          model: AI_MODEL,
          max_tokens: 4096,
          system: finalSystemContextWithPlatform,
          messages,
        });

        anthropicStream.on("text", (text) => {
          controller.enqueue(encoder.encode(text));
        });

        await anthropicStream.finalMessage();
        controller.close();
      } catch (error) {
        console.error("Assistant stream error:", error);
        controller.error(new Error("Bir hata oluştu. Lütfen tekrar deneyin."));
      } finally {
        release();
      }
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
