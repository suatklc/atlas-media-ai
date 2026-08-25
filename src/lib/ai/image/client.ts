import OpenAI from "openai";

// gpt-image-1 chosen over dall-e-2/3: the SDK's own params note the client
// defaults to dall-e-2 unless a GPT-image-specific parameter is passed, so
// the model is set explicitly rather than relying on that default. Newer
// gpt-image-1.5 / gpt-image-2 variants exist in this SDK version but are not
// used here — gpt-image-1 is the stable, documented, non-deprecated choice
// for this MVP; revisit only if a concrete quality/cost reason appears.
const IMAGE_MODEL = "gpt-image-1";

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export type GeneratedImage = {
  bytes: Buffer;
  contentType: string;
};

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

// Maps an existing CreativeBrief aspectRatio to the nearest size the GPT
// image models natively support. No resizing/cropping happens here — the
// caller keeps Atlas's own intended aspectRatio/dimensionsPx for its
// response metadata; this only picks what to request from the provider.
export function nearestSupportedSize(aspectRatio: string): ImageSize {
  if (aspectRatio === "4:5") {
    return "1024x1536";
  }
  return "1024x1024";
}

// Server-side only. Generates one base image — no text/logo/branding, the
// prompt itself is responsible for that (see creative/image-prompt.ts) —
// and returns raw bytes ready for storage upload. No Supabase logic, no UI
// concerns, no business/listing policy: purely "prompt + size in, bytes out".
export async function generateImage(prompt: string, size: ImageSize): Promise<GeneratedImage> {
  const openai = getOpenAIClient();

  const result = await openai.images.generate({
    model: IMAGE_MODEL,
    prompt,
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
