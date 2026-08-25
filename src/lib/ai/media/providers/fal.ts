import { fal } from "@fal-ai/client";
import type { GeneratedImage, ImageAspectRatio, ImageGenerationRequest } from "../types";

// Configured once, lazily, on first use — mirrors the lazy-client pattern
// already used by image/client.ts and media/providers/openai.ts. FAL_KEY is
// read only here, only server-side, and is never logged or included in any
// error message/response.
let configured = false;

function ensureFalConfigured(): void {
  if (configured) return;

  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw new Error("FAL_KEY is not configured.");
  }

  fal.config({ credentials });
  configured = true;
}

// Best-effort, model-agnostic explicit pixel dimensions — fal model input
// schemas vary per model (some accept a named size enum, others width/
// height directly), and which exact model Atlas benchmarks against is not
// yet decided (see media/config.ts). Explicit width/height is the safer
// default across models. Confined entirely to this file, as required: no
// fal-specific sizing concept leaks into shared media types or the route.
// Re-verify against the actual chosen benchmark model's input schema before
// any live use.
function toFalImageSize(aspectRatio: ImageAspectRatio): { width: number; height: number } {
  if (aspectRatio === "4:5") return { width: 864, height: 1080 };
  if (aspectRatio === "3:2") return { width: 1536, height: 1024 };
  return { width: 1024, height: 1024 };
}

// Nano Banana-family fal endpoints (fal-ai/nano-banana, fal-ai/nano-banana-2,
// fal-ai/nano-banana-pro, and their fal-ai/gemini-*-image* aliases) take a
// string aspect_ratio field instead of the image_size {width,height} object
// every other fal model benchmarked so far (Seedream, FLUX.2) expects —
// confirmed against the installed @fal-ai/client's own NanoBanana*Input
// types, which have no image_size field at all. Atlas's own
// ImageAspectRatio values ("1:1"/"4:5"/"3:2") already match this family's
// aspect_ratio enum literally, so no numeric mapping is needed, only routing
// to the right input shape. Isolated as one small predicate + one small
// input builder rather than spreading model-name checks through
// generateFalImage itself.
function isNanoBananaFamilyModel(model: string): boolean {
  return model.includes("nano-banana") || model.includes("gemini");
}

// Deliberately minimal for the first Nano Banana Pro benchmark: prompt +
// aspect_ratio only. resolution/enable_web_search/num_images/safety_tolerance
// are all left at the endpoint's own defaults so model quality/behavior is
// isolated from any of those variables — see media/config.ts's
// "fal-benchmark" entry.
function buildFalInput(request: ImageGenerationRequest): Record<string, unknown> {
  if (isNanoBananaFamilyModel(request.model)) {
    return {
      prompt: request.prompt,
      aspect_ratio: request.aspectRatio,
    };
  }
  return {
    prompt: request.prompt,
    image_size: toFalImageSize(request.aspectRatio),
  };
}

// fal's typed endpoint registry only covers models it ships types for; an
// arbitrary/benchmark model id falls outside that, so the result shape is
// treated as unknown and narrowed defensively here rather than trusted.
type FalImageOutput = {
  images?: { url?: unknown; content_type?: unknown }[];
};

function isFalImageOutput(value: unknown): value is FalImageOutput {
  return typeof value === "object" && value !== null;
}

// fal image models return a remote URL, not inline bytes — this is the
// output-normalization step required so the rest of Atlas (upload,
// compositor) keeps receiving the same Buffer + contentType shape
// regardless of provider. Never delegated to storage.ts.
async function fetchImageAsBuffer(url: string): Promise<GeneratedImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fal image fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "image/png";
  const arrayBuffer = await response.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  if (bytes.length === 0) {
    throw new Error("fal image fetch returned no data.");
  }

  return { bytes, contentType };
}

export async function generateFalImage(request: ImageGenerationRequest): Promise<GeneratedImage> {
  ensureFalConfigured();

  const result = await fal.subscribe(request.model, {
    input: buildFalInput(request),
    logs: false,
  });

  const output: unknown = result.data;
  const image = isFalImageOutput(output) ? output.images?.[0] : undefined;
  const url = typeof image?.url === "string" ? image.url : undefined;

  if (!url) {
    throw new Error("fal image generation returned no image data.");
  }

  return fetchImageAsBuffer(url);
}
