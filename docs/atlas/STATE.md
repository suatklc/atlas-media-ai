# Atlas — Current State

This document reflects VERIFIED current state as of the commit below. It
changes often — keep it short and current, not a historical changelog
(see ARCHITECTURE.md/PRODUCT.md for durable structure/decisions).

**HEAD commit:** `3b5f958f6317149a793dca996a8bf1baa32fbdcd`

## Completed

- Vercel/GitHub deployment connection working.
- Hero visual v1 approved and frozen.
- Suat Kılıç brand identity integrated (no "Atlas AI" badge on
  client-facing visuals).
- Live research foundation: TCMB + TKGM adapters, 30-day freshness
  cutoff, topic-family diversification, recurring-series suppression.
- "Current Content Opportunities" dashboard — first user-facing live
  research workflow (find → select → generate content → generate visual
  → draft saved for approval).
- Explicit approval → publish safety chain preserved throughout (Instagram
  live via Meta; nothing auto-publishes).
- **CAROUSEL V1 = FROZEN** (final validation task, no code changes
  required — validation-only was the successful outcome). Frozen scope:
  `src/lib/ai/image/templates/carousel.ts` (5-slide renderer),
  `src/lib/ai/image/resvg-renderer.ts`'s `buildPannedCoverImageMarkup`
  (pan/zoom compositing), and the carousel branch of
  `src/app/api/generate-visual/route.ts`. Exactly 5 separate 1080×1350
  PNGs in fixed order (cover → what happened → why it matters →
  considerations → CTA/closing), one paid image-generation call reused
  across slides 1-4 via deterministic pan/zoom crops (max 1.2x zoom,
  clamped anchors), slide 5 a photo-free branded closing card. Validated
  by: the existing 22-test `tests/carousel.test.mjs` suite (including a
  real, non-mocked resvg-wasm render producing 5 genuine PNG buffers at
  the exact target dimensions) plus a fresh real render of all 5 slides
  through the actual production pipeline using the same long-Turkish
  stress-copy fixture the test suite already uses — visually inspected,
  zero clipping/overflow, brand mark and progress indicator pixel-
  consistent across all 5 slides, slide 5 intentionally distinct
  (solid navy + gold accent, no photo). Persistence confirmed by code
  review: slide 1 → `final_image_url` (thumbnail), all 5 URLs → the
  existing `metadata.carouselImages` jsonb column, no schema migration.
  Single Image path confirmed unaffected (separate branch in the same
  route, no shared code beyond `shared.ts`/`brand.ts`/
  `resvg-renderer.ts`'s common primitives, which Hero v1 also already
  depends on unmodified). Approval/publishing untouched — the carousel
  insert never sets `status`, no publish call exists anywhere in this
  path, and the dashboard preview explicitly tells the user the result
  is a draft pending approval. **Must not be reopened casually — only a
  real, reproduced production regression justifies revisiting this.**
- **CURRENT CONTENT RADAR V1 = FROZEN.** User-accepted via a real
  production acceptance test performed by the user directly in Atlas
  ("Güncel Konuları Bul") on commit `3b5f958f6317149a793dca996a8bf1baa32fbdcd`
  — 4 genuinely distinct, useful opportunities returned (TCMB inflation
  report, TKGM title-deed/TAKBİS topic, Dünya student rental-cost story,
  Dünya e-Devlet rental-contract story), with the earlier duplicate AA
  report of that same e-Devlet story correctly collapsed and the
  `&#039;`-style HTML entity defect fixed. Architecture: two logical
  discovery layers feeding the same existing ranking pipeline (retrieve →
  dedupe → build opportunities → diversified rank) —
  - **Layer 1 (fact/authority, unchanged):** TCMB, TKGM, Resmî Gazete,
    ÇŞİDB.
  - **Layer 2 (news/market attention, new this V1):** Anadolu Ajansı
    Economy RSS + Dünya RSS (`retrieval/providers/economyNews.ts`),
    relevance-filtered through a housing/property-scoped keyword set
    (`relevance.ts`'s `PROPERTY_MARKET_RELEVANCE_KEYWORDS`) so a bare
    economy/interest-rate story with no housing angle is excluded —
    Layer 2 is deliberately NOT a generic economy-news reader.
  - **Cross-source deterministic near-duplicate protection is active**
    in `discover.ts`: a Jaccard token-overlap check (with Turkish-
    suffix-tolerant stemming) plus a second, narrow allow-list
    "distinctive shared term" check (e.g. `e-devlet`, `sözleşme`,
    `takbis`, `ipotek`) for cases where two outlets report the same
    event in wording too different for the ratio check alone — both
    still gated by the existing 4-day publish-date window. No
    embeddings, no AI, no external service.
  - **RSS HTML entity normalization is active** in `economyNews.ts` —
    decodes standard named entities and numeric character references
    (decimal, zero-padded, and hex) before a title ever reaches the
    opportunity/UI layer.
  - **No new paid API or subscription was required for this V1** — both
    Layer 2 sources are public, unauthenticated RSS feeds.
  - The Anthropic web-search discovery experiment (`aiDiscovery.ts`/
    `grounding.ts`, `stash@{0}`) **remains paused and is explicitly NOT
    part of Current Content Radar V1** — do not conflate the two, and do
    not pop/apply/drop that stash as part of this freeze.
  - Google Trends, Pinterest/Pinterest Trends, "Bundle", and Bloomberg HT
    were investigated and deliberately **excluded from V1** (no reliable,
    ToS-safe, zero/low-cost integration path found, or — for Bloomberg HT
    — simply not needed yet) — **do not add any of them unless future
    real usage demonstrates an actual need**, not preemptively.
  - **5–10 opportunities is a target range when enough strong material
    exists, NOT a quota** — 4 genuinely distinct, high-quality
    opportunities is an accepted, correct outcome on a normal day.
    Quality and diversity always take priority over hitting a count.
  - **Must not be reopened casually** — only (a) a real, reproduced
    production regression, or (b) future real usage demonstrating a
    material product limitation justifies revisiting this.
- **SOURCE-GROUNDING SAFETY V1 = FROZEN.** User-accepted via a real live
  production retest: the exact TKGM opportunity that previously produced
  unsupported claims ("Satış İşlemlerinde Zorunlu Deprem Sigortası
  Hakkında Duyuru") was re-run through the current production
  `ContentPackage` pipeline and PASSED. Scope:
  `src/lib/ai/research/retrieval/evidenceExtraction.ts` (evidence
  capture + `classifyEvidenceSufficiency`), `src/lib/ai/content/
  contentPackage.ts` (calendar-date component-fact rejection), and
  `src/app/api/content-package/route.ts` (the evidence boundary/prompt).
  - Every `ResearchSource` may carry a genuinely extracted `evidenceText`
    (never the title/URL/publisher, never fabricated); its absence is
    preserved, not papered over.
  - **Evidence presence != evidence sufficiency.** A deterministic,
    non-AI classifier (`classifyEvidenceSufficiency`) labels evidence
    `meaningful` / `thin` / `none` — text dominated by page-navigation/
    stub markers (e.g. "click here to access the file") or under ~150
    chars is conservatively `thin`, never promoted to `meaningful`.
    `thin` gets the identical strict no-invention instruction as `none`.
  - Confirmed by the live retest: thin evidence no longer yields
    unsupported effective dates, mandatory-document requirements, or
    transaction-blocking consequences; a source's publication date is
    never presented/treated as a rule's effective/start date; a calendar
    date is never decomposed into separate arithmetic `ContentFact`
    "component" entries (deterministically rejected if it ever recurs).
  - Current Content Radar's retrieval/ranking/dedupe architecture is
    unchanged — this was a generation-time + capture-time safety fix
    layered on top of it, not a Radar redesign.
  - **Known, deliberately deferred limitation:** TKGM's own detail pages
    are frequently thin stubs pointing to a linked announcement file
    (often a PDF) that Atlas does not fetch — real evidence for those
    topics stays `thin` by design until that linked-file extraction is
    investigated as its own, separately-scoped task.
  - **Must not be reopened casually — only a proven correctness blocker
    justifies revisiting this**, same convention as Carousel V1/Current
    Content Radar V1 above.
- **CONTENTPACKAGE GOLD STANDARD V1 = FROZEN.** User-accepted via a real
  live production acceptance test on the same TKGM/DASK opportunity that
  drove Source-Grounding Safety V1 above — Factual Safety PASS, Context
  Safety PASS, validation PASS, no forced-locality hashtag, and every
  strict editorial threshold (expert interpretation, anti-repetition,
  language quality, publish-readiness, overall) scored 8+/10 with no
  manual editing required. Builds on Source-Grounding Safety V1, not a
  replacement for it:
  - **TKGM linked-file evidence extraction** (the deferred limitation
    noted above) is now implemented: `tkgm.ts` discovers and fetches the
    real linked PDF behind each thin detail-page stub
    (`evidenceExtraction.ts`'s `extractPdfTextOrUndefined`, via `unpdf`
    — the one new dependency this required, verified native-binary-free
    and Vercel-safe), so genuine TKGM evidence can now reach
    `meaningful` instead of staying `thin`.
  - **Verified Fact Contract** (`src/lib/ai/content/factContract.ts`):
    a second, narrow, non-editorial AI call (Job 1, stays on
    `AI_TEXT_MODEL`/`gpt-4.1-mini`) classifies every evidence claim as
    current-topic / different-scenario / unsupported; code
    deterministically keeps ONLY current-topic facts before the
    editorial ContentPackage call (Job 2) ever runs — the actual fix for
    a proven, repeated cross-scenario context-leakage defect (a real
    fact from an unrelated clause of the same source document being
    applied to the wrong topic).
  - **Job 2 (editorial generation) now runs on `gpt-5.4`**
    (`CONTENT_PACKAGE_EDITORIAL_MODEL` in `client.ts`), scoped to this
    ONE call only — Job 1 and `/api/assistant`'s general chat stay on
    `gpt-4.1-mini`. A controlled, same-Fact-Contract benchmark against
    `gpt-4.1-mini` and `gpt-5-mini` showed `gpt-5.4` the only candidate
    that improved expert interpretation/anti-repetition/language quality
    without a factual-safety regression.
  - **Deterministic output normalization**, all in
    `src/lib/ai/content/contentPackage.ts` / `src/app/api/content-
    package/route.ts`: a calendar date can never survive as decomposed
    `role="component"` facts (single or compound units, e.g. "ay-gün");
    the caption's signature is canonicalized (not just whitespace-
    patched) to the exact two-line form; a locality hashtag (e.g.
    `#Sarıyer`) is removed unless that locality genuinely appears in the
    topic or verified facts — all applied before the existing validator,
    which remains the unweakened final backstop.
  - **Must not be reopened casually** — only a proven correctness
    blocker justifies revisiting this, same convention as every other
    V1 freeze above.

## Current known issues / limitations

- Research source diversity: 5 live adapters now (Layer 1: TCMB, TKGM,
  Resmî Gazete, ÇŞİDB; Layer 2: AA Economy + Dünya RSS) — see
  ARCHITECTURE.md section B and the Current Content Radar V1 entry above.
  TÜİK, BDDK, and Sarıyer Belediyesi remain unintegrated (no reliable
  per-item date/structure available). Real-world per-run opportunity
  count still varies with what these sources actually published recently
  — quality/freshness rules mean a quiet period honestly returns fewer
  opportunities, not padded ones.
- A separate, uncommitted "Current Topic Discovery v1" AI web-search
  discovery layer (`aiDiscovery.ts`/`grounding.ts`) still exists ONLY in
  `stash@{0}` — intentionally NOT merged, live-tested and functionally
  working but paused pending a cost/provider decision. Explicitly not
  part of Current Content Radar V1 (see above) — do not conflate the two,
  do not pop/apply/drop the stash.
- 4 known pre-existing, unrelated test failures (confirmed non-regressing
  across the last several tasks — do not "fix" without investigating
  first, they're stale test mocks, not application bugs):
  - `tests/educational-headline-count.test.mjs` ×2 —
    `parseCanvasDimensions is not a function` (stale mock map).
  - `tests/output-mode.test.mjs` ×2 — `isContentOpportunity is not a
    function` (stale mock map, missing several real imports from an
    earlier refactor).
- Full test suite: 230/234 passing (the 4 above).

## Next work order (intentional — do not reorder without a genuine blocker)

1. Claude Code persistent project memory — COMPLETE.
2. Final Carousel quality validation — COMPLETE.
3. Freeze Carousel V1 — COMPLETE (see above).
4. Live domain + responsive mobile/PWA usage — COMPLETE (audited, no
   code changes required; verified reachable/healthy on the live Vercel
   production URL, including from a phone).
5. Real usage test — COMPLETE for Current Content Radar V1 (see above);
   Carousel/Hero already covered by their own freezes.
6. Gold Standard V1 (`ContentPackage` pipeline, `/api/content-package`)
   — COMPLETE and user-accepted.
7. Source-Grounding Safety V1 — COMPLETE (see above).
8. TKGM linked-file evidence extraction — COMPLETE (see ContentPackage
   Gold Standard V1 above; folded into that freeze rather than staying
   a separate task).
9. ContentPackage Gold Standard V1 (Verified Fact Contract, Job 2 model
   upgrade, deterministic output normalization) — COMPLETE and
   user-accepted (see above).
10. Canva Gold Standard PoC — not started (next).
11. External publishing PoC (Buffer first candidate) — not started.
12. Video / Reels generation — not started.
