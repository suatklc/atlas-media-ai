import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const AI_MODEL = "claude-sonnet-5";

let cachedClient: Anthropic | null = null;

// Kept available (not removed) even though /api/assistant no longer calls
// it — see AI_TEXT_MODEL/getOpenAITextClient below for the current live
// production text-generation path. Nothing currently imports this except
// the paused, stashed AI-search research experiment.
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

// Production assistant text generation (src/app/api/assistant/route.ts)
// runs on OpenAI, not Anthropic — switched after a real production
// Anthropic credit-balance failure. gpt-4.1-mini: no heavy reasoning is
// needed for this path (Turkish social copy, marker-format compliance,
// low latency/cost); gpt-5-mini is the documented fallback if quality
// testing shows it's needed later — a one-line change here, not a new
// architecture. Deliberately NOT a provider-routing framework: this repo
// does not need multi-provider text generation right now, only a single
// swapped-in provider.
export const AI_TEXT_MODEL = "gpt-4.1-mini";

// Job 2 Model Benchmark: ContentPackage's editorial generation call
// ONLY (src/app/api/content-package/route.ts) — a live, controlled
// benchmark (identical Verified Fact Contract, prompt, schema across
// candidates) showed gpt-5.4 clearly and safely outperforming
// gpt-4.1-mini on expert interpretation, anti-repetition, and language
// quality, at a reasonable latency/cost overhead (no reasoning-token
// markup, ~14s vs ~11s). Deliberately scoped to this ONE call — Job 1
// (fact extraction) and /api/assistant's general chat both stay on
// AI_TEXT_MODEL; this is not a global model swap.
export const CONTENT_PACKAGE_EDITORIAL_MODEL = "gpt-5.4";

let cachedOpenAITextClient: OpenAI | null = null;

// A separate OpenAI client instance from image/client.ts's own
// getOpenAIClient() — same OPENAI_API_KEY, but kept independent so this
// file (text generation) has no import coupling to image/client.ts
// (image generation, a different concern with its own size-mapping
// logic). The minor duplication of ~10 lines of client-init boilerplate
// is the smaller cost here.
export function getOpenAITextClient(): OpenAI {
  if (!cachedOpenAITextClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }
    cachedOpenAITextClient = new OpenAI({ apiKey });
  }
  return cachedOpenAITextClient;
}
