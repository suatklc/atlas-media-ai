import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = "claude-sonnet-5";

let cachedClient: Anthropic | null = null;

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
