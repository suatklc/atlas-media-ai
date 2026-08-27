"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, ExternalLink, ImagePlus, RefreshCw } from "lucide-react";
import type { RankedContentOpportunity } from "@/lib/ai/research/retrieval/types";
import { describeFreshnessBand } from "@/lib/ai/research/freshnessBand";
import { describeContentType } from "@/lib/ai/research/contentTypeLabel";
import { recommendVisualFormat } from "@/lib/ai/research/formatRecommendation";
import { buildPublishableCaption, extractVisualHeadlineMarker, type CarouselStructure } from "@/lib/ai/creative/caption";
import { DEFAULT_PLATFORM } from "@/lib/ai/platform/config";

// Current Content Opportunities — the first user-facing surface for the
// live research backend (discoverCurrentContentOpportunities). This is a
// SECOND UI SURFACE, not a second content generator: content generation
// still goes exclusively through the existing /api/assistant route
// (ContentOpportunity -> buildSeedMessage -> buildContentPlan with its
// intent override -> the same Claude call AIAssistantPanel.tsx already
// uses), and visual generation still goes exclusively through the
// existing /api/generate-visual route (the same hero/educational renderer
// dispatch AIAssistantPanel.tsx already uses). Nothing here duplicates
// that logic — it only adds a second, opportunity-driven entry point into
// it, reusing creative/caption.ts's own marker/caption extraction exactly
// as AIAssistantPanel.tsx does.

type VisualFormatChoice = "single" | "carousel"; // future: | "video" — see formatRecommendation.ts

const FORMAT_CHOICES: { id: VisualFormatChoice; label: string }[] = [
  { id: "single", label: "Tek Görsel" },
  { id: "carousel", label: "Carousel" },
];

type GeneratedContent = {
  displayText: string;
  visualHeadline?: string;
  educationalPoints?: string[];
  carouselStructure?: CarouselStructure;
  assistantResponseText: string;
};

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

const FALLBACK_HEADLINE = "Gayrimenkul İçeriği";

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
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [visual, setVisual] = useState<GeneratedVisual | null>(null);

  async function handleFindOpportunities() {
    setIsSearching(true);
    setSearchError(null);
    setSelectedIndex(null);
    setGeneratedContent(null);
    setVisual(null);

    try {
      const response = await fetch("/api/research/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 5 }),
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
    setSelectedIndex(index);
    setFormatChoice(recommendVisualFormat(opportunities[index]));
    setGeneratedContent(null);
    setVisual(null);
    setGenerationError(null);
  }

  async function handleGenerateContent() {
    if (selectedIndex === null) return;
    // The opportunity itself travels through unmodified — its own
    // suggestedContentType (research-stage classification) is never
    // rewritten to fit a visual-format choice. The user's Tek Görsel/
    // Carousel choice instead travels as its own explicit field.
    const opportunity = opportunities[selectedIndex];

    setIsGenerating(true);
    setGenerationError(null);
    setGeneratedContent(null);
    setVisual(null);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentOpportunity: opportunity,
          visualFormat: formatChoice,
          platform: DEFAULT_PLATFORM,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      if (!fullText.trim()) {
        throw new Error("Yanıt alınamadı. Lütfen tekrar deneyin.");
      }

      const { visualHeadline, educationalPoints, carouselStructure } = extractVisualHeadlineMarker(fullText);
      const displayText = buildPublishableCaption(fullText);

      setGeneratedContent({
        displayText,
        visualHeadline,
        educationalPoints,
        carouselStructure,
        assistantResponseText: fullText,
      });
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "İçerik oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateVisual() {
    if (selectedIndex === null || !generatedContent) return;
    const opportunity = opportunities[selectedIndex];

    setVisual({ status: "loading" });

    try {
      const response = await fetch("/api/generate-visual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentOpportunity: opportunity,
          visualFormat: formatChoice,
          headline: generatedContent.visualHeadline || FALLBACK_HEADLINE,
          content: generatedContent.displayText,
          educationalPoints: generatedContent.educationalPoints,
          carouselStructure: generatedContent.carouselStructure,
          assistantResponseText: generatedContent.assistantResponseText,
          platform: DEFAULT_PLATFORM,
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

  return (
    <section className="animate-fade-up rounded-xl border border-indigo-500/20 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Güncel İçerik Fırsatları</p>
            <p className="text-xs text-zinc-500">Güvenilir kaynaklardan güncel gayrimenkul gelişmeleri</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleFindOpportunities}
          disabled={isSearching}
          className="flex items-center gap-1.5 rounded-full bg-indigo-500 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSearching ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Aranıyor…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Güncel Konuları Bul
            </>
          )}
        </button>
      </div>

      {searchError && (
        <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {searchError}
        </p>
      )}

      {!hasSearched && !isSearching && !searchError && (
        <p className="mt-4 text-sm text-zinc-500">
          Son 30 gün içindeki güvenilir kaynaklardan güncel gayrimenkul fırsatlarını bulmak için yukarıdaki butona
          tıklayın.
        </p>
      )}

      {hasSearched && !isSearching && opportunities.length === 0 && !searchError && (
        <p className="mt-4 text-sm text-zinc-500">
          Şu anda son 30 gün içinde yeterince güçlü güncel içerik bulunamadı.
        </p>
      )}

      {opportunities.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                className={`flex flex-col gap-2 rounded-lg border px-3.5 py-3 text-left transition-colors ${
                  isSelected
                    ? "border-indigo-500/60 bg-indigo-500/10"
                    : "border-zinc-800 bg-zinc-950 hover:border-indigo-500/40"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-zinc-400">{source?.publisher ?? "Kaynak"}</span>
                  <div className="flex items-center gap-1.5">
                    {source && <span className="text-[10px] text-zinc-600">{formatDate(source.publishedAt)}</span>}
                    {freshness && (
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        {freshness.label}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-sm font-medium leading-snug text-white">{opportunity.topic}</p>
                <p className="line-clamp-2 text-xs text-zinc-500">{opportunity.angle}</p>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium">
                  <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-300">
                    {opportunity.suggestedContentType
                      ? describeContentType(opportunity.suggestedContentType)
                      : describeContentType("none")}
                  </span>
                  <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-zinc-400">
                    Önerilen: {recommended === "carousel" ? "Carousel" : "Tek Görsel"}
                  </span>
                </div>

                {isSafeExternalUrl(source?.url) && (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="mt-1 inline-flex w-fit items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-indigo-300"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Kaynağı Görüntüle
                  </a>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedOpportunity && (
        <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-xs font-medium text-zinc-400">Seçilen fırsat</p>
          <p className="mt-1 text-sm font-medium text-white">{selectedOpportunity.topic}</p>
          {selectedOpportunity.riskCaveat && (
            <p className="mt-2 text-[11px] text-amber-400">{selectedOpportunity.riskCaveat}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500">İçerik formatı</span>
            <div className="flex overflow-hidden rounded-full border border-zinc-800">
              {FORMAT_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => setFormatChoice(choice.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
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
            className="mt-3 flex items-center gap-1.5 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-500/70 hover:bg-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                İçerik oluşturuluyor…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                İçerik Oluştur
              </>
            )}
          </button>

          {generationError && (
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {generationError}
            </p>
          )}

          {generatedContent && (
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3.5">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">Taslak İçerik</p>
              <p className="whitespace-pre-wrap text-xs text-zinc-300">{generatedContent.displayText}</p>

              {!visual && (
                <button
                  type="button"
                  onClick={handleGenerateVisual}
                  className="mt-3 flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
                >
                  <ImagePlus className="h-3.5 w-3.5 text-indigo-400" />
                  Görsel Oluştur
                </button>
              )}

              {visual?.status === "loading" && (
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-xs text-zinc-400">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" />
                  Görsel oluşturuluyor, bu işlem 60-90 saniye sürebilir…
                </div>
              )}

              {visual?.status === "error" && (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
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
                        <div key={slide.slide} className="overflow-hidden rounded-lg border border-zinc-800">
                          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic external Supabase Storage URL, same pattern as AIAssistantPanel.tsx */}
                          <img
                            src={slide.imageUrl}
                            alt={`Slayt ${slide.slide}`}
                            className="h-auto w-full object-contain"
                          />
                          <p className="bg-zinc-950 px-1.5 py-1 text-center text-[10px] text-zinc-500">
                            Slayt {slide.slide}/5
                          </p>
                        </div>
                      ))}
                  </div>
                  {visual.isConceptual && visual.disclaimer && (
                    <p className="mt-1 text-[11px] text-zinc-500">{visual.disclaimer}</p>
                  )}
                  <p className="mt-2 text-[11px] text-zinc-500">
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
                    <p className="mt-1 text-[11px] text-zinc-500">{visual.disclaimer}</p>
                  )}
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Bu içerik taslak olarak kaydedildi. Yayınlamak için aşağıdaki “Oluşturulan Gönderiler”
                    bölümünden onaylamanız gerekir.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
