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
