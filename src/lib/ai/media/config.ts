import type { ImageProvider } from "./types";

// Today's exact production behavior — must not change as part of provider
// abstraction. generate-visual/route.ts uses this unless an explicit,
// allowlisted server-side override is supplied (see IMAGE_MODEL_CONFIGS
// below); there is no public/browser-supplied way to change this.
export const DEFAULT_IMAGE_PROVIDER: ImageProvider = "openai";
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";

export type ImageModelConfig = {
  provider: ImageProvider;
  model: string;
};

// Named, allowlisted configs only — never an arbitrary provider/model
// string from the browser. To benchmark a new fal model, add a named entry
// here; nothing else needs to change. "fal-benchmark"'s model id is a
// placeholder — set it to the actual model being benchmarked before use.
export const IMAGE_MODEL_CONFIGS: Record<string, ImageModelConfig> = {
  default: { provider: DEFAULT_IMAGE_PROVIDER, model: DEFAULT_IMAGE_MODEL },
  "fal-benchmark": { provider: "openai", model: "gpt-image-1" },
};
