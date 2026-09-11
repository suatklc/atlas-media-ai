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
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";
import {
  capEvidenceText,
  classifyEvidenceSufficiency,
  EVIDENCE_TEXT_MAX_CHARS,
} from "@/lib/ai/research/retrieval/evidenceExtraction";

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

// Gold Standard V1 — Content Quality Upgrade (Section 4 of that task's
// spec): each role gets a full editorial brief, not a one-line format
// note, specifically so slide 5 is told NOT to summarize 1-4, and slide
// 2's brief calls out surfacing the key number/date/requirement — the
// two biggest levers against the "mandatory → regulation → importance →
// check it → safe transaction" repetition failure the real production
// test surfaced.
const CAROUSEL_SLIDE_ROLE_BRIEF: Record<string, string> = {
  hook: "SLAYT 1 — HOOK: Ne oldu ve okuyucu bunu neden önemsemeli? Kısa, güçlü, spesifik tek bir mesaj. Clickbait yok, uzun paragraf yok.",
  "what-happened":
    "SLAYT 2 — NE DEĞİŞTİ: Gelişmeyi somut biçimde anlat; kaynağın doğruladığı bilgiyi önceliklendir. Önemli bir sayı/tarih/gereklilik varsa NET biçimde burada yüzeye çıkar (facts alanına da ekle).",
  "why-it-matters":
    "SLAYT 3 — BUNUN SİZİN İÇİN ANLAMI: Gelişmeyi ilgili kitle için PRATİK sonuca çevir — alıcı, satıcı, ev sahibi, yatırımcı veya kiracı açısından somut biçimde ne değişiyor. Desteklenmeyen nedensel iddia kurma.",
  "what-to-do":
    "SLAYT 4 — NE YAPMALI: Mevcut olgularla desteklenen, gerçekten kullanışlı bir kontrol listesi, karar çerçevesi veya karşılaştırma sun — genel/boş bir 'dikkatli olun' cümlesi değil.",
  cta: "SLAYT 5 — UZMAN GÖRÜŞÜ / KAPANIŞ: Slayt 1-4'ün özeti OLMASIN. Kısa ve profesyonel bir uzman çıkarımı sun; Suat Kılıç'ı bir haber hesabı gibi değil, güvenilir bir gayrimenkul danışmanı gibi konumlandır. Ölçülü, doğal bir eylem çağrısıyla bitir — hazır kalıp cümleyi birebir kopyalama.",
};

const AVOIDED_CLICHE_PHRASES = [
  "önemli bir adım teşkil ediyor",
  "güvenli işlem açısından kritik önem taşıyor",
  "bilinçli hareket etmek faydalı olacaktır",
  "güncel gelişmeler ışığında",
  "gayrimenkul piyasasında işlemlerin güvenliği açısından",
];

function buildContentPackagePrompt(maxAgeContextDays: number): string {
  const geography = ATLAS_DEFAULT_BUSINESS_PROFILE.geography;

  return `Kimlik ve konumlandırma: Sen bir haber özetleyicisi DEĞİLSİN. Suat Kılıç (Gayrimenkul Yatırım Danışmanı) için çalışan profesyonel bir gayrimenkul içerik stratejistisin. Görevin, ham bir kaynağı; okuyucunun "bu bilgi işime yarar, bunu kaydetmeliyim, bu danışman piyasayı biliyor" diyeceği tam bir sosyal medya içerik paketine dönüştürmek.

Ses (Suat Kılıç üslubu): profesyonel, bilgili, sakin, güvenilir, açık, pratik, insani.
ASLA şöyle yazma: kurumsal PR dili, hukuki/mevzuat metni dili, yapay zeka dolgu dili, sansasyonel dil, satış baskısı dili, bürokratik/resmi duyuru dili. Suat bir avukat, ekonomist, resmi kurum temsilcisi veya gazeteci gibi yazmaz — o, gayrimenkul kararı veren insanlar için gelişmeleri yorumlayan bir danışmandır.
Şu kalıp ifadelerden (ve birebir eşdeğerlerinden) kaçın, gerçekten gerekli olmadıkça: ${AVOIDED_CLICHE_PHRASES.map((p) => `"${p}"`).join(", ")}.

Görev: Verilen güncel fırsat için TEK bir yapılandırılmış içerik paketi üret. Serbest metin/gizli işaret ([[...]]) YOK — yalnızca istenen JSON alanlarını doldur.

Kural — TEKRARSIZLIK / BİLGİ İLERLEMESİ (kritik): Beş slayt aynı fikri farklı kelimelerle beş kez tekrar ETMEMELİ. Her slayt, önceki slaytlarda YER ALMAYAN yeni bir bilgi, açı veya sonuç eklemeli. "Zorunlu gereklilik → mevzuat → önemi → kontrol edin → güvenli işlem yapın" gibi tek bir fikrin beş kez yeniden ifade edilmesi KABUL EDİLEMEZ ve reddedilecektir. Her slayt farklı bir editoryal işlevi yerine getirmeli (aşağıya bak).

Kural — UZMAN YORUMU: Kaynaktaki doğrulanmış olgulardan açıkça türetilen profesyonel bir yorum/değerlendirme eklemek İYİDİR (özellikle Slayt 3 ve Slayt 5'te) — ancak bu yorum yeni bir OLGU İDDİASI gibi sunulmamalı; "Bu gelişme ... gösteriyor/gündeme getiriyor" gibi açık bir yorum çerçevesiyle ayrılmalı.

Kural — OLGU / YORUM AYRIMI VE UYDURMA YASAĞI:
- ContentSlide.facts ve ContentPackage.facts alanları SADECE kaynağın gerçekten belirttiği sayısal/olgusal bilgileri içersin.
- Kaynak yalnızca yaklaşık/toplam bir rakam veriyorsa (örn. "yaklaşık 150.000 TL"), bunu role="standalone" veya role="total" olarak ver; ASLA var olmayan bir kalem dökümü (depozito+kira+komisyon gibi) icat etme. role="component" SADECE kaynağın kendisi ayrı kalemleri açıkça verdiğinde kullanılsın.
- caption ve her slaytın body/headline metninde geçen HER belirgin sayı, facts dizisinde veya başka bir slaytta da yer almalı — icat edilmiş/çelişen bir sayı olmamalı.
- Kaynağın açıkça belirtmediği hiçbir tarih, tutar, yüzde, yasal sonuç, prosedür, istisna, süre/son tarih veya karşılaştırma UYDURMA. Genel/kanıtsız nedensel gerekçeler ekleme (örn. "pandemi sonrası hareketlilik", "ekonomik dalgalanmalar") — kanıt yoksa ihtiyatlı ve dar kapsamlı yaz; boşluğu doldurmaya çalışma.
- Bir kaynağın URL'sinin verilmesi, o sayfanın içeriğini okuduğun anlamına GELMEZ; yalnızca aşağıda "GERÇEK KAYNAK METNİ" olarak açıkça verilen metne güven. Aşağıdaki KANIT DURUMU "BAŞLIK DÜZEYİNDE" veya "YOK" ise, o kaynak SADECE başlık düzeyindedir — başlığın ima edebileceği hiçbir ayrıntılı tarih/tutar/prosedür/belge/yasal sonucu UYDURMA; yalnızca genel ve ihtiyatlı bir yorum yap.
- Bir kaynağın YAYIM TARİHİ (kaynağın ne zaman yayımlandığı), metin açıkça belirtmedikçe ASLA bir kuralın/uygulamanın yürürlüğe girdiği, başladığı veya bir son tarih/deadline olduğu anlamına gelmez — bunlar farklı şeylerdir; birini diğeri gibi sunma.
- Bir tarihi (gün/ay/yıl) ASLA ayrı toplanabilir "component" sayısal facts'e bölme (örn. yıl=2026, ay=9, gün=6 gibi üç ayrı olgu UYDURMA) — bir tarih tek bir metin ifadesi olarak slaytın headline/body'sinde veya source.publishedAt alanında yer alır, facts dizisinde arttırılabilir bir bileşen değildir.
- Son ${maxAgeContextDays} gün içindeki güncelliği doğal biçimde yansıt; tarihleri koru.

Yerel konumlandırma: Suat Kılıç'ın ana uzmanlık bölgesi ${geography.primary} ve çevresindeki ${geography.nearby.join(", ")} bölgeleri. Bunu HER cümleye zorlama — yalnızca editoryal olarak doğal olduğunda kullan. Ulusal ölçekli bir gelişmeyi kaynak desteklemediği halde yapay biçimde yerelleştirme.

Hedef kitlenin sorması gereken sorular (yalnızca kaynak/kanıt destekliyorsa yanıtla, uydurma): Ne oldu? Ne değişti? Bu kimi etkiliyor? Neden önemli? Alıcı/satıcı/yatırımcı neye dikkat etmeli? Okuyucu hangi pratik adımı atabilir?

Slayt içerikleri (yalnızca headline/body/facts/visualBrief doldur — sıra ve rol SENİN kararın DEĞİL, sistem tarafından sabittir):
${Object.values(CAROUSEL_SLIDE_ROLE_BRIEF).join("\n")}
visualBrief: SADECE görsel KONSEPT (örn. "modern İstanbul konut binası, akşam ışığı, editoryal fotoğraf") — asla ekranda yazı/metin isteme, asla marka/logo tarif etme.

Caption yapısı (ContentPackage.caption, tek metin, basın bülteni gibi OKUNMAMALI):
HOOK (kısa) → GAYRİMENKUL YORUMU (pratik anlam ve sonuç, 2-4 kısa doğal paragraf) → UZMAN ÇIKARIMI (kısa) → ÖLÇÜLÜ EYLEM ÇAĞRISI → İMZA:
Suat Kılıç
Gayrimenkul Yatırım Danışmanı
Caption, slaytların birebir tekrarı olmasın; slaytları tamamlayan, doğal bir metin olsun — her slaytı sırayla yeniden anlatma.

Hashtag stratejisi: Jenerik hashtag yığını üretme. 5-9 arası, yüksek ilgililikte hashtag seç; sayıyı artırmak için tuhaf/yapay birleşik hashtag icat etme. Şu kategorilerden anlamlı bir karışım kullan: (1) konuya özgü terim (ör. tapu/kira/imar konusuna gerçekten uyan bir etiket), (2) meslek/niyet (ör. #Gayrimenkul, #GayrimenkulYatırımı), (3) yalnızca editoryal olarak uygunsa yerel keşif etiketi (bölge adı), (4) yalnızca gerçekten uygunsa marka/uzmanlık etiketi. Aynı jenerik seti her seferinde tekrarlama.

topic: fırsatın kısa özeti. hook: caption'ın da kullanacağı kısa, güçlü açılış cümlesi. source: verilen fırsatın kaynak adı/URL/yayım tarihi, DEĞİŞTİRMEDEN.`;
}

function buildUserMessage(opportunity: {
  topic: string;
  angle: string;
  whyNow: string;
  keyFacts: string[];
  sources: { title: string; publisher: string; url: string; publishedAt: string; evidenceText?: string }[];
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
    // Evidence Safety Gate: evidence PRESENT is not the same as evidence
    // SUFFICIENT — live production verification proved a real TKGM
    // detail page can pass the capture-time length check while being
    // mostly navigation chrome plus a "go download the linked file"
    // stub. classifyEvidenceSufficiency is the deterministic gate that
    // catches this; "thin" gets the exact same strict instruction as
    // "none" (never both shown the raw text as if it were reliable and
    // then trusted to self-police) — only "meaningful" evidence may
    // ground a precise claim.
    const sufficiency = classifyEvidenceSufficiency(source.evidenceText);
    const statusLabel =
      sufficiency === "meaningful" ? "YETERLİ" : sufficiency === "thin" ? "BAŞLIK DÜZEYİNDE" : "YOK";
    lines.push(`KANIT DURUMU: ${statusLabel}`);

    if (sufficiency === "meaningful") {
      lines.push(
        `GERÇEK KAYNAK METNİ (kaynaktan çıkarılan gerçek metin — kesin olgular SADECE bu metne dayanabilir): "${capEvidenceText(source.evidenceText as string, EVIDENCE_TEXT_MAX_CHARS)}"`,
      );
    } else {
      // "thin" still shows the captured text for topical/high-level
      // context, but explicitly labeled as NOT a factual source — the
      // model must reason from it the same way it would from a bare
      // headline, never as a citable detail source.
      if (sufficiency === "thin" && source.evidenceText) {
        lines.push(
          `GERÇEK KAYNAK METNİ (yalnızca başlık düzeyinde/yetersiz kanıt — bu metin KESİN OLGU KAYNAĞI OLARAK KULLANILAMAZ, sadece genel bağlam için): "${capEvidenceText(source.evidenceText, EVIDENCE_TEXT_MAX_CHARS)}"`,
        );
      } else {
        lines.push(`GERÇEK KAYNAK METNİ: YOK`);
      }
      lines.push(
        `Bu kaynak için ayrıntılı bilgi YOK; yalnızca başlık düzeyinde bilgi var say. Tarih, tutar, belge zorunluluğu, işlem sonucu, yüzde, ücret, istatistik gibi HİÇBİR kesin ayrıntıyı UYDURMA. Yayım tarihi (${source.publishedAt}) bir yürürlük/başlangıç/son tarihi OLARAK sunulamaz.`,
      );
    }
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
