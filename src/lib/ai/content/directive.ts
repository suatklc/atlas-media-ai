import type { AudienceType, ContentGoal, ContentIntent, ContentPlan } from "./types";

const MAX_DIRECTIVE_CHARS = 650;

const CTA_STYLE_BY_GOAL: Record<ContentGoal, string> = {
  "lead-generation": "doğrudan aksiyon çağrısı",
  "brand-awareness": "marka güvenini vurgulayan, yumuşak kapanış",
  education: "bilgilendirici, düşük baskılı",
  authority: "uzmanlığı vurgulayan, danışma daveti",
  engagement: "yorum/paylaşım teşvik eden, soru içeren",
};

// Only these four audiences get a modifier — every other audience uses the
// goal-based style as-is.
const CTA_AUDIENCE_MODIFIER: Partial<Record<AudienceType, string>> = {
  "luxury-home-buyer": "ayrıcalıklı ve özel bir üslupla",
  "first-time-home-buyer": "güven verici ve açıklayıcı bir üslupla",
  "commercial-investor": "iş odaklı, sonuç vurgulu bir üslupla",
  "land-investor": "yatırım potansiyelini öne çıkaran bir üslupla",
};

// Category A: topic/intent tags.
const BASE_TAGS_BY_INTENT: Partial<Record<ContentIntent, string[]>> = {
  listing: ["#emlak", "#gayrimenkul", "#satılık"],
  educational: ["#emlak", "#gayrimenkul", "#bilgi"],
  comparison: ["#emlak", "#gayrimenkul"],
  "market-stats": ["#emlak", "#konutpiyasası"],
  announcement: ["#emlak", "#gayrimenkul"],
};

// Category B: audience/property tag.
const AUDIENCE_TAG: Record<AudienceType, string> = {
  "luxury-home-buyer": "#lüksemlak",
  "villa-buyer": "#villa",
  "land-investor": "#arsayatırımı",
  "property-owner": "#mülksahibi",
  "first-time-home-buyer": "#ilkevim",
  "commercial-investor": "#ticarigayrimenkul",
  "general-buyer": "#emlakdanışmanlığı",
};

// Every sectionStructure token currently used across the five templates,
// translated into a Turkish output label. One shared table rather than a
// per-template label set.
const SECTION_LABELS: Record<string, string> = {
  hook: "Giriş",
  "key-features": "Öne Çıkan Özellikler",
  cta: "Kapanış/CTA",
  "point-1": "Nokta 1",
  "point-2": "Nokta 2",
  "point-3": "Nokta 3",
  summary: "Özet",
  "cta-slide": "Kapanış/CTA",
  title: "Başlık",
  "option-a": "Seçenek A",
  "option-b": "Seçenek B",
  verdict: "Değerlendirme",
  headline: "Başlık",
  detail: "Detay",
  "stat-1": "Veri 1",
  "stat-2": "Veri 2",
  "stat-3": "Veri 3",
  "source-note": "Kaynak Notu",
};

// Pure string assembly only — no matching logic, no history access, never
// mutates its input. Returns "" when there is no content intent.
export function buildContentDirective(plan: ContentPlan): string {
  if (plan.intent === "none" || !plan.template) {
    return "";
  }

  const template = plan.template;
  const goal = plan.goal ?? "education";

  const translatedSections = template.sectionStructure.map((token) => SECTION_LABELS[token] ?? token);
  const tags = [...(BASE_TAGS_BY_INTENT[plan.intent] ?? []), AUDIENCE_TAG[plan.audience]];

  // No "Görsel Spesifikasyonu" section in this structure: the actual visual
  // spec (aspect ratio, composition, camera/lighting/typography direction)
  // is already derived deterministically and independently by
  // creative/brief.ts's buildCreativeBrief (from this same ContentPlan) and
  // consumed directly by generate-visual/route.ts — never parsed from
  // anything Claude writes here. Instructing the model to also write that
  // spec out as a visible section of its own reply was purely redundant,
  // implementation-detail prose leaking into what the user reads (Handoff
  // — one-instruction experience). template.visualEmphasis still reaches
  // the model via creative/directive.ts's own internal (never-repeated)
  // brief line — removing it from here loses no information, only the
  // duplicate visible restatement of it.
  const structureLine = plan.outputMode === "single"
    ? `Yapı: tam olarak tek gönderi/görsel; ek slayt ekleme; ${translatedSections.join(" → ")} → ` +
      `Etiketler (${tags.join(", ")} + mesaj konusu; ~5-8; konum uydurma)`
    : `Yapı: tam olarak ${plan.slideCount} slayt; ilk slayt giriş, son slayt özet/CTA, ` +
      `ara slaytlar ana noktalar → Etiketler (${tags.join(", ")} + mesaj konusu; ~5-8; konum uydurma)`;

  const ctaStyle = CTA_STYLE_BY_GOAL[goal];
  const ctaModifier = CTA_AUDIENCE_MODIFIER[plan.audience];
  const ctaLine = `CTA: ${ctaStyle}${ctaModifier ? `, ${ctaModifier}` : ""}, konum: ${template.ctaPosition}`;

  const lines: string[] = [
    "[Dahili içerik planı — yalnızca bu istek için, yanıtta tekrar etme]",
    `Çıktı modu: ${plan.outputMode === "single" ? "tek görsel" : `carousel (${plan.slideCount} slayt)`}`,
    `Hedef: ${goal}`,
    `Hedef kitle: ${plan.audience}`,
    structureLine,
    ctaLine,
    'Eksik veri: [X] gibi yer tutucu kullanma; sonda ayrı "Tamamlanması Gerekenler" notu ver.',
    'Ek iş teklif etme (ör. "isterseniz yeniden hazırlarım").',
    'Tekrarlayan kalıplardan (ör. "hem X hem Y") kaçın; somut, konuya özgü ve ayırt edici yaz.',
  ];

  // Safe truncation: drop whole trailing lines (least-critical standing
  // instructions first, since they're appended last) rather than slicing
  // mid-string, which could cut a word or label in half.
  let directive = lines.join("\n");
  while (directive.length > MAX_DIRECTIVE_CHARS && lines.length > 1) {
    lines.pop();
    directive = lines.join("\n");
  }
  if (directive.length > MAX_DIRECTIVE_CHARS) {
    directive = directive.slice(0, MAX_DIRECTIVE_CHARS);
  }

  return directive;
}
