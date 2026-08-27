# Atlas Product Principle

One Idea → Atlas → Everywhere.

Atlas is a multi-platform AI content system. First strong use case: real
estate. The architecture must remain adaptable to other industries — do
not hard-code real-estate or single-business assumptions into shared code.

Primary current platforms: Instagram, Facebook, LinkedIn, WhatsApp, Google
Business Profile — later YouTube/video.

Instagram is the current visual-quality reference, but shared architecture
must NOT become Instagram-specific.

# Critical Publishing Rule

Atlas must NEVER publish content without explicit user approval.

Generation != approval. Approval != automatic publishing unless the user
explicitly triggers publish. Never add autonomous publishing as a side
effect of generation or research.

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

Current approved Hero visual v1 (`src/lib/ai/image/templates/hero.ts`) is
frozen. Do not modify hero visual design unless explicitly requested.

Current Suat Kılıç brand identity (`src/lib/ai/image/templates/brand.ts`)
is approved. Do not redesign the logo/brand unless explicitly requested.

Research/source freshness rules and the approval/publishing safety chain
must not be casually changed.

# Memory Imports

Use @docs/atlas/PRODUCT.md
Use @docs/atlas/ARCHITECTURE.md
Use @docs/atlas/STATE.md
Use @docs/atlas/GUARDRAILS.md

Do not duplicate their full contents inside this file.
