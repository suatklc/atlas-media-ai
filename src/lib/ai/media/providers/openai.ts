import OpenAI from "openai";
import type { GeneratedImage, ImageAspectRatio, ImageGenerationRequest } from "../types";

type OpenAIImageSize = "1024x1024" | "1024x1536" | "1536x1024";

let cachedClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!cachedClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }
    cachedClient = new OpenAI({ apiKey });
  }
  return cachedClient;
}

// Same mapping the original image/client.ts's nearestSupportedSize used:
// "4:5" -> the taller portrait size, everything else -> square. "3:2" is new
// (the original function never received it in production — no caller ever
// requested it — but the original ImageSize type already reserved
// "1536x1024" for exactly this landscape case), so it maps there rather than
// falling through to square.
function toOpenAISize(aspectRatio: ImageAspectRatio): OpenAIImageSize {
  if (aspectRatio === "4:5") return "1024x1536";
  if (aspectRatio === "3:2") return "1536x1024";
  return "1024x1024";
}

// Faithful adaptation of image/client.ts's generateImage — same lazy
// server-side client, same request shape, same base64 handling, same
// returned shape. The only behavioral difference is that model and aspect
// ratio now come from the request (provider abstraction) instead of being
// hardcoded/pre-mapped by the caller; for today's default config
// (provider: "openai", model: "gpt-image-1") the actual OpenAI call is
// byte-for-byte identical to before.
export async function generateOpenAIImage(request: ImageGenerationRequest): Promise<GeneratedImage> {
  const openai = getOpenAIClient();
  const size = toOpenAISize(request.aspectRatio);

  const result = await openai.images.generate({
    model: request.model,
    prompt: request.prompt,
    size,
    n: 1,
    output_format: "png",
    quality: "high",
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image generation returned no image data.");
  }

  return { bytes: Buffer.from(b64, "base64"), contentType: "image/png" };
}
