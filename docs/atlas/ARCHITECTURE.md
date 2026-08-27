# Atlas — Architecture Memory

Describes the CURRENT repository architecture only. Verify against the
repo before relying on specifics — this is a map, not a spec.

## A. Content pipeline

`user message` OR `ContentOpportunity` (research)
→ `buildContentPlan` (`src/lib/ai/content/plan.ts`) — intent, goal,
  audience, output mode/slide count, format, template
→ `buildCreativeBrief` (`src/lib/ai/creative/brief.ts`) — direction +
  execution guidance from lookup tables
→ `buildContentDirective` / `buildCreativeDirective` /
  `buildResearchDirective` (when a ContentOpportunity drove the request)
  — assembled into the Claude system prompt
→ Claude streams the caption + `[[VISUAL_HEADLINE]]` /
  `[[EDUCATIONAL_POINTS]]` / `[[CAROUSEL_STRUCTURE]]` markers
  (`src/lib/ai/creative/caption.ts` extracts/strips them)

`ContentIntent` and visual output format (`OutputMode`: single/carousel)
are independent — a ContentOpportunity's `suggestedContentType` is never
rewritten to fit a visual-format choice.

## B. Research pipeline

Live adapters (`src/lib/ai/research/retrieval/providers/`: `tcmb.ts`,
`tkgm.ts`) → `retrieveCurrentInformation`
(`retrieval/router.ts`, fan-out + relevance scoring)
→ `discover.ts` (`discoverCurrentContentOpportunities`) — builds and
  ranks `ContentOpportunity` objects, applies a 30-day freshness cutoff,
  topic-family diversification, recurring-series suppression
→ `/api/research/discover` → `CurrentOpportunities.tsx` dashboard card

**Current limitations (verified in `retrieval/router.ts`):**
- TÜİK (`veriportali.tuik.gov.tr`) not connected — JS-rendered SPA, no
  discoverable public API.
- Resmî Gazete adapter (`retrieval/providers/resmiGazete.ts`) exists and
  is parsing-correct, but is NOT registered — Node's fetch cannot
  complete a TLS handshake to `www.resmigazete.gov.tr`
  (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), while curl succeeds. Do not work
  around by disabling TLS verification.
- Sarıyer Belediyesi (`sariyer.bel.tr`) has no live adapter — full JS SPA,
  no server-rendered content reachable via fetch.
- Only 2 live sources today (TCMB, TKGM) → limited official-source
  diversity.

## C. Image pipeline

OpenAI base image (`src/lib/ai/media/providers/openai.ts`, via
`media/router.ts`) → SVG composition (`src/lib/ai/image/templates/*.ts`)
→ `@resvg/resvg-wasm` rasterization (`src/lib/ai/image/resvg-renderer.ts`)
→ Supabase Storage (`src/lib/supabase/storage.ts`)

`sharp` was removed (packaging failures on Vercel's linux-x64 serverless
runtime) in favor of `@resvg/resvg-wasm`. Do not reintroduce `sharp`
casually — see GUARDRAILS.md.

## D. Hero (single image)

`templates/hero.ts` — approved, frozen v1. Bottom-anchored headline/CTA,
Suat Kılıç brand mark bottom-right, single 1080×1350 (or platform-sized)
PNG.

## E. Carousel (real, multi-slide)

`templates/carousel.ts` — 5 separate PNGs, each exactly 1080×1350 (per
`platform/config.ts`'s Instagram preset). Reuses ONE generated base image
per carousel (panned/cropped per slide via `resvg-renderer.ts`'s
`buildPannedCoverImageMarkup`); slide 5 is a photo-free branded closing
card. Slide narrative: cover → what happened → why it matters →
practical considerations → summary/CTA. Driven by the `[[CAROUSEL_
STRUCTURE]]` marker plus `[[EDUCATIONAL_POINTS]]`. Persisted without a
schema migration — cover slide as `final_image_url`, all 5 URLs in the
existing `metadata` jsonb column on `generated_posts`.

`hero.ts`, `brand.ts`, and `educational.ts` are not modified by the
carousel work.

## F. Publishing

`generated_posts.status`: `draft` → (explicit user approval) → `approved`
→ `publishGeneratedPost.ts` → `publishing/router.ts` → provider →
`posted`.

- Instagram: live via Meta Graph API (`publishing/providers/meta.ts`,
  `publishing/connections/meta-graph.ts`).
- Facebook: routed to the Meta provider but the actual post call
  (`publishFacebookPagePost`) is an intentional stub that always throws —
  not yet implemented.
- LinkedIn / Google Business: no provider assigned at all
  (`publishing/config.ts`) — `publishing/router.ts` returns an explicit
  "not yet configured" failure, never a silent fallback.

`publishing/eligibility.ts` requires `status === "approved"` (plus a
valid platform, caption, image, and configured provider) before anything
is eligible to publish — this is the enforced approval gate.

## G. Stack

Next.js 15 (App Router) · React 19 · TypeScript · Supabase (auth + DB +
storage) · Anthropic Claude (content) · OpenAI image generation ·
`@resvg/resvg-wasm` (rasterization) · Vercel (hosting) · Meta Graph API
(Instagram/Facebook publishing).
