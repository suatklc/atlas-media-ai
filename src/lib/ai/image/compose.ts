import type { CompositionInput } from "./templates/types";
import { renderHero } from "./templates/hero";
import { renderEducational } from "./templates/educational";

// Package 5A: baseImage (binary, not something Content Planning/Creative
// Intelligence computes) plus the structured CompositionInput contract.
export type ComposeInstagramPostInput = CompositionInput & {
  baseImage: Buffer;
};

// Server-only, deterministic, no I/O beyond the Sharp/libvips pipeline (via
// the selected template renderer): no API calls, no Supabase logic, no UI
// logic.
//
// Thin dispatcher on visualTemplateId. "comparison" TEMPORARILY falls back
// to the hero renderer — its real renderer doesn't exist yet (Package
// 5B-3). This is an explicit, documented stand-in driven only by the
// already-computed visualTemplateId; it never inspects caption text or
// makes any additional classification decision here.
export async function composeInstagramPost(input: ComposeInstagramPostInput): Promise<Buffer> {
  switch (input.visualTemplateId) {
    case "hero":
      return renderHero(input);
    case "educational":
      return renderEducational(input);
    case "comparison":
      // TODO(5B-3): replace with a dedicated comparison renderer.
      return renderHero(input);
    default:
      return renderHero(input);
  }
}
