# Atlas — Current State

This document reflects VERIFIED current state as of the commit below. It
changes often — keep it short and current, not a historical changelog
(see ARCHITECTURE.md/PRODUCT.md for durable structure/decisions).

**HEAD commit:** `edc61ea` (deployed to production 2026-11-09; this
file synced 2026-11-11)

## Snapshot

- **Frozen:** Static Content V1, Carousel V1, Current Content Radar V1
  (post-freeze targeted scope/source fixes below), Source-Grounding
  Safety V1, ContentPackage Gold Standard V1, Hero v1.
- **Publishing live in production:** Instagram + Facebook Page (Facebook
  Static Publishing V1). Approval never publishes; only the explicit
  "Seçili Platformlarda Yayınla" action does, per ticked platform. Real
  dashboard publishing to BOTH Instagram and Facebook was verified by
  Suat on 2026-11-09.
- **Telegram review (production):** /start, the generation-off reply,
  /taslaklar, the 5-slide preview and the platform buttons were verified
  live. NO real publish from Telegram has been tested yet (see
  "Automation + Telegram" below).
- **Production flags (last REPORTED by Suat, 2026-11-09 — not readable
  by the agent, Vercel stores them as Secret; treat as unverified):**
  `TELEGRAM_ACTIONS_ENABLED=false`, `TELEGRAM_REVIEW_ENABLED=true`,
  `AUTOMATION_ENABLED` last known off (scheduled automation disabled).
- **Target publishing channels:** Instagram + Facebook + LinkedIn +
  Google Business Profile. LinkedIn and Google Business have NO provider
  yet (`publishing/config.ts` — explicit "not yet configured" failure).
- **Radar:** real-estate scope gate active; `[radar-diag]` logs are
  TEMPORARY.
- **Video/Reels:** infrastructure only (no route, no UI, no paid run).

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
  + Facebook Page live via Meta; nothing auto-publishes).
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
- **STATIC CONTENT V1 = FROZEN** (commit `de33c7c`). The full static
  workflow — real source → grounded `ContentPackage` → 5-slide carousel
  → caption/hashtags → draft → explicit user approval → publishing
  eligibility — was verified end-to-end and is accepted as the frozen
  V1 baseline. Three real, live-observed gaps were found and closed in
  the course of this acceptance pass (in addition to everything already
  covered by Source-Grounding Safety V1 / ContentPackage Gold Standard
  V1 above):
  - **Gap 1 — Evidence Fragment Grounding** (`factContract.ts`'s
    `isEvidenceFragmentGrounded`/`filterCurrentTopicFacts`): Job 1's own
    `current-topic` classification was previously trusted without ever
    confirming its self-reported `evidenceFragment` is a genuine
    substring of the real evidence text — a hallucinated claim+fragment
    pair would have reached Job 2 as "verified" purely on the model's
    say-so. Now deterministically re-checked; fails closed (dropped) on
    any fragment that isn't a real quote.
  - **Gap 2 — Verified Token-to-Claim Binding** (`factContract.ts`'s
    `findTokenBindingViolations`/`trustedSourceDateTokens`, wired into
    `/api/content-package/route.ts`): a real production run showed Job 2
    combining a date verified under one fact with a different fact's
    subject inside one slide's `facts[]` string (a Genelge-continuation
    claim paired with an unrelated sale-transaction date neither fact
    stated together). Closed with a deterministic, digit-anchored check
    scoped to slide `facts[]` in verified mode only, including two
    follow-up false-positive fixes (date-format canonicalization
    DD.MM.YYYY/DD/MM/YYYY/ISO; trusting the primary source's own
    `publishedAt` to coexist with any verified token without requiring
    that exact pair to share a Job 1 fact) — confirmed via 5 real TKGM/
    DASK production runs with zero false rejections and zero
    unsupported bindings reaching output.
  - **Scenario Boundary Positional Rule** (`factContract.ts`'s
    `resolveScenarioBoundaryConflicts`): Job 1 occasionally classified a
    fact drawn from after a scenario-boundary connective
    ("bunlar dışındaki hâllerde ise...") as `current-topic` even though
    the source itself marks it as the opposite branch — confirmed
    non-deterministic (same source text, different classification
    across repeated real runs). A deterministic positional rule (the
    zone before the first boundary marker is always primary; a later-
    zone fact is demoted, never a vote) now runs after Gap 1, before
    Job 2 — verified it actively intervenes (5/9 facts demoted per real
    run) with zero scenario leakage across a second 5-run real batch.
  - **Carousel Final Quality** (`src/lib/ai/image/templates/
    carousel.ts`): rendering a real `ContentPackage` output through the
    actual production carousel exposed a content/layout mismatch — Job
    2 writes full editorial sentences, not the short punchy figures/
    phrases the `keyFact`/`considerations` treatments were tuned for,
    producing a truncated, broken-looking 72px "big number" fragment on
    slide 2, a 2-item checklist with huge dead gaps on slide 4, and a
    closing paragraph truncated mid-sentence on slide 5. Fixed entirely
    within `carousel.ts` (a `keyFact` over 60 chars falls back to body-
    only; checklist items get up to 3 lines with natural, centered row
    spacing; the closing line budget was raised; body text is now
    vertically centered, biased toward the top, within its label-to-
    logo zone). Verified against two independent real `ContentPackage`
    generations — all 10 resulting slides render complete, untruncated
    text with consistent branding.
  - **Hashtags-dropped-at-publish blocker**
    (`src/app/api/generate-visual/route.ts`'s `appendHashtagsToCaption`):
    the Gold Standard ContentPackage carousel branch persisted only
    `contentPackage.caption` as `generated_posts.content` — the exact
    field sent verbatim as the real Instagram caption on publish —
    never `contentPackage.hashtags`. Hashtags were shown in the
    dashboard preview but silently dropped at actual publish time, a
    real mismatch between what the user approves and what gets
    published. Fixed by appending hashtags to the persisted caption
    before the existing length cap — restoring the behavior the old
    marker-based pipeline already had (hashtags lived inline in its
    single raw caption string).
  - **Approval/publishing safety reconfirmed, not just preserved**:
    `generated_posts.status` defaults to `'draft'` at the DB level
    (`0002_generated_posts.sql`'s CHECK constraint allows only
    `draft`/`approved`/`posted`); `updatePostStatus` (dashboard/
    actions.ts) can only ever set `'approved'`, never `'posted'`
    directly; `publishGeneratedPost` independently re-checks
    `evaluatePublishEligibility` (status must already be `'approved'`,
    plus valid platform/caption/image/provider) and writes `'posted'`
    only after a real Meta publish call reports success. No code path
    in content generation or grounding can set `'approved'`/`'posted'`
    (confirmed by existing source-contract tests).
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
- Full test suite: 663/667 passing (only the 4 above fail) — last run
  2026-11-09 on the `edc61ea` changes, together with `tsc --noEmit`,
  ESLint and `next build` (all clean). Not re-run for this doc sync.
- **Uncertain publish has no UI to resolve.** A platform whose marker is
  `uncertain` (or a stale `publishing`) stays blocked everywhere until a
  person checks Meta and the marker is cleared directly in the database.
  (It is now VISIBLE read-only via `ops.post_publish_status`; clearing it
  still needs a privileged write.)
- **"Actual change lost before writing" — ROOT CAUSE FIXED (2026-10-17,
  second pass).** `factContract.ts`: Sentence-Anchored Citation (Job 1
  cites `[S<n>]` segments; a current-topic fact whose own quote fails
  Gap 1 may be rescued ONLY to the exact cited source span, ≤3
  contiguous ids, every claim token present in the span — Gap 1 then
  runs unchanged) + Source Change Markers (code-detected Turkish
  legislative amendment wording → Job 2 gets separate `NE DEĞİŞTİ —` /
  `ARKA PLAN —` sections). Verified live: Job 1 keeps 9–10 facts (was
  6–7), both real changes reach every run, novelty framing correct per
  the Editorial Quality Gate. Remaining gap is editorial craft only
  (gate FAIL on run-level language/repetition, ready 4–5/10) — see the
  open decision below.
- **Editorial Quality Repair — implemented, SHIPPED DISABLED
  (2026-10-17).** Suat approved one gate+revise call
  (`src/lib/ai/content/editorialRevision.ts`, wired at the end of
  `/api/content-package`): one attempt max, wording-level categories
  only, revision re-assembled and re-run through validation + Gap 2 + a
  no-new-fact-token guard, fail-safe fallback, outcome logged. Live
  result on the TKGM 2024/4 topic (6 runs, 4 independently gated):
  in-app gate FAILed and revision was accepted every time, but the
  independent Quality Gate stayed at ready 4–5/10 (same as without
  revision), and one revision widened a foreign-buyer rule to all buyers
  (a semantic scope change no deterministic guard catches). Hence
  `EDITORIAL_REVISION_ENABLED` defaults OFF = exact pre-revision
  pipeline. Remaining root cause for this topic is evidence-level: the
  2024/4 text never states the previous rule, while the same-event 2024/2
  announcement does ("Bu kez … herhangi bir …"); Radar's dedupe keeps
  only one source and `/api/content-package` reads only `sources[0]`.
- **First real publish attempt (2026-10-17) — NOT yet Gold Standard.**
  Today's only strong live topic: TKGM's 28.09.2026 update to Genelge
  2024/4 + 2024/2 (citizenship-by-property valuation reports may now be
  issued by any SPK-licensed valuation firm; 12-month TTB renewal). Six
  real runs through the production pipeline: all factually safe, none
  publishable — the actual "what changed" fact is lost because Job 1's
  evidenceFragment for it blends two source sentences (e.g.
  "Uygulamasına" vs the source's "Uygulanmasına") and Gap 1 correctly
  drops it, and the source's own amendment markers ("(İlgi (ı) Makam
  Oluru ile değişik ifade)") are not carried to Job 2, so long-standing
  rules get framed as new ("artık"). Root cause for the planned grounding
  audit — not to be prompt-patched. Real defects found and fixed in the
  same pass: TKGM card titles now arrive wrapped in raw HTML (stripped;
  official "Konu:" subject line used as snippet); "taşınmaz" missing from
  Radar vocabulary; every Turkey-midnight `publishedAt` rendered one day
  early (whyNow, Job 2 prompt, trusted date token, carousel source label
  on UTC servers); Job 1 `max_completion_tokens` 1200 truncated dense
  evidence (now 2400); token-binding false rejections for long-form dates
  ("29 Eylül 2026"), capitalized "Sayılı", spelled-out durations ("oniki
  ay"), and the source title's own document number.

- **SOURCE INTELLIGENCE (Radar V2 seam) — implemented 2026-10-17**
  (ARCHITECTURE.md §J/§K): Source Registry + trust roles, social seam,
  multi-source opportunities, per-source evidence bundle with provenance,
  internal-label leak guard. Verified live: Radar now delivers the TKGM
  29.09.2026 event as ONE opportunity with BOTH official sources (2024/4 +
  2024/2), each with full evidence. 3 real multi-source runs: the actual
  change ("SPK yetkili herhangi bir değerleme kuruluşu") and the audience
  (foreign buyers seeking citizenship) now reach the copy, but the
  independent Quality Gate still FAILs every run (ready 4/3/3) on
  writer-level errors that differ run to run (novelty language on
  background rules, an invented timing endpoint, a wrong change date, an
  internal "K1" label leak — now guarded —, repetition, TTB never
  explained). In those 3 runs Job 1 still classified the 2024/2 source's
  facts as "different-scenario" (0 grounded K2 facts); a bundle-aware
  Job 1 instruction was added but could NOT be live-verified: the OpenAI
  account ran out of credits (429) mid-test.
- **Recommendation (not implemented, needs Suat's decision):** replace/
  absorb the single-pass Job 2 writer with the Atlas Content Agent
  (Strategist skill + independent Quality Gate loop) as a PoC on the same
  grounded evidence bundle — see the final report of this task.

- **REAL USE V1 (2026-10-18):** Draft Edit — "Düzenle" on carousel drafts
  with a stored ContentPackage → `/api/drafts/edit` re-renders the 5
  slides from the draft's own base photo and updates the SAME row; never
  writes `status`, update filtered on `status='draft'`. Expert content now
  renders through `templates/premiumCarousel.ts` (Atlas Premium design
  system: Playfair headings, gold emphasis, larger logo); news keeps the
  frozen `carousel.ts` (byte-identical output verified). Canva premium
  layer NOT implemented — official Connect API path (OAuth+PKCE, Brand
  Template autofill, export) needs one-time setup Suat must do first:
  Canva Pro+ plan, a Developer Portal integration + client secret, and a
  5-page Brand Template with named data fields.

- **INSTAGRAM PUBLISHING — live in production** (`3270a70`, `0754562`):
  carousels publish as real carousels (all slides, in order, never
  cover-only), each Meta container waited on until `FINISHED`, Meta
  errors logged without tokens; the long-lived Instagram token is
  refreshed on use, reconnect only when needed. `status` goes
  `approved → posted` only after Meta confirms.
- **FACEBOOK STATIC PUBLISHING V1 — live in production** (`18914da`,
  `092d820`): Facebook Login for Business → Page selection (Page token in
  Vault, Instagram connection never touched) → non-public 5-image check
  must pass before multi-image publishing → explicit publish. Exactly
  slides 1..5 in order, one Page post; deterministic Facebook copy
  adapter (no model call, no new claims), editable in Draft Edit. Result
  in `metadata.publishResults.facebook`; `generated_posts.status` is
  never written by the Facebook path; a published result blocks
  duplicates, a failed one is retryable.
  - **One publish action for both:** "Seçili Platformlarda Yayınla"
    (`publishSelectedPlatforms.ts`) — nothing pre-selected, only ticked
    platforms, each once and independently, one outcome per platform.
    "Onayla" (approval) never publishes.
- **LinkedIn / Google Business — no provider yet.** Both are target
  channels; `publishing/config.ts` declares them with no `providerId`,
  and the router returns an explicit "not yet configured" failure.
- **CURRENT CONTENT RADAR — post-freeze targeted fixes** (`bd57d85`,
  `32c1c42`, `0641ed0`; retrieval/ranking/dedupe architecture unchanged):
  - Real-estate scope gate (`research/realEstateScope.ts`, see
    ARCHITECTURE.md §B): `property` / `macro` / `out`. Shortlist is built
    from property topics; at most one macro item (rate/inflation) from an
    official/primary source fills a short list; out-of-scope never
    enters. Whole property scope, never villa-only.
  - TKGM is no longer accepted unconditionally — needs a property signal;
    bayram/kutlama/admin noise is out; TKGM bypasses the router keyword
    filter so the scope gate decides.
  - Suffix-aware Turkish matching in `relevance.ts` ("yapı" stays exact);
    "yapılaşma" and "yapı denetim" added to the vocabulary/query;
    Resmî Gazete now fetch-first with the TLS fallback only on cert error.
  - Expert content ("Instagram paylaşımı hazırla") brief and cover are
    property-type-aware (konut/villa, arsa/arazi, imar/yatırım/inşaat,
    piyasa/bölgesel), never villa-locked.
  - **`[radar-diag]` logs are TEMPORARY** (`9afa0b2`, `11c5030`,
    `retrieval/diagnostics.ts` + adapters/router/discover/route):
    count-only, no secrets or article text, no behavior change. Added to
    find why production returns fewer property topics than local. Remove
    (revert those commits' logging) once diagnosed.
  - Production 0-result recovery (`809c133`): ÇŞİDB blocks US IPs and
    TKGM's linked PDFs are Turkey/EU-reachable only, so discover,
    content-plan and the cron route run in `fra1` (`vercel.json`
    `functions.regions` — route-level `preferredRegion` did not apply on
    the Hobby plan). Editorial gate tightened (`f7962fa`).
- **Weekly content plan + expert copy gate** (`84b6664`) and image model
  switch to `gpt-image-2.5-sunburst` (`273faf6`; `gpt-image-1` was shut
  down by OpenAI and failed in production). Failed visual generation keeps
  a "Tekrar Dene" action (`aabf53c`).

## Automation + Telegram (2026-11)

- **Automation V1** (`8f29ca8`, `031dcc0`, `e24a515`; migration
  `0004_automation.sql`): Vercel Cron `0 4 * * 1,2,4,6` (07:00 Turkey,
  Mon/Tue/Thu/Sat) → `/api/cron/daily-content` creates a DRAFT only
  (never approves/publishes), with in-app + Telegram notification. Runs
  only when `AUTOMATION_ENABLED === "true"` — last known OFF. The cron
  bundle needed the resvg wasm/fonts/logo (`next.config.ts`
  RENDER_ASSETS). A free compose-test mode (env
  `AUTOMATION_TEST_BASE_IMAGE_URL`, since removed) verified carousel +
  draft creation in production without paid generation; it left a
  "TEST — YAYINLAMAYIN" draft, which every Telegram list excludes.
- **Telegram review flow** (`c196e3c`, `edc61ea`; migration
  `0005_telegram_review.sql`, applied by Suat): webhook
  `/api/telegram/webhook` (secret header → 401 otherwise; verified 401
  for missing/wrong secret after the `edc61ea` deploy), one authorized
  private chat, update_id dedupe, `(state, revision)`-guarded job state
  machine, publishing only via the shared `publishToSelectedPlatforms`.
  Two separate permissions:
  - `TELEGRAM_ACTIONS_ENABLED` — AI generation: instructions, voice
    transcription, Düzelt/corrections. Off = no AI API call from Telegram.
  - `TELEGRAM_REVIEW_ENABLED` — `/taslaklar`, Onayla, Reddet, platform
    choice. Lists the user's real unpublished drafts (no TEST, rejected,
    posted or image-less drafts), previews the STORED slides + caption;
    no text/image/voice API call on this path.
  - Live-verified: /start, generation-off reply, /taslaklar, 5-slide
    preview, platform buttons. **Not verified: a real publish from
    Telegram.** The arsa (land) draft opened in that session was NOT
    published then; its current status is unknown — check before
    assuming.
- **Shared uncertain-publish lock** (`edc61ea`,
  `publishing/publishUncertainty.ts`, used by dashboard AND Telegram):
  Instagram and Facebook each write `metadata.publishResults.<platform>
  = publishing` right before the Meta call, then `published`/`failed`.
  A `publishing` marker younger than 5 min = "in progress"; older, or
  `uncertain` = outcome unknown → that platform is never re-sent
  automatically. A Meta-reported `failed` stays retryable. If the marker
  can't be written, Meta is not called.

## Agent tooling — installed vs planned (checked 2026-11-11)

- Installed: project skills `real-estate-content-strategist`,
  `atlas-editorial-quality-gate` (+ read-only subagent),
  `fact-source-grounding`, `atlas-ui-designer`, `find-skills`; user-level
  `higgsfield-generate` + `higgsfield` CLI (never run on Atlas — paid);
  claude.ai connectors Canva and Higgsfield reachable but unused for
  Atlas. Codex desktop app is installed with Atlas registered; Codex
  mirrors live in untracked `AGENTS.md`, `.agents/skills/`, `.codex/`.
- NOT installed: any hook, any project MCP (`.mcp.json` — no Supabase/
  Vercel/GitHub MCP), a Claude↔Codex bridge (no Codex MCP, no `codex` CLI
  on PATH), `gh` CLI. ElevenLabs and plugin connectors are unauthorized.
- Planned/proposed only: pre-commit/secret-guard hooks.

## Production read-only ops access (verified 2026-11-13)

- **What:** Postgres role `atlas_ops_reader` (migration
  `supabase/migrations/0006_ops_reader.sql`, applied by Suat) can read
  ONLY three views in schema `ops` (not exposed by the Data API), scoped
  to one Atlas user via `ops.reader_scope`:
  - `ops.post_publish_status` — post id/status/created_at, output mode,
    is_test, review_rejected, per-platform publish state + time + has-
    error, media/post-id-recorded booleans.
  - `ops.telegram_job_status` — job id, post id, state, revision,
    per-platform state, has_error, timestamps.
  - `ops.automation_run_status` — run id, kind (test/scheduled), run
    date, status, post id, has_error, timestamps.
  No content, captions, instructions, topics, image URLs, raw
  publish_results, error text, tokens, Vault, auth or connected accounts.
- **Verified:** admin check (`supabase/ops/0006_verify_admin.sql`, as
  postgres) — usable access is exactly the three views, SELECT only;
  `extensions.pg_stat_statements(_info)` carry object privileges via
  PUBLIC but their schema is closed (not usable). Reader check
  (`supabase/ops/0006_verify_reader.sql`, run as the role on 2026-11-13):
  25 PASS / 1 SKIP / 0 FAIL, ROLLBACK — base tables, auth, vault, storage,
  reader_scope, all four credential functions and every DDL probe
  denied; view writes have no privilege in metadata (Postgres reports
  55000 "not updatable" before the privilege check); SKIP =
  `public.profiles` does not exist in production (present in
  `0001_init.sql`, absent live — not investigated). Counts at that time:
  posts 40, telegram_jobs 1, automation_runs 2.
- **Known limits (not enforceable without changing PUBLIC):** the role
  can create TEMP objects in its own session, read system catalogs
  (object names, function source), and override its own session
  defaults (read-only, timeouts) — the GRANTs are the real boundary.
  Role LOGIN is enabled; connection limit 3.
- **How to use (local machine only):** psql 17.12 command-line tools
  (EDB, no server) at `C:\Program Files\PostgreSQL\17\bin\psql.exe`, not
  on PATH. The password exists only in `%APPDATA%\postgresql\pgpass.conf`
  (generated locally by `scripts/ops-reader-password.mjs`; only its SCRAM
  verifier was sent to Supabase). Run queries through
  `node scripts/ops-psql.mjs -c "<sql>"` or `-f <file.sql>` — it takes
  host/port/user from the pgpass entry, never prints them or the
  password, forces `sslmode=require` and `-w` (no prompt).
- **Kill switch / removal:** `alter role atlas_ops_reader nologin;`
  (immediate); full removal `supabase/ops/0006_rollback.sql`, then delete
  the pgpass line.

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
10. STATIC CONTENT V1 — COMPLETE and frozen (see above): grounding
    (Gap 1, Gap 2, Scenario Boundary Positional Rule), Carousel Final
    Quality, and the hashtags-at-publish blocker.
11. Canva Gold Standard PoC — not started (next, per CLAUDE.md's
    Current Development Order).
12. External publishing PoC (Buffer first candidate) — not started.
13. Video / Reels V1 — INFRASTRUCTURE ONLY: provider layer +
    `video/reelPlan.ts` implemented, nothing calls them, NOT yet live-tested
    (no paid generation run). fal.ai chosen over Higgsfield (already
    integrated; Higgsfield needs a new account/wallet/key/client for the
    same model families). `media/types.ts` gained one image-to-video job
    type; `media/config.ts` pins Seedance 1.5 Pro
    (`fal-ai/bytedance/seedance/v1.5/pro/image-to-video`, input schema
    verified against the installed client), two fixed tiers (test: 5s
    480p, final: 8s 1080p, audio off), conservative per-second cost
    estimates and a $1.50 per-request cap; `media/router.ts`'s
    `generateVideo` fails closed unless `VIDEO_GENERATION_ENABLED=true`.
    No API route/UI yet — next: one approved paid test clip, then wire a
    route that reuses `ContentOpportunity` → `ContentPlan` →
    `CreativeBrief` (per GUARDRAILS.md, no parallel planning layer).
14. Automation V1 + Telegram review — IMPLEMENTED and deployed (see
    "Automation + Telegram"). Remaining, each needing Suat's explicit
    go-ahead: (a) first real publish from Telegram on a real approved
    draft; (b) a way to resolve an `uncertain` publish marker after a
    manual Meta check; (c) re-enabling scheduled automation
    (`AUTOMATION_ENABLED`) and, separately, Telegram AI generation
    (`TELEGRAM_ACTIONS_ENABLED`); (d) remove the temporary `[radar-diag]`
    logs once diagnosed.
15. Production read-only ops access (`atlas_ops_reader`, migration 0006)
    — COMPLETE and verified 2026-11-13 (see "Production read-only ops
    access").
