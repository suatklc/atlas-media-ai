"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ExternalLink, ImagePlus, RefreshCw } from "lucide-react";
import type { RankedContentOpportunity } from "@/lib/ai/research/retrieval/types";
import { describeFreshnessBand } from "@/lib/ai/research/freshnessBand";
import { describeContentType } from "@/lib/ai/research/contentTypeLabel";
import { recommendVisualFormat } from "@/lib/ai/research/formatRecommendation";
import type { ContentPackage } from "@/lib/ai/content/contentPackage";

// Current Content Opportunities — the first user-facing surface for the
// live research backend (discoverCurrentContentOpportunities).
//
// Gold Standard V1: content generation now goes through the NEW, separate
// /api/content-package route (one structured OpenAI call, no hidden prose
// markers) instead of streaming through /api/assistant — that route and
// AIAssistantPanel.tsx's own free-form chat are untouched; this is a
// dedicated path specifically for Current Content Radar opportunities.
// Visual generation still goes through the existing /api/generate-visual
// route, which now has its own dedicated ContentPackage-driven carousel
// branch (see that route) alongside its untouched single-image path.

type VisualFormatChoice = "single" | "carousel"; // future: | "video" — see formatRecommendation.ts

const FORMAT_CHOICES: { id: VisualFormatChoice; label: string }[] = [
  { id: "single", label: "Tek Görsel" },
  { id: "carousel", label: "Carousel" },
];

type CarouselSlideImage = { slide: number; imageUrl: string };

type GeneratedVisual = {
  status: "loading" | "done" | "error";
  outputMode?: "single" | "carousel";
  imageUrl?: string;
  images?: CarouselSlideImage[];
  isConceptual?: boolean;
  disclaimer?: string | null;
  error?: string;
};

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

function isSafeExternalUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const SLIDE_ROLE_LABELS: Record<string, string> = {
  hook: "Kapak",
  "what-happened": "Ne Oldu?",
  "why-it-matters": "Neden Önemli?",
  "what-to-do": "Ne Yapmalı?",
  cta: "Kapanış",
};

export default function CurrentOpportunities() {
  const router = useRouter();

  const [opportunities, setOpportunities] = useState<RankedContentOpportunity[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [formatChoice, setFormatChoice] = useState<VisualFormatChoice>("single");

  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [contentPackage, setContentPackage] = useState<ContentPackage | null>(null);
  const [visual, setVisual] = useState<GeneratedVisual | null>(null);

  // "Instagram paylaşımı hazırla": the user's own instruction goes through
  // the same /api/content-package → /api/generate-visual → draft flow as a
  // Radar opportunity (expert content mode, always a 5-slide carousel).
  // activeInstruction is non-null while that flow — not a selected
  // opportunity — owns the package preview below.
  const [instruction, setInstruction] = useState("");
  const [activeInstruction, setActiveInstruction] = useState<string | null>(null);

  async function handleFindOpportunities() {
    setIsSearching(true);
    setSearchError(null);
    setSelectedIndex(null);
    setContentPackage(null);
    setVisual(null);

    try {
      // Research Breadth Expansion: 5 -> 10 (the route's own MAX_LIMIT,
      // unchanged) so a run that genuinely has 6-10 distinct, qualifying
      // opportunities can actually show all of them — discoverContent
      // OpportunitiesOptions.limit was always a ceiling, never a forced
      // count, so this never pads a thin result; rankContentOpportunities
      // still returns fewer when fewer genuinely qualify.
      const response = await fetch("/api/research/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10 }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Güncel içerik fırsatları alınamadı. Lütfen tekrar deneyin.");
      }

      setOpportunities(Array.isArray(data?.opportunities) ? data.opportunities : []);
      setHasSearched(true);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Güncel içerik fırsatları alınamadı. Lütfen tekrar deneyin.");
    } finally {
      setIsSearching(false);
    }
  }

  function handleSelect(index: number) {
    setActiveInstruction(null);
    setSelectedIndex(index);
    setFormatChoice(recommendVisualFormat(opportunities[index]));
    setContentPackage(null);
    setVisual(null);
    setGenerationError(null);
  }

  async function handleGenerateContent() {
    if (selectedIndex === null) return;
    // The opportunity itself travels through unmodified — its own
    // suggestedContentType (research-stage classification) is never
    // rewritten to fit a visual-format choice. The user's Tek Görsel/
    // Carousel choice instead travels as its own explicit, authoritative
    // field — /api/content-package never re-infers it from prose.
    const opportunity = opportunities[selectedIndex];

    setIsGenerating(true);
    setGenerationError(null);
    setContentPackage(null);
    setVisual(null);

    try {
      const response = await fetch("/api/content-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentOpportunity: opportunity,
          visualFormat: formatChoice,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.contentPackage) {
        throw new Error(data?.error || "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
      }

      setContentPackage(data.contentPackage as ContentPackage);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateFromInstruction() {
    const text = instruction.trim();
    if (text.length < 15) {
      setGenerationError("Lütfen paylaşımın konusunu ve hedef kitlesini birkaç cümleyle yazın.");
      setActiveInstruction(text);
      return;
    }

    setSelectedIndex(null);
    setActiveInstruction(text);
    setFormatChoice("carousel");
    setIsGenerating(true);
    setGenerationError(null);
    setContentPackage(null);
    setVisual(null);

    try {
      const response = await fetch("/api/content-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: text, visualFormat: "carousel" }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.contentPackage) {
        throw new Error(data?.error || "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
      }

      setContentPackage(data.contentPackage as ContentPackage);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateVisual() {
    if (!contentPackage) return;
    // Instruction flow: no opportunity exists — generate-visual takes the
    // instruction as its message; the package itself drives everything.
    const requestContext = activeInstruction
      ? { message: activeInstruction }
      : selectedIndex !== null
        ? { contentOpportunity: opportunities[selectedIndex] }
        : null;
    if (!requestContext) return;

    setVisual({ status: "loading" });

    try {
      const response = await fetch("/api/generate-visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestContext,
          visualFormat: formatChoice,
          contentPackage,
        }),
      });

      const data = await response.json().catch(() => null);
      const isCarousel = data?.outputMode === "carousel";
      const hasValidPayload = isCarousel
        ? Array.isArray(data?.images) && data.images.length > 0
        : typeof data?.imageUrl === "string";
      if (!response.ok || !hasValidPayload) {
        throw new Error(data?.error || "Görsel oluşturulamadı. Lütfen tekrar deneyin.");
      }

      setVisual({
        status: "done",
        outputMode: isCarousel ? "carousel" : "single",
        imageUrl: isCarousel ? undefined : data.imageUrl,
        images: isCarousel ? data.images : undefined,
        isConceptual: data.isConceptual,
        disclaimer: data.disclaimer,
      });

      // The new draft row now exists in generated_posts — GenerationHistory
      // is a Server Component that already fetched at last render, same
      // reason AIAssistantPanel.tsx calls this after its own visual step.
      router.refresh();
    } catch (err) {
      setVisual({
        status: "error",
        error: err instanceof Error ? err.message : "Görsel oluşturulamadı. Lütfen tekrar deneyin.",
      });
    }
  }

  const selectedOpportunity = selectedIndex !== null ? opportunities[selectedIndex] : null;
  // Empty state (pre-search guidance or "nothing found") is a single short
  // line — the same generous py-4 the populated grid/selected-opportunity
  // panel need reads as wasted space there. searchError and a non-empty
  // opportunities list both render real content, so only the true
  // empty-guidance case gets the tighter padding — populated cards are
  // never affected.
  const isEmptyGuidanceOnly = opportunities.length === 0 && !searchError;

  // Gold Standard V1: the complete package — source, hook, caption,
  // hashtags, and every slide's content — shown together, plain language
  // only, no raw JSON/markers/internal field names. Shared by the Radar
  // opportunity flow and the "Instagram paylaşımı hazırla" instruction flow.
  const packagePreview = contentPackage && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Taslak İçerik Paketi</p>
                <span className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400">
                  Taslak
                </span>
              </div>

              {contentPackage.source.name && (
                <p className="mt-2 text-xs text-zinc-500">
                  Kaynak: {contentPackage.source.name}
                  {contentPackage.source.publishedAt ? ` · ${formatDate(contentPackage.source.publishedAt)}` : ""}
                </p>
              )}

              <p className="mt-3 text-sm font-medium text-white">{contentPackage.hook}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{contentPackage.caption}</p>

              {contentPackage.hashtags.length > 0 && (
                <p className="mt-2 text-sm text-indigo-300">
                  {contentPackage.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ")}
                </p>
              )}

              {contentPackage.format === "carousel" && (
                <div className="mt-3 space-y-2">
                  {contentPackage.slides.map((slide) => (
                    <div key={slide.index} className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                        Slayt {slide.index} · {SLIDE_ROLE_LABELS[slide.role] ?? slide.role}
                      </p>
                      <p className="mt-1 text-sm font-medium text-white">{slide.headline}</p>
                      <p className="mt-1 text-sm text-zinc-400">{slide.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {!visual && (
                <button
                  type="button"
                  onClick={handleGenerateVisual}
                  className="mt-4 flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
                >
                  <ImagePlus className="h-4 w-4 text-indigo-400" />
                  Görsel Oluştur
                </button>
              )}

              {visual?.status === "loading" && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-400" />
                  Görsel oluşturuluyor, bu işlem 60-90 saniye sürebilir…
                </div>
              )}

              {visual?.status === "error" && (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
                  {visual.error}
                </p>
              )}

              {visual?.status === "done" && visual.outputMode === "carousel" && visual.images && (
                <div className="mt-3 w-full">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
                    {visual.images
                      .slice()
                      .sort((a, b) => a.slide - b.slide)
                      .map((slide) => (
                        <div key={slide.slide} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL, same pattern as AIAssistantPanel.tsx */}
                          <img
                            src={slide.imageUrl}
                            alt={`Slayt ${slide.slide}`}
                            className="aspect-[4/5] w-full object-cover"
                          />
                          <p className="px-1.5 py-1 text-center text-[11px] text-zinc-400">
                            Slayt {slide.slide}/5
                          </p>
                        </div>
                      ))}
                  </div>
                  {visual.isConceptual && visual.disclaimer && (
                    <p className="mt-1 text-xs text-zinc-500">{visual.disclaimer}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    Bu içerik taslak olarak kaydedildi. Yayınlamak için aşağıdaki “Oluşturulan Gönderiler”
                    bölümünden onaylamanız gerekir.
                  </p>
                </div>
              )}

              {visual?.status === "done" && visual.outputMode !== "carousel" && visual.imageUrl && (
                <div className="mt-3 w-full max-w-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL, same pattern as AIAssistantPanel.tsx */}
                  <img
                    src={visual.imageUrl}
                    alt="Oluşturulan gönderi"
                    className="h-auto w-full rounded-lg border border-zinc-800 object-contain"
                  />
                  {visual.isConceptual && visual.disclaimer && (
                    <p className="mt-1 text-xs text-zinc-500">{visual.disclaimer}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    Bu içerik taslak olarak kaydedildi. Yayınlamak için aşağıdaki “Oluşturulan Gönderiler”
                    bölümünden onaylamanız gerekir.
                  </p>
                </div>
              )}
            </div>
          );

  return (
    <section className="animate-fade-up rounded-xl border border-zinc-800 bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold text-white">Güncel İçerik Fırsatları</p>
            <p className="text-sm text-zinc-400">Güvenilir kaynaklardan güncel gayrimenkul gelişmeleri</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleFindOpportunities}
          disabled={isSearching}
          className="flex items-center gap-1.5 rounded-full bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSearching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Aranıyor…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Güncel Konuları Bul
            </>
          )}
        </button>
      </div>

      <div className={`space-y-4 px-5 ${isEmptyGuidanceOnly ? "py-3" : "py-4"}`}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <p className="text-sm font-medium text-white">Instagram paylaşımı hazırla</p>
        <p className="mt-1 text-sm text-zinc-400">
          Konuyu ve kime hitap edeceğini yazın; Atlas 5 slaytlık carousel, caption ve hashtagleri taslak olarak hazırlasın.
        </p>
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="Örn. Zekeriyaköy'de villasını satmayı düşünen mülk sahiplerine doğru fiyatlandırmanın önemini anlatan bir paylaşım hazırla."
          className="mt-3 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleGenerateFromInstruction}
          disabled={isGenerating}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-500/70 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating && activeInstruction !== null ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              İçerik oluşturuluyor…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Carousel Oluştur
            </>
          )}
        </button>
        {activeInstruction !== null && generationError && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
            {generationError}
          </p>
        )}
        {activeInstruction !== null && packagePreview}
      </div>

      {searchError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
          {searchError}
        </p>
      )}

      {!hasSearched && !isSearching && !searchError && (
        <p className="text-sm text-zinc-400">
          Son 30 gün içindeki güvenilir kaynaklardan güncel gayrimenkul fırsatlarını bulmak için yukarıdaki butona
          tıklayın.
        </p>
      )}

      {hasSearched && !isSearching && opportunities.length === 0 && !searchError && (
        <p className="text-sm text-zinc-400">
          Şu anda son 30 gün içinde yeterince güçlü güncel içerik bulunamadı.
        </p>
      )}

      {opportunities.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {opportunities.map((opportunity, index) => {
            const source = opportunity.sources[0];
            const freshness = source ? describeFreshnessBand(source.publishedAt, new Date()) : undefined;
            const recommended = recommendVisualFormat(opportunity);
            const isSelected = index === selectedIndex;

            return (
              <button
                key={`${source?.url ?? opportunity.topic}-${index}`}
                type="button"
                onClick={() => handleSelect(index)}
                className={`flex flex-col gap-2 rounded-lg border px-4 py-3.5 text-left transition-colors ${
                  isSelected
                    ? "border-indigo-500/60 bg-indigo-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-indigo-500/40"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-300">{source?.publisher ?? "Kaynak"}</span>
                  <div className="flex items-center gap-1.5">
                    {source && <span className="text-[11px] text-zinc-500">{formatDate(source.publishedAt)}</span>}
                    {freshness && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        {freshness.label}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-[15px] font-medium leading-snug text-white">{opportunity.topic}</p>
                <p className="line-clamp-2 text-sm text-zinc-400">{opportunity.angle}</p>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-medium">
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-indigo-300">
                    {opportunity.suggestedContentType
                      ? describeContentType(opportunity.suggestedContentType)
                      : describeContentType("none")}
                  </span>
                  <span className="rounded-full border border-zinc-800 px-2.5 py-1 text-zinc-400">
                    Önerilen: {recommended === "carousel" ? "Carousel" : "Tek Görsel"}
                  </span>
                </div>

                {isSafeExternalUrl(source?.url) && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-1 inline-flex w-fit items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-indigo-300"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Kaynağı Görüntüle
                  </a>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedOpportunity && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm font-medium text-zinc-400">Seçilen fırsat</p>
          <p className="mt-1 text-base font-medium text-white">{selectedOpportunity.topic}</p>
          {selectedOpportunity.riskCaveat && (
            <p className="mt-2 text-sm text-amber-400">{selectedOpportunity.riskCaveat}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-400">İçerik formatı</span>
            <div className="flex overflow-hidden rounded-full border border-zinc-800">
              {FORMAT_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setFormatChoice(choice.id)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    formatChoice === choice.id
                      ? "bg-indigo-500 text-white"
                      : "bg-zinc-950 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateContent}
            disabled={isGenerating}
            className="mt-3 flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2.5 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-500/70 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                İçerik oluşturuluyor…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                İçerik Oluştur
              </>
            )}
          </button>

          {generationError && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-300">
              {generationError}
            </p>
          )}

          {packagePreview}
        </div>
      )}
      </div>
    </section>
  );
}
