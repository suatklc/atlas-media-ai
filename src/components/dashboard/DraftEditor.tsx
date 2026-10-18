"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ContentPackage } from "@/lib/ai/content/contentPackage";

// Draft Edit (Real Use V1): Suat's text editor for an existing carousel
// DRAFT. Saving re-renders the five slides and updates the same draft row
// via /api/drafts/edit — it never approves or publishes (StatusAction's
// explicit "Onayla" stays the only way forward).

type SlideImage = { slide: number; imageUrl: string };
type SlideForm = { headline: string; body: string; facts: string; emphasis: string; cta: string };

const EXPERT_SLIDE_TITLES = ["Kapak", "Teşhis", "Asıl Mesele", "Ne Değişir?", "Kapanış / CTA"];
const NEWS_SLIDE_TITLES = ["Kapak", "Ne Oldu?", "Neden Önemli?", "Nelere Dikkat Etmeli?", "Kapanış"];

const fieldClass =
  "mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/60";

function toForm(pkg: ContentPackage): { slides: SlideForm[]; caption: string; hashtags: string } {
  return {
    slides: pkg.slides.map((slide) => ({
      headline: slide.headline,
      body: slide.body,
      facts: slide.facts.join("\n"),
      emphasis: slide.emphasis ?? "",
      cta: slide.cta ?? "",
    })),
    caption: pkg.caption,
    hashtags: pkg.hashtags.join(" "),
  };
}

function Field({
  label,
  hint,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block text-xs font-medium text-zinc-300">
      {label}
      {hint && <span className="ml-1 font-normal text-zinc-500">— {hint}</span>}
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} />
    </label>
  );
}

export default function DraftEditor({
  postId,
  contentPackage,
  images,
}: {
  postId: string;
  contentPackage: ContentPackage;
  images: SlideImage[];
}) {
  const router = useRouter();
  const isExpert = contentPackage.contentMode === "expert";
  const titles = isExpert ? EXPERT_SLIDE_TITLES : NEWS_SLIDE_TITLES;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => toForm(contentPackage));
  const [previews, setPreviews] = useState(images);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const setSlide = (index: number, key: keyof SlideForm, value: string) =>
    setForm((current) => ({
      ...current,
      slides: current.slides.map((slide, i) => (i === index ? { ...slide, [key]: value } : slide)),
    }));

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/drafts/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postId,
          caption: form.caption,
          hashtags: form.hashtags,
          slides: form.slides.map((slide) => ({
            headline: slide.headline,
            body: slide.body,
            facts: slide.facts.split("\n").map((line) => line.trim()).filter(Boolean),
            emphasis: slide.emphasis,
            cta: slide.cta,
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ kind: "error", text: data.error ?? "Kaydedilemedi. Lütfen tekrar deneyin." });
        return;
      }
      setPreviews(data.images);
      setForm(toForm(data.contentPackage));
      setMessage({ kind: "ok", text: "Kaydedildi ve görseller güncellendi. Gönderi taslak olarak kaldı." });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: "Bağlantı hatası. Lütfen tekrar deneyin." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 block w-full rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-indigo-500/40"
      >
        Düzenle
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-0 sm:p-6">
          <div className="w-full max-w-3xl rounded-none border border-zinc-800 bg-zinc-900 p-4 sm:rounded-xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-white">Taslağı Düzenle</h3>
                <p className="mt-1 text-xs text-zinc-400">
                  Kaydetmek gönderiyi onaylamaz veya paylaşmaz — taslak olarak kalır. Onay için kartta
                  &quot;Onayla&quot;yı ayrıca kullanın.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-600"
              >
                Kapat
              </button>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
              {previews.map((image) => (
                <a key={image.imageUrl} href={image.imageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element -- dynamic Supabase Storage URL */}
                  <img src={image.imageUrl} alt={`Slayt ${image.slide}`} className="h-40 w-32 rounded-md object-cover" />
                </a>
              ))}
            </div>

            <div className="mt-4 space-y-5">
              {form.slides.map((slide, index) => (
                <fieldset key={index} className="space-y-2 rounded-lg border border-zinc-800 p-3">
                  <legend className="px-1 text-xs font-semibold text-indigo-300">
                    Slayt {index + 1} · {titles[index]}
                  </legend>
                  <Field label="Başlık" value={slide.headline} onChange={(v) => setSlide(index, "headline", v)} />
                  {isExpert && (index === 0 || index === 4) && (
                    <Field
                      label="Altın vurgu"
                      hint="başlıktaki kısa ifade; boşsa son satır altın olur"
                      rows={1}
                      value={slide.emphasis}
                      onChange={(v) => setSlide(index, "emphasis", v)}
                    />
                  )}
                  {index === 3 && (
                    <Field
                      label="Maddeler"
                      hint="her satıra bir madde, en fazla 4"
                      rows={4}
                      value={slide.facts}
                      onChange={(v) => setSlide(index, "facts", v)}
                    />
                  )}
                  <Field
                    label={index === 0 ? "Destek metni" : index === 3 ? "Giriş metni" : "Metin"}
                    hint={index === 3 ? "maddeler boşsa slaytta bu metin görünür" : undefined}
                    rows={index === 0 ? 2 : 4}
                    value={slide.body}
                    onChange={(v) => setSlide(index, "body", v)}
                  />
                  {isExpert && index === 4 && (
                    <Field
                      label="CTA"
                      hint="isteğe bağlı; ayrı, çerçeveli satır olarak görünür"
                      rows={1}
                      value={slide.cta}
                      onChange={(v) => setSlide(index, "cta", v)}
                    />
                  )}
                </fieldset>
              ))}

              <Field
                label="Açıklama (caption)"
                rows={8}
                value={form.caption}
                onChange={(v) => setForm((current) => ({ ...current, caption: v }))}
              />
              <Field
                label="Hashtag'ler"
                hint="boşlukla ayırın"
                rows={2}
                value={form.hashtags}
                onChange={(v) => setForm((current) => ({ ...current, hashtags: v }))}
              />
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Görseller güncelleniyor…" : "Kaydet ve Görselleri Güncelle"}
              </button>
              {message && (
                <span className={`text-xs ${message.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{message.text}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
