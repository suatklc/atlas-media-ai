# Atlas — Current State

This document reflects VERIFIED current state as of the commit below. It
changes often — keep it short and current, not a historical changelog
(see ARCHITECTURE.md/PRODUCT.md for durable structure/decisions).

**HEAD commit:** `8af1893307014b5fafa9dc891a3ca74382b4460f`

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
- Real 5-slide carousel generation (5 separate 1080×1350 PNGs, ContentIntent
  decoupled from visual format, no schema migration).
- Explicit approval → publish safety chain preserved throughout (Instagram
  live via Meta; nothing auto-publishes).

## Current known issues / limitations

- Carousel v1 is functionally real but **not yet visually frozen** —
  still needs one final visual-quality polish pass before being locked
  down the way Hero v1 is.
- Research source diversity: 4 live adapters now (TCMB, TKGM, Resmî
  Gazete, ÇŞİDB — Resmî Gazete's TLS blocker was fixed and it's
  registered; ÇŞİDB is new) — see ARCHITECTURE.md section B. TÜİK, BDDK,
  and Sarıyer Belediyesi remain unintegrated (no reliable per-item
  date/structure available). Real-world per-run opportunity count still
  varies with what these official sources actually published recently —
  quality/freshness rules mean a quiet period honestly returns fewer
  opportunities, not padded ones.
- 4 known pre-existing, unrelated test failures (confirmed non-regressing
  across the last several tasks — do not "fix" without investigating
  first, they're stale test mocks, not application bugs):
  - `tests/educational-headline-count.test.mjs` ×2 —
    `parseCanvasDimensions is not a function` (stale mock map).
  - `tests/output-mode.test.mjs` ×2 — `isContentOpportunity is not a
    function` (stale mock map, missing several real imports from an
    earlier refactor).
- Full test suite: 202/206 passing (the 4 above).

## Next work order (intentional — do not reorder without a genuine blocker)

1. Carousel final visual-quality polish.
2. Validate production carousel.
3. Freeze Carousel v1 (same status as Hero v1).
4. Video / Reels generation.
5. Then continue current-source diversification / platform expansion as
   prioritized at that time.
