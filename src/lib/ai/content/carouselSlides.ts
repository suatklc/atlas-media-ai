import type { ContentPackage } from "./contentPackage";
import type { CarouselSlideText } from "@/lib/ai/image/templates/carousel";
import type { PremiumCarouselText } from "@/lib/ai/image/templates/premiumCarousel";
import { formatTurkeyDateLong } from "@/lib/ai/research/retrieval/turkishDate";

// ContentPackage → on-slide text, shared by the two places that render a
// structured-package carousel: /api/generate-visual (first render) and
// /api/drafts/edit (re-render after Suat edits a draft). One mapping, so an
// edited draft can never render differently from a freshly generated one.

// Real Multi-Slide Carousel: slide 5's fixed micro-CTA — deterministic
// rather than model-generated, so the closing slide's final line is never
// at risk of an invented legal/procedural claim (see the grounding rules
// in research/opportunity.ts). News carousels only.
export const CAROUSEL_FIXED_CTA = "Detaylar İçin Mesaj Bırakın";

// Presentational-only: "publisher · 12 Ağustos 2026" subtle attribution
// shown on the carousel's "what happened" slide. A missing/unparseable
// date falls back to the publisher alone rather than showing an invalid
// one; returns undefined (no line at all) if the opportunity carried no
// source.
export function buildCarouselSourceLabel(source: { publisher: string; publishedAt: string } | undefined): string | undefined {
  if (!source) return undefined;
  // Turkey-local, never the server timezone: on Vercel (UTC) a Turkey-
  // midnight publishedAt formatted with toLocaleDateString printed the
  // previous day (see turkishDate.ts's toTurkeyCalendarDate).
  const formatted = formatTurkeyDateLong(source.publishedAt);
  if (!formatted) {
    return source.publisher;
  }
  return `${source.publisher} · ${formatted}`;
}

// Static Content V1 Freeze — genuine blocker fix: ContentPackage.hashtags
// is its own structured field. Persisting only contentPackage.caption as
// `content` — the exact field later sent verbatim as the real Instagram
// caption when an approved post is published — meant an approved post's
// hashtags were silently dropped at publish time. What the user approves
// is what actually gets published, nothing more.
export function appendHashtagsToCaption(caption: string, hashtags: string[]): string {
  if (hashtags.length === 0) return caption;
  const normalized = hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  return `${caption}\n\n${normalized}`;
}

// News (Radar) packages → the frozen Carousel V1 renderer's text.
export function buildNewsCarouselSlideText(contentPackage: ContentPackage): CarouselSlideText {
  const [hookSlide, whatHappenedSlide, whyItMattersSlide, whatToDoSlide, ctaSlide] = contentPackage.slides;
  return {
    cover: hookSlide.headline,
    whatHappened: whatHappenedSlide.body,
    keyFact: whatHappenedSlide.facts[0],
    whyItMatters: whyItMattersSlide.body,
    considerations: whatToDoSlide.facts.length > 0 ? whatToDoSlide.facts : [whatToDoSlide.body],
    closingLine: ctaSlide.body,
    fixedCta: CAROUSEL_FIXED_CTA,
    sourceLabel: buildCarouselSourceLabel({
      publisher: contentPackage.source.name,
      publishedAt: contentPackage.source.publishedAt,
    }),
  };
}

// Expert/portfolio packages → the Atlas Premium design system. Short role
// labels are fixed; every content field comes from the package (slide 1's
// body is the cover support line; slide 4's facts are the checklist). No
// source line and no fixed CTA — slide 5 carries the package's one CTA.
export const PREMIUM_SECTION_LABELS = {
  diagnosis: "Teşhis",
  insight: "Asıl Mesele",
  strategy: "Ne Değişir?",
  closing: "Benim Görüşüm",
} as const;

export function buildPremiumCarouselText(contentPackage: ContentPackage, region: string): PremiumCarouselText {
  const [hookSlide, diagnosisSlide, insightSlide, strategySlide, closingSlide] = contentPackage.slides;
  return {
    kicker: `${region} · Uzman Görüşü`,
    cover: { headline: hookSlide.headline, emphasis: hookSlide.emphasis, support: hookSlide.body },
    diagnosis: { label: PREMIUM_SECTION_LABELS.diagnosis, headline: diagnosisSlide.headline, body: diagnosisSlide.body },
    insight: { label: PREMIUM_SECTION_LABELS.insight, headline: insightSlide.headline, body: insightSlide.body },
    strategy: {
      label: PREMIUM_SECTION_LABELS.strategy,
      headline: strategySlide.headline,
      items: strategySlide.facts.length > 0 ? strategySlide.facts : [strategySlide.body],
    },
    closing: {
      label: PREMIUM_SECTION_LABELS.closing,
      headline: closingSlide.headline,
      emphasis: closingSlide.emphasis,
      body: closingSlide.body,
      cta: closingSlide.cta,
    },
  };
}
