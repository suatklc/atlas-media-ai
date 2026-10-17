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
`tkgm.ts`, `resmiGazete.ts`, `csb.ts`) → `retrieveCurrentInformation`
(`retrieval/router.ts`, fan-out + relevance scoring)
→ `discover.ts` (`discoverCurrentContentOpportunities`) — builds and
  ranks `ContentOpportunity` objects, applies a 30-day freshness cutoff,
  topic-family diversification, recurring-series suppression
→ `/api/research/discover` → `CurrentOpportunities.tsx` dashboard card

`resmiGazete.ts` and `csb.ts` are "mixed official source" adapters (their
sites cover far more than real estate) and share a relevance filter —
`retrieval/relevance.ts`'s `hasAnyWordBoundaryMatch` — before an entry
becomes a candidate; `tcmb.ts`/`tkgm.ts` need no such filter (everything
they publish is already in-domain). `resmiGazete.ts` fetches via
`retrieval/secureFetch.ts` instead of plain `fetch()` — see that file for
why (its own TLS trust-chain fix).

**Current limitations (verified live):**
- TÜİK: no adapter — `www.tuik.gov.tr`'s homepage server-renders a
  bulletin slider (title + reference period) but no verifiable per-item
  *publication* date; the surface that would have one
  (`veriportali.tuik.gov.tr`) is a client-rendered SPA with no
  server-rendered content. Fabricating a date was rejected as unsafe.
- BDDK: reachable (same TLS fix as Resmî Gazete works for it too), but no
  discoverable per-item news/announcement structure — its public site is
  a statistical/PDF bulletin portal, not a discrete-development feed.
- Sarıyer Belediyesi (`sariyer.bel.tr`) still has no live adapter — full
  JS SPA, every route serves an identical shell, no server-rendered
  content reachable via fetch.
- 4 live sources today (TCMB, TKGM, Resmî Gazete, ÇŞİDB). Real-world
  per-run yield still varies day to day — some sources are official
  "mixed content" feeds that legitimately return zero relevant items on a
  quiet day, and Resmî Gazete in particular has shown intermittent
  hangs/timeouts under repeated access (absorbed by the existing
  per-adapter timeout + graceful-failure handling, never surfaced to the
  user as an error).

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

## H. Video / Reels (V1 — provider + Reels logic, no route/UI yet)

Same planning brain as static content; no parallel planning/grounding:

```
ContentOpportunity → ContentPlan → CreativeBrief → /api/content-package
(grounded ContentPackage) → src/lib/ai/video/reelPlan.ts buildReelDraft
(hook ≤3s / stake / one-idea beats ≤4s / payoff / loop; on-screen ≤6 words)
→ editorial gate → media generation → Atlas preview → SUAT APPROVAL → publish
```

- `reelPlan.ts` only re-times lines that already exist in a grounded
  ContentPackage — it can never state anything the carousel couldn't.
  Timing rules adapted from MonsterDylan/instagram-agent-skill `ig-reel`
  (MIT), retuned for spoken Turkish (~2.3 words/s).
- **In-app media path: fal.ai** — `media/router.ts` `generateVideo`
  (Seedance 1.5 Pro image-to-video, 9:16, test/final tiers, $1.50
  per-request cap, OFF unless `VIDEO_GENERATION_ENABLED=true`).
- **Agent-side media path: Higgsfield** — the official `higgsfield` CLI +
  `higgsfield-generate` Claude Code skill (user-level install), for
  Claude-driven generation/benchmarking (e.g. Seedance 2.5, Virality
  Predictor) during Reel production. Not called by the web app. Paid runs
  need Suat's explicit go-ahead each time. fal.ai stays the in-app
  fallback/default until a Higgsfield PoC clearly beats it.
- Approval/publishing is unchanged: a generated clip is a draft asset;
  `publishing/eligibility.ts`'s `status === "approved"` gate applies.

## I. ChatPlace — future seam (NOT implemented; must not delay publishing)

Instagram comments/DMs → qualification/audience intelligence → Atlas
feedback/lead loop. Planned seam, in order:

1. **Inbound:** ChatPlace handles comment-keyword → DM automation and
   lead qualification on its side (Atlas does not rebuild this). The
   Reel/caption CTA keyword ("comment X") is the only coupling at
   publish time — chosen by the Content Strategist, stored in the
   ContentPackage/caption Suat approves.
2. **Signal back into Atlas:** a server-only webhook/export route
   (e.g. `/api/integrations/chatplace`) writing to a new
   `audience_signals` table keyed by `generated_posts.id` + platform —
   questions asked, keyword hits, qualified-lead counts. No PII beyond
   what ChatPlace already holds; no secrets in logs.
3. **Feedback loop:** Current Content Radar ranking and the Content
   Strategist read aggregated `audience_signals` (top recurring
   questions → next topics/angles). Read-only influence; never
   auto-generates or auto-publishes.

Guardrails: ChatPlace never publishes Atlas content and never triggers
generation; every outbound post still goes Draft → Approved → Publish.

## J. Source Intelligence (Radar V2 seam)

- **Source Registry + trust roles** — `src/lib/ai/research/sourceRegistry.ts`.
  TIER 1 `fact-authority` (TKGM, Resmî Gazete, ÇŞİDB, TCMB live; TÜİK, GİB,
  SPK, BDDK, Sarıyer Belediyesi planned) may support facts — still only via
  Job 1 / Gap 1 / Gap 2 / Scenario Boundary. TIER 2 `discovery-context`
  (AA, Dünya) = "something may have happened" + context; ranked below
  fact authorities in any bundle. TIER 3 `social-intelligence` (Emlak
  Haber, Emlak Fikirleri, Emlak Haber Türkiye, Gayrimenkul Gündemi —
  planned, no integration) = topics/formats/hooks only, NEVER fact
  evidence (`socialIntelligence.ts`: a signal can only become a
  `DiscoveryLead`; a factual lead requires a primary source). Adding a
  source = one registry entry (+ an adapter when it should be fetched).
  `classifySourceTier` (sourceQuality.ts) is unchanged; a test guards that
  both agree for every live source.
- **Multi-source opportunities** — `discover.ts` `attachCorroboratingSources`:
  ranking/selection unchanged; the sources of same-event items the
  shortlist suppresses (`isSameUnderlyingDevelopment`) are kept on the
  picked opportunity (fact authorities first, max 3).
- **Evidence bundle with provenance** — `/api/content-package`
  `buildEvidenceBundle` + `factContract.ts` `segmentBundle` /
  `groundBundleFacts`: each source keeps its identity (K1, K2, ...) and its
  own evidence; every fact is resolved to exactly ONE source, then citation
  rescue → Gap 1 → Scenario Boundary → change markers run per source,
  unchanged. No cross-source quote can exist (spans are looked up within one
  source). Job 2 sees source-tagged facts; the response carries
  `provenance` (sources + fact → source label). Conflicts between sources
  are surfaced (separate facts, instruction not to merge), not
  deterministically detected yet.

## K. Content streams (all feed the same Atlas Content Agent)

A. **Current developments** (implemented): regulation, tax, title deed,
   credit, housing data → Radar → evidence bundle → ContentPackage.
B. **Evergreen expert content** (seam only): villa buying, land due
   diligence, zoning, Zekeriyaköy/Sarıyer expertise — future input is a
   topic + `businessProfile.ts`, not a news source; facts still need a
   fact-authority source.
C. **Social / market intelligence** (seam only): `DiscoveryLead`s for
   topics, recurring audience questions, formats and hooks — never facts.
   The ChatPlace seam (section I) feeds the same `audience_signals` idea.
