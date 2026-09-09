import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAITextClient, AI_TEXT_MODEL } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { isContentOpportunity, buildResearchDirective } from "@/lib/ai/research/opportunity";
import { isVisualFormat } from "@/lib/ai/research/formatRecommendation";
import {
  CAROUSEL_SLIDE_ROLES,
  validateContentPackage,
  type ContentPackage,
  type ContentSlide,
} from "@/lib/ai/content/contentPackage";

// Gold Standard V1 — the structured generation path for Current Content
// Radar opportunities. Deliberately separate from /api/assistant (which
// stays untouched for general free-form chat): this route has one job —
// turn a ContentOpportunity + the user's own already-made format choice
// into ONE complete, structured ContentPackage, in ONE OpenAI call, with
// zero hidden prose markers. See docs/atlas/STATE.md / this task's own
// report for why the old marker-based contract was replaced.

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Deliberately NOT asked of the model — see contentPackage.ts and the
// Gold Standard brief's own "format must be deterministic" rule: format
// and the exact slide index/role sequence are fixed by the caller's own
// already-made choice, then stamped onto the model's output afterward.
// The model only ever supplies content FOR the given structure, never a
// re-decision of what that structure is.
type ModelSlide = { headline: string; body: string; facts: string[]; visualBrief: string };
type ModelFact = { label: string; value: number; unit: string; role: "component" | "total" | "standalone" };
type ModelPackage = {
  topic: string;
  source: { name: string; url: string; publishedAt: string };
  hook: string;
  caption: string;
  hashtags: string[];
  slides: ModelSlide[];
  facts: ModelFact[];
};

const SLIDE_SCHEMA = {
  type: "object" as const,
  properties: {
    headline: { type: "string" },
    body: { type: "string" },
    facts: { type: "array", items: { type: "string" } },
    visualBrief: { type: "string" },
  },
  required: ["headline", "body", "facts", "visualBrief"],
  additionalProperties: false,
};

const FACT_SCHEMA = {
  type: "object" as const,
  properties: {
    label: { type: "string" },
    value: { type: "number" },
    unit: { type: "string" },
    role: { type: "string", enum: ["component", "total", "standalone"] },
  },
  required: ["label", "value", "unit", "role"],
  additionalProperties: false,
};

const CONTENT_PACKAGE_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    topic: { type: "string" },
    source: {
      type: "object",
      properties: {
        name: { type: "string" },
        url: { type: "string" },
        publishedAt: { type: "string" },
      },
      required: ["name", "url", "publishedAt"],
      additionalProperties: false,
    },
    hook: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    slides: { type: "array", items: SLIDE_SCHEMA },
    facts: { type: "array", items: FACT_SCHEMA },
  },
  required: ["topic", "source", "hook", "caption", "hashtags", "slides", "facts"],
  additionalProperties: false,
};

const CAROUSEL_SLIDE_ROLE_BRIEF: Record<string, string> = {
  hook: "Slayt 1 (kapak/dikkat çekici): güçlü ama olgusal bir başlık, tek net mesaj; uzun paragraf yok.",
  "what-happened": "Slayt 2 (ne oldu): kaynağın bildirdiği gelişme + önemli sayı/olgu; kısa ve editoryal.",
  "why-it-matters": "Slayt 3 (neden önemli): alıcı/satıcı/kiracı/yatırımcı için gerçek anlamı; desteklenmeyen nedensel iddia yok.",
  "what-to-do": "Slayt 4 (ne yapmalı): pratik kontrol listesi — neye bakılmalı, ne karşılaştırılmalı, ne sorulmalı.",
  cta: "Slayt 5 (kapanış/CTA): kısa çıkarım + ölçülü bir eylem çağrısı.",
};

function buildContentPackagePrompt(maxAgeContextDays: number): string {
  return `Görsel Marka: Suat Kılıç, Gayrimenkul Yatırım Danışmanı.

Görev: Verilen güncel fırsat için TEK bir yapılandırılmış içerik paketi üret. Serbest metin/gizli işaret ([[...]]) YOK — yalnızca istenen JSON alanlarını doldur.

Kural — OLGU / YORUM AYRIMI:
- ContentSlide.facts ve ContentPackage.facts alanları SADECE kaynağın gerçekten belirttiği sayısal/olgusal bilgileri içersin.
- Kaynak yalnızca yaklaşık/toplam bir rakam veriyorsa (örn. "yaklaşık 150.000 TL"), bunu role="standalone" veya role="total" olarak ver; ASLA var olmayan bir kalem dökümü (depozito+kira+komisyon gibi) icat etme. role="component" SADECE kaynağın kendisi ayrı kalemleri açıkça verdiğinde kullanılsın.
- caption ve her slaytın body/headline metninde geçen HER belirgin sayı, facts dizisinde veya başka bir slaytta da yer almalı — icat edilmiş/çelişen bir sayı olmamalı.
- Kaynağın açıkça belirtmediği hiçbir nedensel bağlantı kurma (örn. "pandemi sonrası hareketlilik", "ekonomik dalgalanmalar" gibi genel/kanıtsız gerekçeler ekleme) — kanıt yoksa ihtiyatlı ve dar kapsamlı yaz.
- Son ${maxAgeContextDays} gün içindeki güncelliği doğal biçimde yansıt; tarihleri koru.

Slayt içerikleri (yalnızca headline/body/facts/visualBrief doldur — sıra ve rol SENİN kararın DEĞİL, sistem tarafından sabittir):
${Object.values(CAROUSEL_SLIDE_ROLE_BRIEF).join("\n")}
visualBrief: SADECE görsel KONSEPT (örn. "modern İstanbul konut binası, akşam ışığı, editoryal fotoğraf") — asla ekranda yazı/metin isteme, asla marka/logo tarif etme.

Caption yapısı (ContentPackage.caption, tek metin):
HOOK (kısa) → GAYRİMENKUL YORUMU (pratik anlam, 2-4 kısa paragraf) → EYLEM ÇAĞRISI → İMZA:
Suat Kılıç
Gayrimenkul Yatırım Danışmanı
Caption, slaytların birebir tekrarı olmasın; doğal şekilde genişletsin.

hashtags: konuya özgü, jenerik hashtag spam'i değil; genel "#emlak #gayrimenkul" gibi tekrar eden kalıpları tek başına yeterli sayma, konuya özgü terimler ekle.

topic: fırsatın kısa özeti. hook: caption'ın da kullanacağı kısa, güçlü açılış cümlesi. source: verilen fırsatın kaynak adı/URL/yayım tarihi, DEĞİŞTİRMEDEN.`;
}

function buildUserMessage(opportunity: {
  topic: string;
  angle: string;
  whyNow: string;
  keyFacts: string[];
  sources: { title: string; publisher: string; url: string; publishedAt: string }[];
}): string {
  const source = opportunity.sources[0];
  const lines = [
    `Konu: ${opportunity.topic}`,
    `Atlas açısı (yorum, olgu değil): ${opportunity.angle}`,
    `Güncellik nedeni: ${opportunity.whyNow}`,
    `Kaynağın bildirdiği olgular: ${opportunity.keyFacts.join("; ")}`,
  ];
  if (source) {
    lines.push(`Kaynak: ${source.publisher} — ${source.url} — ${source.publishedAt}`);
  }
  lines.push("Bu bilgilere dayanarak ContentPackage'ı üret.");
  return lines.join("\n");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonError("Geçersiz istek gövdesi.", 400);
  }

  const { contentOpportunity: rawContentOpportunity, visualFormat: rawVisualFormat } = body as {
    contentOpportunity?: unknown;
    visualFormat?: unknown;
  };

  if (!isContentOpportunity(rawContentOpportunity)) {
    return jsonError("Geçerli bir içerik fırsatı gerekli.", 400);
  }
  const contentOpportunity = rawContentOpportunity;

  // Authoritative, never re-decided by the model — see Section 7 of the
  // Gold Standard brief and contentPackage.ts's own validator, which
  // rejects anything that doesn't match this exact slide count.
  if (!isVisualFormat(rawVisualFormat)) {
    return jsonError("Geçerli bir görsel format seçimi gerekli.", 400);
  }
  const format = rawVisualFormat;
  const expectedSlideCount = format === "carousel" ? 5 : 1;

  let openai;
  try {
    openai = getOpenAITextClient();
  } catch {
    return jsonError("Yapay zeka servisi şu anda kullanılamıyor.", 500);
  }

  const researchDirective = buildResearchDirective(contentOpportunity);
  const systemMessage = [SYSTEM_PROMPT, researchDirective, buildContentPackagePrompt(30)].join("\n\n");
  const userMessage = buildUserMessage(contentOpportunity);
  // Only the roles actually needed for this request's format — a single
  // post gets one "hook" slide (its whole content anchor), a carousel
  // gets the full fixed 5-role sequence. Told to the model as plain
  // context so it knows how many slides to write for; the actual
  // index/role stamping below never depends on anything the model says.
  const roleSequence = format === "carousel" ? CAROUSEL_SLIDE_ROLES : (["hook"] as const);
  const formatContext = `İstenen format: ${format}. Üretilecek slayt sayısı: ${expectedSlideCount} (sıra: ${roleSequence.join(", ")}).`;

  let modelPackage: ModelPackage;
  try {
    const completion = await openai.chat.completions.create({
      model: AI_TEXT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: { name: "content_package", schema: CONTENT_PACKAGE_JSON_SCHEMA, strict: true },
      },
      max_completion_tokens: 4096,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: `${userMessage}\n\n${formatContext}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("empty structured response");
    }
    modelPackage = JSON.parse(raw) as ModelPackage;
  } catch (error) {
    console.error("Content package generation error:", error instanceof Error ? error.message : String(error));
    return jsonError("İçerik paketi oluşturulamadı. Lütfen tekrar deneyin.", 502);
  }

  if (!Array.isArray(modelPackage.slides) || modelPackage.slides.length !== expectedSlideCount) {
    return jsonError(
      `Yapay zeka yanıtı beklenen slayt sayısını (${expectedSlideCount}) içermiyor. Lütfen tekrar deneyin.`,
      502,
    );
  }

  // Stamp the deterministic index/role sequence and the caller's own
  // format choice — never read from the model's own output.
  const slides: ContentSlide[] = modelPackage.slides.map((slide, i) => ({
    index: i + 1,
    role: roleSequence[i],
    headline: slide.headline,
    body: slide.body,
    facts: slide.facts,
    visualBrief: slide.visualBrief,
  }));

  const contentPackage: ContentPackage = {
    topic: modelPackage.topic,
    source: modelPackage.source,
    hook: modelPackage.hook,
    caption: modelPackage.caption,
    hashtags: modelPackage.hashtags,
    format,
    slides,
    facts: modelPackage.facts,
  };

  const validation = validateContentPackage(contentPackage);
  if (!validation.ok) {
    console.error("Content package failed deterministic validation:", validation.reason);
    return jsonError("Oluşturulan içerik paketi doğrulamadan geçemedi. Lütfen tekrar deneyin.", 502);
  }

  return Response.json({ contentPackage });
}
