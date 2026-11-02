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
- Publishing (currently: Instagram + Facebook Page live via Meta)

## Platform priority order

Instagram → Facebook → LinkedIn → WhatsApp → Google Business Profile →
(later) YouTube/video.

Target publishing channels for the static pipeline: Instagram + Facebook
+ LinkedIn + Google Business Profile.

## Current Content Radar — purpose (durable)

The Radar's job is not to find news that matches a keyword. It selects
current topics that are genuinely worth sharing with Suat Kılıç's
real-estate audience.

- Scope is the whole property field, never villas only: land, zoning
  (imar), construction/development (yapılaşma), title deed (tapu),
  homes/villas, rent, investment, market, and regional developments.
- General macroeconomics (rates, inflation, credit) is supporting
  material only, and only when it is meaningful for real estate.
- No impact or fact the source does not state is ever invented.
- Frozen systems are not changed without a proven reason.
- Nothing is published without explicit user approval.

## User experience principle

Simple input, Atlas handles the complexity — research, planning, copy,
visuals, and formatting are Atlas's job; the user picks, reviews, and
approves.

## Non-negotiable

No publishing without explicit user approval. See GUARDRAILS.md.

Do not store credentials or personal secrets in this file or any project
memory file.
