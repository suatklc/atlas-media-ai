import type { GeneratedImage, ImageGenerationRequest } from "./types";
import { generateOpenAIImage } from "./providers/openai";
import { generateFalImage } from "./providers/fal";

// Pure routing by request.provider — no automatic/AI-based provider
// selection, no fallback between providers. The switch is exhaustive over
// ImageProvider at compile time; the default branch is a runtime guard only
// (e.g. a value that reached here via an `as` cast or an unvalidated
// external source), never expected to fire for a type-checked caller.
export async function generateImage(request: ImageGenerationRequest): Promise<GeneratedImage> {
  switch (request.provider) {
    case "openai":
      return generateOpenAIImage(request);
    case "fal":
      return generateFalImage(request);
    default: {
      const unsupported: never = request.provider;
      throw new Error(`Unsupported image provider: ${String(unsupported)}`);
    }
  }
}
