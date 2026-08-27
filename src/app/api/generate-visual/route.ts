import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildContentPlan } from "@/lib/ai/content/plan";
import type { ContentIntent } from "@/lib/ai/content/types";
import { buildCreativeBrief } from "@/lib/ai/creative/brief";
import { buildImagePrompt } from "@/lib/ai/creative/image-prompt";
import { generateImage } from "@/lib/ai/media/router";
import {
  DEFAULT_IMAGE_PROVIDER,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODEL_CONFIGS,
  type ImageModelConfig,
} from "@/lib/ai/media/config";
import { PLATFORM_CONFIGS, DEFAULT_PLATFORM, isPlatformId } from "@/lib/ai/platform/config";
import { composeInstagramPost } from "@/lib/ai/image/compose";
import { selectVisualTemplateId } from "@/lib/ai/image/templates/select";
import { uploadGeneratedImage } from "@/lib/supabase/storage";
import { buildPublishableCaption } from "@/lib/ai/creative/caption";
import { resolveEducationalPoints } from "@/lib/ai/content/educational-points";
import { buildSeedMessage, isContentOpportunity } from "@/lib/ai/research/opportunity";

const MAX_MESSAGE_LENGTH = 4000;
// Kept aligned with AIAssistantPanel.tsx's own extractor bound — a full
// Turkish sentence should normally fit under this; this is a defensive cap
// against a malformed/hostile client, not the routine truncation path.
const MAX_HEADLINE_LENGTH = 140;
const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";
// Generous, purely defensive cap for the persisted caption text (history
// only — never fed into any prompt).
const MAX_CONTENT_LENGTH = 8000;

// Generic marketing visual, not documentary evidence of a specific unit —
// appended only for "listing" intent, since the MVP does not yet accept a
// real property photo to generate/enhance from. Never asks for rendered
// text; that constraint already lives in buildImagePrompt's safety clause.
const LISTING_SAFETY_PROMPT_SUFFIX =
  " Bu görsel belirli bir mülkün belgesel niteliğinde fotoğrafı değildir; genel/kavramsal bir emlak pazarlama görselidir ve belirli bir mülkü temsil ettiği izlenimi vermemelidir.";

const LISTING_DISCLAIMER = "Temsili görseldir; gerçek mülkü göstermez.";

// Server-side-only benchmark override: an env var naming a key in the
// allowlisted IMAGE_MODEL_CONFIGS (media/config.ts) — never an arbitrary
// browser-supplied provider/model string, and not exposed through the
// request body or any UI. Absent/unknown key silently falls back to the
// production default rather than failing the request, since this is an
// operator convenience, not a user-facing feature.
function resolveImageModelConfig(): ImageModelConfig {
  const overrideKey = process.env.IMAGE_MODEL_BENCHMARK_OVERRIDE;
  if (overrideKey && IMAGE_MODEL_CONFIGS[overrideKey]) {
    return IMAGE_MODEL_CONFIGS[overrideKey];
  }
  return { provider: DEFAULT_IMAGE_PROVIDER, model: DEFAULT_IMAGE_MODEL };
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function safeField(source: unknown, key: string): unknown {
  if (source && typeof source === "object" && key in source) {
    return (source as Record<string, unknown>)[key];
  }
  return undefined;
}

// Development-only diagnostic helper — purely additive, changes no
// response or behavior. Every existing console.error(label, error) call in
// this route already logs the raw error object, but the structured fields
// the OpenAI SDK (APIError/AuthenticationError/RateLimitError/
// BadRequestError all carry status/code/type/message, and often a nested
// `.error` body), the fal client, Supabase, and Sharp attach to their own
// thrown errors don't reliably print clearly through a bare console.error
// in the `npm run dev` terminal. This extracts exactly those fields (never
// the request body, prompt text, or any API key/Authorization header —
// only whatever the error object itself already carries) into one
// single-line, labeled dump per pipeline stage, so the next failed request
// shows which stage failed and why. Gated to non-production so this adds
// no verbosity to a real deployment's logs.
function logVisualGenerationDiagnostic(stage: string, error: unknown): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  const errorClass = error instanceof Object ? error.constructor?.name : typeof error;
  const details: Record<string, unknown> = {
    stage,
    errorClass,
    status: safeField(error, "status"),
    statusText: safeField(error, "statusText"),
    code: safeField(error, "code"),
    type: safeField(error, "type"),
    message: error instanceof Error ? error.message : (safeField(error, "message") ?? String(error)),
  };

  // OpenAI's APIError often nests the real API-side error under `.error`
  // ({message,type,code,param}) — surfaced one level rather than logged as
  // an opaque nested object.
  const nestedError = safeField(error, "error");
  if (nestedError && typeof nestedError === "object") {
    details.apiErrorType = safeField(nestedError, "type");
    details.apiErrorCode = safeField(nestedError, "code");
    details.apiErrorMessage = safeField(nestedError, "message");
  }

  console.error(`[visual-generation-diagnostic] ${stage}:`, details);
}

// Server-side safety cap, independent of compose.ts's own visual wrapping —
// never trust arbitrary client-supplied text length. Falls back to a neutral
// default if missing/invalid, matching the frontend's own extractor fallback.
// Word-boundary-safe for the same reason the frontend extractor is: this
// should be a rare defensive path, not a routine truncation point, but if it
// ever fires it must not cut mid-word either.
function sanitizeHeadline(value: unknown): string {
  if (typeof value !== "string") {
    return FALLBACK_HEADLINE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return FALLBACK_HEADLINE;
  }
  if (trimmed.length <= MAX_HEADLINE_LENGTH) {
    return trimmed;
  }
  const cut = trimmed.slice(0, MAX_HEADLINE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > MAX_HEADLINE_LENGTH * 0.5 ? cut.slice(0, lastSpace) : cut;
  return `${safe.trimEnd()}…`;
}

// ContentPlan.intent is already the source of truth here — no new
// classifier. Non-listing content omits the CTA rather than inventing
// generic copy that wasn't asked for.
function ctaForIntent(intent: ContentIntent): string | undefined {
  return intent === "listing" ? "Detaylar İçin Mesaj Bırakın" : undefined;
}

// History display text only — never trust arbitrary client-supplied length
// OR structure. buildPublishableCaption is applied here too (not just in
// AIAssistantPanel.tsx) as a defensive re-clean: an older/stale client, or a
// client sending something other than the expected caption, must not be
// able to persist internal labels or marker syntax into generated_posts.
// Returns null (rather than a placeholder) so the caller can fall back to
// the original request text, which is always available.
function sanitizeContent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const cleaned = buildPublishableCaption(value.trim());
  if (!cleaned) {
    return null;
  }
  return cleaned.length > MAX_CONTENT_LENGTH ? cleaned.slice(0, MAX_CONTENT_LENGTH) : cleaned;
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

  const { message, headline, content, educationalPoints, assistantResponseText, platform, contentOpportunity: rawContentOpportunity } = body as {
    message?: unknown;
    headline?: unknown;
    content?: unknown;
    educationalPoints?: unknown;
    assistantResponseText?: unknown;
    platform?: unknown;
    // Optional (Handoff — Current Content Opportunities UI): when present
    // and valid, drives content planning the same way assistant/route.ts's
    // own ContentOpportunity seam already does — see effectiveMessage and
    // the intentOverride passed to buildContentPlan below. `message` is
    // required only when this is absent/invalid.
    contentOpportunity?: unknown;
  };

  const contentOpportunity = isContentOpportunity(rawContentOpportunity) ? rawContentOpportunity : undefined;

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
  // present but not one of the four allowlisted ids is rejected outright
  // rather than silently falling back, so a client typo is never mistaken
  // for a deliberate platform choice.
  if (platform !== undefined && platform !== null && !isPlatformId(platform)) {
    return jsonError("Geçersiz platform.", 400);
  }
  const platformConfig = PLATFORM_CONFIGS[isPlatformId(platform) ? platform : DEFAULT_PLATFORM];

  // effectiveMessage: byte-identical to the prior message.trim() whenever
  // contentOpportunity is absent (the cast is safe — the guard above
  // already validated `message` as a non-empty string in that branch).
  // When present, the fixed Turkish suffix forces single-image framing —
  // see assistant/route.ts's own identical seam for why (carousel visual
  // generation is not supported below regardless — see the outputMode
  // check that follows).
  const effectiveMessage = contentOpportunity
    ? `${buildSeedMessage(contentOpportunity)} Tek görsel üret.`
    : (message as string).trim();

  const safeHeadline = sanitizeHeadline(headline);
  // Research-opportunity intent seam (mirrors assistant/route.ts): a valid
  // ContentOpportunity's own grounded suggestedContentType is passed
  // straight through as buildContentPlan's override, never re-derived from
  // effectiveMessage's text — the same keyword-collision risk applies here
  // as it did for the Claude/content path. Absent a ContentOpportunity,
  // this is `undefined` and behavior is entirely unchanged.
  const contentPlan = buildContentPlan(effectiveMessage, contentOpportunity?.suggestedContentType);

  if (contentPlan.outputMode === "carousel") {
    return jsonError(
      "Carousel metni oluşturulabilir, ancak carousel görsel üretimi henüz desteklenmiyor.",
      422,
    );
  }

  const creativeBrief = buildCreativeBrief(contentPlan);
  const safeEducationalPoints = resolveEducationalPoints(
    contentPlan.intent,
    educationalPoints,
    assistantResponseText,
  );

  if (!creativeBrief) {
    return jsonError("Bu istek için görsel oluşturulamıyor.", 422);
  }

  const basePrompt = buildImagePrompt(creativeBrief, effectiveMessage, contentPlan.intent);
  if (!basePrompt) {
    return jsonError("Bu istek için görsel oluşturulamıyor.", 422);
  }

  const isListing = contentPlan.intent === "listing";
  const finalPrompt = isListing ? `${basePrompt}${LISTING_SAFETY_PROMPT_SUFFIX}` : basePrompt;
  const { provider, model } = resolveImageModelConfig();

  let generated;
  try {
    generated = await generateImage({
      provider,
      model,
      prompt: finalPrompt,
      aspectRatio: platformConfig.aspectRatio,
    });
  } catch (error) {
    console.error("Image generation error:", error);
    logVisualGenerationDiagnostic("image generation (provider call)", error);
    return jsonError("Görsel oluşturulamadı. Lütfen tekrar deneyin.", 502);
  }

  let uploadedBase;
  try {
    uploadedBase = await uploadGeneratedImage(supabase, user.id, generated.bytes, generated.contentType);
  } catch (error) {
    console.error("Base image upload error:", error);
    logVisualGenerationDiagnostic("base image upload (Supabase storage)", error);
    return jsonError("Görsel kaydedilemedi. Lütfen tekrar deneyin.", 502);
  }

  // creativeBrief being non-null already implies contentPlan.template is
  // defined (see buildCreativeBrief's own guard) — this fallback exists only
  // so TypeScript doesn't need a non-null assertion; "NONE" safely resolves
  // to selectVisualTemplateId's own "hero" fallback if it were ever hit.
  const contentTemplateId = contentPlan.template?.id ?? "NONE";
  const visualTemplateId = selectVisualTemplateId(contentTemplateId);

  let composedBytes;
  try {
    composedBytes = await composeInstagramPost({
      baseImage: generated.bytes,
      contentTemplateId,
      visualTemplateId,
      aspectRatio: platformConfig.aspectRatio,
      dimensionsPx: platformConfig.dimensions,
      typographyHierarchy: creativeBrief.execution.typographyHierarchy,
      textPlacement: creativeBrief.execution.textPlacement,
      logoPlacement: creativeBrief.execution.logoPlacement,
      ctaVisualTreatment: creativeBrief.execution.ctaVisualTreatment,
      headline: safeHeadline,
      cta: ctaForIntent(contentPlan.intent),
      educationalPoints: safeEducationalPoints.length > 0 ? safeEducationalPoints : undefined,
    });
  } catch (error) {
    // The base image already generated and uploaded successfully above —
    // this failure is isolated to compositing, logged safely (no prompt
    // content, no stack trace to the client) rather than silently dropped.
    console.error("Post composition error:", error);
    logVisualGenerationDiagnostic("post composition (Sharp)", error);
    return jsonError("Paylaşım görseli oluşturulamadı. Lütfen tekrar deneyin.", 502);
  }

  let uploadedFinal;
  try {
    uploadedFinal = await uploadGeneratedImage(supabase, user.id, composedBytes, "image/png");
  } catch (error) {
    console.error("Final image upload error:", error);
    logVisualGenerationDiagnostic("final image upload (Supabase storage)", error);
    return jsonError("Görsel kaydedilemedi. Lütfen tekrar deneyin.", 502);
  }

  // Persistence for the history feature only — deliberately never allowed
  // to fail the request. Everything the user actually asked for (the image)
  // has already succeeded by this point; a history-row write failure must
  // not take that away from them, only be logged for follow-up.
  try {
    const { error: insertError } = await supabase.from("generated_posts").insert({
      user_id: user.id,
      content: sanitizeContent(content) ?? effectiveMessage,
      visual_headline: safeHeadline,
      final_image_url: uploadedFinal.url,
      base_image_url: uploadedBase.url,
      metadata: {
        isConceptual: isListing,
        disclaimer: isListing ? LISTING_DISCLAIMER : null,
        platform: platformConfig.id,
        aspectRatio: platformConfig.aspectRatio,
        dimensions: platformConfig.dimensions,
      },
    });
    if (insertError) {
      console.error("Generation history insert error:", insertError);
    }
  } catch (error) {
    console.error("Generation history insert error:", error);
  }

  return Response.json({
    imageUrl: uploadedFinal.url,
    baseImageUrl: uploadedBase.url,
    isConceptual: isListing,
    disclaimer: isListing ? LISTING_DISCLAIMER : null,
    format: { aspectRatio: platformConfig.aspectRatio, dimensions: platformConfig.dimensions },
  });
}
