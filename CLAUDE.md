# Atlas Product Principle

One Idea → Atlas → Everywhere.

Atlas is a multi-platform AI content system. First strong use case: real
estate. The architecture must remain adaptable to other industries — do
not hard-code real-estate or single-business assumptions into shared code
(business-specific facts like geography/industry live only in
`src/lib/ai/context/businessProfile.ts`).

Primary current platforms: Instagram, Facebook, LinkedIn, WhatsApp, Google
Business Profile — later YouTube/video.

Instagram is the current visual-quality reference, but shared architecture
must NOT become Instagram-specific.

# Core Pipeline (high level — see ARCHITECTURE.md for detail)

topic/source (Current Content Radar, frozen) → structured `ContentPackage`
(`src/lib/ai/content/contentPackage.ts`, produced by ONE OpenAI call via
`POST /api/content-package`, deterministic format — carousel is always
exactly 5 slides, single is always exactly 1, never model-decided) →
visual/carousel render → caption/hashtags → draft → explicit user
approval → explicit publish.

# Critical Publishing Rule

Atlas must NEVER publish content without explicit user approval.

Generation != approval. Approval != automatic publishing unless the user
explicitly triggers publish. Never add autonomous publishing as a side
effect of generation or research. Lifecycle: `Draft → Approved →
Publish → Published`.

# Gold Standard Definition

Technical success (schema valid, tests pass, build succeeds) is not
product success. The only acceptance criterion that matters:

> Would Suat publish this on his real professional account without
> editing it elsewhere first?

If the answer is no, the output is not Gold Standard — regardless of how
clean the implementation is. Never declare a Gold Standard task "complete"
or "frozen" on implementation success alone; that status is earned only
by a real production acceptance test the user performs.

# Build vs. Integrate Philosophy

Atlas is becoming an orchestrator, not a system that rebuilds every
capability from scratch: **best tools + Atlas orchestration**. Prefer
integrating a proven external tool over custom-engineering a capability
when it clearly wins on quality, speed, reliability, or maintainability.

But:
- never replace a working Atlas system before the replacement is proven
  (PoC first, swap only after it clearly beats the current system),
- avoid vendor duplication and speculative architecture,
- avoid unnecessary new dependencies.

# Current Development Order

1. Claude project intelligence (this layer)
2. Source-grounding architecture audit
3. Canva Gold Standard PoC
4. Canva integration — only if PoC clearly beats current renderer
5. External publishing PoC (Buffer first candidate)
6. Real production acceptance test
7. ChatPlace evaluation (Instagram leads/DM/growth)
8. Freeze accepted static pipeline
9. Video/Reels
10. Automation/orchestration (e.g. n8n)

Do not jump ahead in this order unless a genuine blocker requires it.

# Known Open Risk — Source Grounding

Unresolved: it has not yet been proven that every precise factual claim
(dates, transaction requirements, amounts, etc.) produced by
`Current Content Radar → ContentPackage` is actually traceable to the
source evidence passed through. Every ContentPackage must keep SOURCE
FACT and EXPERT INTERPRETATION distinct. Do not "fix" this by patching
prompts reactively — the next real pass on it must be a root-cause audit
of the grounding architecture, not another prompt patch. See the
`fact-source-grounding` skill for the guardrail rules that apply now.

# Development Philosophy

- Prefer the smallest coherent change.
- Inspect the current implementation before editing — use repository
  state as source of truth, not memory of past sessions.
- Preserve working systems; do not opportunistically refactor unrelated
  code.
- Do not add dependencies without clear need.
- Do not fabricate test success.
- Distinguish pre-existing failures from new regressions.
- Run appropriate TypeScript / ESLint / tests / build before commit.
- Commit/push only after scoped validation succeeds, unless the task says
  otherwise.

# Frozen / Stable Areas

Current Content Radar V1 (`src/lib/ai/research/**`) is frozen — do not
redesign its retrieval/ranking architecture casually.

Current approved Hero visual v1 (`src/lib/ai/image/templates/hero.ts`) is
frozen. Do not modify hero visual design unless explicitly requested.

Current Suat Kılıç brand identity (`src/lib/ai/image/templates/brand.ts`,
`public/brand/suat-kilic-logo.png`) is approved — real logo only, never
AI-generated/placeholder. Do not redesign the logo/brand unless
explicitly requested.

Research/source freshness rules and the approval/publishing safety chain
must not be casually changed.

# Memory Imports

Use @docs/atlas/PRODUCT.md
Use @docs/atlas/ARCHITECTURE.md
Use @docs/atlas/STATE.md
Use @docs/atlas/GUARDRAILS.md

Do not duplicate their full contents inside this file.
