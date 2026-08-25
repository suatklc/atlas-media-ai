import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Forces sharp's core package AND its platform-specific native binary
  // packages (published as separate top-level `@img/sharp-*`/
  // `@img/sharp-libvips-*` packages — confirmed via package-lock.json and
  // local node_modules; they are NOT nested under node_modules/sharp/, so
  // a pattern scoped only to that folder would miss them) into the traced
  // serverless bundle for the one route that uses sharp directly (not via
  // next/image, which has its own separate automatic handling). This is
  // Next.js's own documented escape hatch for exactly this class of
  // problem — a case where the build's own automatic file tracing "might
  // fail to include required files" for a native dependency — and takes
  // effect regardless of which bundler actually produced the build, which
  // matters here since production has shown evidence of not reliably
  // running the build command this repo's package.json specifies.
  // Scoped to only this one route (not a project-wide `/*` key) per
  // Next's own "keep patterns as narrow as possible" guidance — sharp is
  // imported nowhere else (grep-verified against src/lib/ai/image/
  // templates/hero.ts and educational.ts, both reached only through this
  // route).
  outputFileTracingIncludes: {
    "/api/generate-visual": ["./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
};

export default nextConfig;
