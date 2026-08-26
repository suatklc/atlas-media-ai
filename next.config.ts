import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is no longer imported anywhere in this route's dependency graph
  // (see resvg-renderer.ts) — the previous sharp-specific
  // outputFileTracingIncludes entries are now obsolete and removed.
  //
  // Forces the resvg-wasm binary and both bundled fonts (Inter for body
  // text, Playfair Display for the Suat Kılıç brand wordmark — see
  // templates/brand.ts) into the traced serverless bundle for the one
  // route that uses them. All three are read at runtime via fs (see
  // resvg-renderer.ts), not a static import/require Next's automatic
  // tracing can always follow reliably — the same class of "build's own
  // automatic file tracing might fail to include required files" case
  // Next's own docs describe outputFileTracingIncludes for. Scoped to only
  // this one route, per Next's own "keep patterns as narrow as possible"
  // guidance.
  outputFileTracingIncludes: {
    "/api/generate-visual": [
      "./node_modules/@resvg/resvg-wasm/index_bg.wasm",
      "./src/lib/ai/image/fonts/Inter.ttf",
      "./src/lib/ai/image/fonts/PlayfairDisplay-Bold.ttf",
    ],
  },
};

export default nextConfig;
