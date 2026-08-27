# Atlas — Product Memory

## Core idea

One Idea → Atlas → Everywhere. A user describes one idea or lets Atlas
find a current opportunity; Atlas turns it into platform-adapted content
across every connected channel.

## Direction

- Web app now, responsive/PWA-oriented; no native app today.
- Industry-adaptable SaaS architecture — real estate is the first strong
  vertical, not the only intended one. Business-specific context (today:
  Zekeriyaköy/Sarıyer, a real-estate profile) lives in a configuration
  layer (`src/lib/ai/context/businessProfile.ts`), not hard-coded into
  shared pipeline code.

## Content goals (in scope, at various stages of completion)

- Current/reliable research (live source retrieval → content opportunity)
- Content generation (Claude-driven caption/copy)
- Single-image visuals
- Real multi-slide carousels
- Future: video/Reels
- Platform adaptation (same idea, correct shape per platform)
- Explicit user approval before anything is published
- Publishing (currently: Instagram live via Meta)

## Platform priority order

Instagram → Facebook → LinkedIn → WhatsApp → Google Business Profile →
(later) YouTube/video.

## User experience principle

Simple input, Atlas handles the complexity — research, planning, copy,
visuals, and formatting are Atlas's job; the user picks, reviews, and
approves.

## Non-negotiable

No publishing without explicit user approval. See GUARDRAILS.md.

Do not store credentials or personal secrets in this file or any project
memory file.
