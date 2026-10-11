import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAITextClient, AI_TEXT_MODEL, CONTENT_PACKAGE_EDITORIAL_MODEL } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system-prompt";
import { isContentOpportunity, buildResearchDirective } from "@/lib/ai/research/opportunity";
import { isVisualFormat } from "@/lib/ai/research/formatRecommendation";
import {
  CAROUSEL_SLIDE_ROLES,
  sanitizeCalendarDateFacts,
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
import {
  FACT_CONTRACT_JSON_SCHEMA,
  filterCurrentTopicFacts,
  isEvidenceFactArray,
  type EvidenceFact,
} from "@/lib/ai/content/factContract";

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
  hook: "SLAYT 1 — HOOK: Ne oldu ve okuyucu bunu neden önemsemeli? Kısa, güçlü, spesifik tek bir mesaj. Clickbait yok, uzun paragraf yok. Bir mevzuat duyurusu/resmi bülten gibi tarih veya madde numarasıyla BAŞLAMA — önce DEĞİŞEN ŞEY ve okuyucunun NEDEN İLGİLENMESİ GEREKTİĞİNİ öne çıkar; tarih/referans varsa bunu destekleyici ayrıntı olarak sonra ver.",
  "what-happened":
    "SLAYT 2 — NE DEĞİŞTİ: Gelişmeyi somut biçimde anlat; kaynağın doğruladığı bilgiyi önceliklendir. Önemli bir sayı/tarih/gereklilik varsa NET biçimde burada yüzeye çıkar (facts alanına da ekle).",
  "why-it-matters":
    "SLAYT 3 — BUNUN SİZİN İÇİN ANLAMI: Gelişmeyi ilgili kitle için PRATİK sonuca çevir — alıcı, satıcı, ev sahibi, yatırımcı veya kiracı açısından somut biçimde ne değişiyor. Desteklenmeyen nedensel iddia kurma. Yalnızca 'ne değişti'yi başka kelimelerle tekrar etme; okuyucunun karar verirken gerçekten dikkate alması gereken somut bir noktayı ekle.",
  "what-to-do":
    "SLAYT 4 — NE YAPMALI: Mevcut olgularla desteklenen, gerçekten kullanışlı bir kontrol listesi, karar çerçevesi veya karşılaştırma sun — genel/boş bir 'dikkatli olun' cümlesi değil. Slayt 3'te açıklanan SONUCU burada tekrar açıklama — yalnızca somut, uygulanabilir adımları/kontrolleri listele.",
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
Şu kalıp ifadelerden VE YAKIN VARYASYONLARINDAN (anlamca örtüşen benzer cümlelerden) kaçın, gerçekten gerekli olmadıkça: ${AVOIDED_CLICHE_PHRASES.map((p) => `"${p}"`).join(", ")}.

Görev: Verilen güncel fırsat için TEK bir yapılandırılmış içerik paketi üret. Serbest metin/gizli işaret ([[...]]) YOK — yalnızca istenen JSON alanlarını doldur.

Kural — TEKRARSIZLIK / BİLGİ İLERLEMESİ (kritik): Beş slayt aynı fikri farklı kelimelerle beş kez tekrar ETMEMELİ. Her slayt, önceki slaytlarda YER ALMAYAN yeni bir bilgi, açı veya sonuç eklemeli. "Zorunlu gereklilik → mevzuat → önemi → kontrol edin → güvenli işlem yapın" gibi tek bir fikrin beş kez yeniden ifade edilmesi KABUL EDİLEMEZ ve reddedilecektir. Her slayt farklı bir editoryal işlevi yerine getirmeli (aşağıya bak). Çekirdek bir çıkarım (örn. "X olmadan işlem tamamlanamaz" gibi bir sonuç) SADECE BİR YERDE ana mesaj olarak yer alsın; başka bir slaytta/caption'da tekrar geçmesi gerekiyorsa orada FARKLI bir işlevle geçsin (sonuç değil — eylem, hazırlık, risk veya karar noktası olarak); aynı iddiayı yalnızca kelimeleri değiştirerek yeniden söylemek TEKRAR sayılır ve reddedilir.

Kural — UZMAN YORUMU: Kaynaktaki doğrulanmış olgulardan açıkça türetilen profesyonel bir yorum/değerlendirme eklemek İYİDİR (özellikle Slayt 3 ve Slayt 5'te) — ancak bu yorum yeni bir OLGU İDDİASI gibi sunulmamalı; "Bu gelişme ... gösteriyor/gündeme getiriyor" gibi açık bir yorum çerçevesiyle ayrılmalı.

Kural — UZMAN İÇGÖRÜSÜ (ZORUNLU): Paket, kaynağı yeniden ifade etmenin ötesine geçen EN AZ BİR gerçek profesyonel içgörü içermeli — örneğin: okuyucu ne yapmalı/erken hazırlanmalı, işlemi neyin geciktirebileceği/karmaşıklaştırabileceği, veya taahhütten önce neyin kontrol edilmesi gerektiği gibi somut bir karar-değeri. Bu içgörü kanıtla desteklenmeli, yeni bir olgu icat ETMEMELİ, ve konuyu zorla yerelleştirmemeli. Sahte deneyim/otorite iddiası (ör. "20 yıllık tecrübemle") EKLEME — sadece kanıta dayalı, somut bir profesyonel değerlendirme sun.

Kural — OLGU / YORUM AYRIMI VE UYDURMA YASAĞI:
- ContentSlide.facts ve ContentPackage.facts alanları SADECE kaynağın gerçekten belirttiği sayısal/olgusal bilgileri içersin.
- Kaynak yalnızca yaklaşık/toplam bir rakam veriyorsa (örn. "yaklaşık 150.000 TL"), bunu role="standalone" veya role="total" olarak ver; ASLA var olmayan bir kalem dökümü (depozito+kira+komisyon gibi) icat etme. role="component" SADECE kaynağın kendisi ayrı kalemleri açıkça verdiğinde kullanılsın.
- caption ve her slaytın body/headline metninde geçen HER belirgin sayı, facts dizisinde veya başka bir slaytta da yer almalı — icat edilmiş/çelişen bir sayı olmamalı.
- Kaynağın açıkça belirtmediği hiçbir tarih, tutar, yüzde, yasal sonuç, prosedür, istisna, süre/son tarih veya karşılaştırma UYDURMA. Genel/kanıtsız nedensel gerekçeler ekleme (örn. "pandemi sonrası hareketlilik", "ekonomik dalgalanmalar") — kanıt yoksa ihtiyatlı ve dar kapsamlı yaz; boşluğu doldurmaya çalışma.
- Bir kaynağın URL'sinin verilmesi, o sayfanın içeriğini okuduğun anlamına GELMEZ; yalnızca aşağıda "GERÇEK KAYNAK METNİ" olarak açıkça verilen metne güven. Aşağıdaki KANIT DURUMU "BAŞLIK DÜZEYİNDE" veya "YOK" ise, o kaynak SADECE başlık düzeyindedir — başlığın ima edebileceği hiçbir ayrıntılı tarih/tutar/prosedür/belge/yasal sonucu UYDURMA; yalnızca genel ve ihtiyatlı bir yorum yap.
- Bir kaynağın YAYIM TARİHİ (kaynağın ne zaman yayımlandığı), metin açıkça belirtmedikçe ASLA bir kuralın/uygulamanın yürürlüğe girdiği, başladığı veya bir son tarih/deadline olduğu anlamına gelmez — bunlar farklı şeylerdir; birini diğeri gibi sunma.
- Bir tarihi (gün/ay/yıl) ASLA ayrı toplanabilir "component" sayısal facts'e bölme (örn. yıl=2026, ay=9, gün=6 gibi üç ayrı olgu UYDURMA) — bir tarih tek bir metin ifadesi olarak slaytın headline/body'sinde veya source.publishedAt alanında yer alır, facts dizisinde arttırılabilir bir bileşen değildir.
- Kaynak metninde bir sayı/süre/prosedür geçmesi, onu HER bağlamda kullanma hakkı VERMEZ: bir rakam, süre veya prosedür SADECE kaynağın o bilgiyi açıkça ilişkilendirdiği durum/madde için kullanılabilir — kanıtın başka bir yerinde geçen bir ayrıntıyı, ele aldığın farklı bir slayt/senaryonun olgusu gibi sunma.
- Kanıt metninde "[AYRI KOŞUL / SENARYO BLOĞU]" işaretini görürsen, bundan sonraki metin kaynağın FARKLI bir koşul/istisna/senaryosunu tanımlar; bir sayı, süre, yükümlülük, prosedür veya sonucu bu işaretin bir tarafındaki bloktan diğerine, kaynak açıkça bağlamadıkça TAŞIMA.
- Son ${maxAgeContextDays} gün içindeki güncelliği doğal biçimde yansıt; tarihleri koru.

Yerel konumlandırma: Suat Kılıç'ın ana uzmanlık bölgesi ${geography.primary} ve çevresindeki ${geography.nearby.join(", ")} bölgeleri. Bunu HER cümleye zorlama — yalnızca editoryal olarak doğal olduğunda kullan. Ulusal ölçekli bir gelişmeyi kaynak desteklemediği halde yapay biçimde yerelleştirme.

Hedef kitlenin sorması gereken sorular (yalnızca kaynak/kanıt destekliyorsa yanıtla, uydurma): Ne oldu? Ne değişti? Bu kimi etkiliyor? Neden önemli? Alıcı/satıcı/yatırımcı neye dikkat etmeli? Okuyucu hangi pratik adımı atabilir?

Slayt içerikleri (yalnızca headline/body/facts/visualBrief doldur — sıra ve rol SENİN kararın DEĞİL, sistem tarafından sabittir):
${Object.values(CAROUSEL_SLIDE_ROLE_BRIEF).join("\n")}
visualBrief: SADECE görsel KONSEPT (örn. "modern İstanbul konut binası, akşam ışığı, editoryal fotoğraf") — asla ekranda yazı/metin isteme, asla marka/logo tarif etme.

Caption yapısı (ContentPackage.caption, tek metin, basın bülteni gibi OKUNMAMALI):
KISA ÇERÇEVELEME (gelişmeyi 1-2 cümlede tanıt) → BİR YENİ PROFESYONEL DEĞERLENDİRME (slaytlarda zaten verilen sonucu ayrıntılı biçimde YENİDEN AÇIKLAMADAN) → DOĞAL KAPANIŞ → İMZA:
Suat Kılıç
Gayrimenkul Yatırım Danışmanı
Caption, beş slaytın altıncı bir versiyonu OLMASIN; slaytların birebir tekrarı olmasın, slaytları tamamlayan kısa ve doğal bir metin olsun — her slaytı sırayla yeniden anlatma.

Hashtag stratejisi: Jenerik hashtag yığını üretme. 5-9 arası, yüksek ilgililikte hashtag seç; sayıyı artırmak için tuhaf/yapay birleşik hashtag icat etme. Şu kategorilerden anlamlı bir karışım kullan: (1) konuya özgü terim (ör. tapu/kira/imar konusuna gerçekten uyan bir etiket), (2) meslek/niyet (ör. #Gayrimenkul, #GayrimenkulYatırımı), (3) yalnızca editoryal olarak uygunsa yerel keşif etiketi (bölge adı), (4) yalnızca gerçekten uygunsa marka/uzmanlık etiketi. Aynı jenerik seti her seferinde tekrarlama.

topic: fırsatın kısa özeti. hook: caption'ın da kullanacağı kısa, güçlü açılış cümlesi. source: verilen fırsatın kaynak adı/URL/yayım tarihi, DEĞİŞTİRMEDEN.`;
}

// Content Quality Final Polish: the caption's closing signature is a
// fixed product requirement, not a subjective writing choice — do not
// rely on the model remembering it every time, or on it formatting it
// correctly when it does. Deterministic, not a second AI call.
const SIGNATURE_NAME = "Suat Kılıç";
const SIGNATURE_TITLE = "Gayrimenkul Yatırım Danışmanı";
const CANONICAL_SIGNATURE_BLOCK = `${SIGNATURE_NAME}\n${SIGNATURE_TITLE}`;

// Canonicalizes the signature block itself rather than merely adding
// whitespace around whatever the model produced — a proven, live-
// observed regression: one run glued the signature to the previous
// sentence with no break at all; another ran the name and title
// together on a single line with no break BETWEEN them. Both are fixed
// the same way: find the LAST occurrence of the name (the signature
// itself, as opposed to an incidental earlier mention in the caption's
// own prose), discard everything from there on — whatever the model did
// with it — and replace it with the exact canonical two-line block,
// separated from the preceding text by exactly one blank line. Applying
// this whenever the name is found (whether or not the title happens to
// already be present too) means the output is always the canonical
// form, never a hybrid of the model's own formatting.
function ensureSignature(caption: string): string {
  const trimmed = caption.trimEnd();
  const nameIndex = trimmed.lastIndexOf(SIGNATURE_NAME);
  if (nameIndex < 0) {
    return `${trimmed}\n\n${CANONICAL_SIGNATURE_BLOCK}`;
  }
  const before = trimmed.slice(0, nameIndex).replace(/\s+$/, "");
  return before ? `${before}\n\n${CANONICAL_SIGNATURE_BLOCK}` : CANONICAL_SIGNATURE_BLOCK;
}

// Deterministic Hashtag Locality Guard: a proven, live-observed
// regression on the stronger Job 2 model — it forced a "#Sarıyer"
// hashtag onto a genuinely national topic, contrary to the existing
// "don't force locality" prompt rule. Rather than adding yet another
// prompt instruction, this removes a locality hashtag AFTER generation
// whenever that specific locality doesn't actually appear anywhere in
// the topic or the verified current-topic facts. Deliberately small and
// generic — reuses the SAME geography names businessProfile.ts already
// defines (no new location database), and only ever removes a hashtag,
// never invents or reorders one.
function sanitizeLocalityHashtags(hashtags: string[], topic: string, verifiedClaims: string[]): string[] {
  const geography = ATLAS_DEFAULT_BUSINESS_PROFILE.geography;
  const localityNames = [geography.primary, ...geography.nearby];
  const contextText = `${topic} ${verifiedClaims.join(" ")}`.toLocaleLowerCase("tr-TR");

  return hashtags.filter((tag) => {
    const normalizedTag = tag.toLocaleLowerCase("tr-TR");
    const matchedLocality = localityNames.find((name) =>
      normalizedTag.includes(name.toLocaleLowerCase("tr-TR").replace(/\s+/g, "")),
    );
    if (!matchedLocality) return true; // not a locality hashtag — never touched
    return contextText.includes(matchedLocality.toLocaleLowerCase("tr-TR"));
  });
}

// Verified Fact Contract — Job 1's prompt. Deliberately short and
// mechanical: this call's ONLY job is factual classification, never
// hooks/captions/advice/interpretation. See factContract.ts's own
// header comment for why this exists as a separate call rather than
// another instruction inside the editorial prompt.
function buildFactExtractionPrompt(): string {
  return `Görev: SADECE olgusal iddiaları çıkar ve sınıflandır. Sosyal medya metni, başlık, caption, tavsiye veya yorum ÜRETME — bu senin işin değil.

Aşağıda bir KONU/FIRSAT ve bir KAYNAK METNİ verilecek. Kaynak metindeki HER ayrı olgusal iddiayı çıkar (en fazla 10) ve şu üç durumdan birine sınıflandır:
- "current-topic": Kanıtta açıkça belirtilmiş VE verilen konuya doğrudan uygulanır.
- "different-scenario": Kanıtta gerçekten geçer AMA farklı bir koşula/istisnaya/tarafa/senaryoya aittir — verilen konuya doğrudan uygulanmaz.
- "unsupported": Kanıtın açıkça belirtmediği, önerilen/olası bir iddia.

Kurallar:
- Bir sayı/süre/prosedür/yükümlülük geçmesi, onu otomatik olarak "current-topic" yapmaz — SADECE kaynağın o bilgiyi verilen konuya açıkça bağladığı durumda "current-topic" ver.
- Kaynak metninde "[AYRI KOŞUL / SENARYO BLOĞU]" işareti yalnızca yapısal bir ipuçtur — otomatik bir "different-scenario" kararı DEĞİLDİR; işaretten sonraki metin GERÇEKTEN farklı bir senaryoyu tanımlıyorsa "different-scenario" ver, tanımlamıyorsa "current-topic" verebilirsin.
- Kaynağın YAYIM TARİHİ, metin açıkça belirtmedikçe bir yürürlük/başlangıç tarihi değildir; bunu ayrı bir olgu olarak değerlendir.
- evidenceFragment, kaynaktan kısa ve gerçek bir alıntı/yakın ifade olmalı — asla icat edilmiş bir alıntı verme.
- claim kısa ve düz bir olgu ifadesi olsun — yorum, tavsiye veya slogan değil.`;
}

function buildFactExtractionUserMessage(
  opportunity: { topic: string; angle: string; whyNow: string },
  evidenceText: string,
): string {
  return [
    `Konu/Fırsat: ${opportunity.topic}`,
    `Bağlam (yorum, olgu değil): ${opportunity.angle}`,
    `Kaynak metni: "${evidenceText}"`,
    "Yukarıdaki kaynak metnindeki olguları çıkar ve sınıflandır.",
  ].join("\n");
}

// Job 1: a separate, narrow AI call whose only output is the small
// EvidenceFact[] contract. Fails closed on any problem — network
// error, empty response, malformed JSON, or a response that doesn't
// structurally match EvidenceFact[] — by returning null, never a
// partial/best-effort guess. The caller treats null exactly like zero
// verified facts.
async function extractVerifiedFacts(
  openai: ReturnType<typeof getOpenAITextClient>,
  opportunity: { topic: string; angle: string; whyNow: string },
  evidenceText: string,
): Promise<EvidenceFact[] | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: AI_TEXT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: { name: "evidence_fact_contract", schema: FACT_CONTRACT_JSON_SCHEMA, strict: true },
      },
      max_completion_tokens: 1200,
      messages: [
        { role: "system", content: buildFactExtractionPrompt() },
        { role: "user", content: buildFactExtractionUserMessage(opportunity, evidenceText) },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { facts?: unknown };
    if (!isEvidenceFactArray(parsed.facts)) return null;
    return parsed.facts;
  } catch (error) {
    console.error("Fact contract extraction error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

// The three ways ContentPackage generation's user message can present
// evidence — "verified" (Job 1 succeeded with at least one current-
// topic fact) is the only path that may ground a precise claim;
// "thin-or-none" is used both for genuinely thin/absent evidence AND
// as the fail-closed path when evidence was meaningful but Job 1
// failed or found no current-topic facts — in that fail-closed case
// rawEvidenceText is deliberately omitted (never the full raw
// document), so the editorial call can never independently re-discover
// the very cross-scenario facts Job 1 exists to filter out.
type EvidencePresentation =
  | { mode: "verified"; facts: EvidenceFact[] }
  | { mode: "thin-or-none"; rawEvidenceText: string | undefined };

function buildUserMessage(
  opportunity: {
    topic: string;
    angle: string;
    whyNow: string;
    keyFacts: string[];
    sources: { title: string; publisher: string; url: string; publishedAt: string; evidenceText?: string }[];
  },
  evidence: EvidencePresentation,
): string {
  const source = opportunity.sources[0];
  const lines = [
    `Konu: ${opportunity.topic}`,
    `Atlas açısı (yorum, olgu değil): ${opportunity.angle}`,
    `Güncellik nedeni: ${opportunity.whyNow}`,
    `Kaynağın bildirdiği olgular: ${opportunity.keyFacts.join("; ")}`,
  ];
  if (source) {
    lines.push(`Kaynak: ${source.publisher} — ${source.url} — ${source.publishedAt}`);

    if (evidence.mode === "verified") {
      // Verified Fact Contract: this is now the ONLY factual boundary
      // for meaningful evidence — the editorial call never sees the
      // full raw document, only the facts Job 1 already confirmed
      // apply to THIS topic.
      lines.push("KANIT DURUMU: YETERLİ (DOĞRULANMIŞ OLGULAR)");
      lines.push(
        "DOĞRULANMIŞ OLGULAR — SADECE bunlar mevcut konu için kesin olgu kaynağıdır; bunların DIŞINDA kaynaktan başka bir kesin tarih/tutar/prosedür/yükümlülük EKLEME:",
      );
      for (const fact of evidence.facts) {
        lines.push(`- ${fact.claim} (kanıt: "${fact.evidenceFragment}")`);
      }
    } else {
      // Evidence Safety Gate: evidence PRESENT is not the same as
      // evidence SUFFICIENT — live production verification proved a
      // real TKGM detail page can pass the capture-time length check
      // while being mostly navigation chrome plus a "go download the
      // linked file" stub. "thin" gets the exact same strict
      // instruction as "none" (never both shown the raw text as if it
      // were reliable and then trusted to self-police).
      const statusLabel = evidence.rawEvidenceText ? "BAŞLIK DÜZEYİNDE" : "YOK";
      lines.push(`KANIT DURUMU: ${statusLabel}`);

      if (evidence.rawEvidenceText) {
        lines.push(
          `GERÇEK KAYNAK METNİ (yalnızca başlık düzeyinde/yetersiz kanıt — bu metin KESİN OLGU KAYNAĞI OLARAK KULLANILAMAZ, sadece genel bağlam için): "${capEvidenceText(evidence.rawEvidenceText, EVIDENCE_TEXT_MAX_CHARS)}"`,
        );
      } else {
        lines.push("GERÇEK KAYNAK METNİ: YOK");
      }
      lines.push(
        `Bu kaynak için ayrıntılı doğrulanmış bilgi YOK; yalnızca başlık düzeyinde bilgi var say. Tarih, tutar, belge zorunluluğu, işlem sonucu, yüzde, ücret, istatistik gibi HİÇBİR kesin ayrıntıyı UYDURMA. Yayım tarihi (${source.publishedAt}) bir yürürlük/başlangıç/son tarihi OLARAK sunulamaz.`,
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

  // Verified Fact Contract: Job 1 runs ONLY for MEANINGFUL evidence —
  // running it against thin/absent evidence would spend a call for no
  // benefit, and would risk giving Job 1 itself only chrome/stub text
  // to classify. Failure of any kind (network, malformed JSON, zero
  // current-topic facts) fails CLOSED to the existing thin/none
  // presentation — never falls back to handing Job 2 the raw document.
  const primarySource = contentOpportunity.sources[0] as
    | { title: string; publisher: string; url: string; publishedAt: string; evidenceText?: string }
    | undefined;
  const sufficiency = classifyEvidenceSufficiency(primarySource?.evidenceText);
  let evidencePresentation: EvidencePresentation;

  if (sufficiency === "meaningful" && primarySource?.evidenceText) {
    const verifiedFacts = await extractVerifiedFacts(openai, contentOpportunity, primarySource.evidenceText);
    // Evidence Fragment Grounding Check: a "current-topic" fact whose own
    // evidenceFragment isn't a genuine, verifiable quote from the real
    // evidenceText is dropped here, same as if Job 1 never reported it —
    // see factContract.ts's filterCurrentTopicFacts/isEvidenceFragmentGrounded.
    const currentTopicFacts = verifiedFacts
      ? filterCurrentTopicFacts(verifiedFacts, primarySource.evidenceText)
      : [];
    // Observability (Section 10): counts only, never evidence content.
    console.log(
      `Fact contract: extracted=${verifiedFacts?.length ?? 0} currentTopic=${currentTopicFacts.length} failClosed=${verifiedFacts === null}`,
    );
    evidencePresentation =
      currentTopicFacts.length > 0
        ? { mode: "verified", facts: currentTopicFacts }
        : { mode: "thin-or-none", rawEvidenceText: undefined };
  } else if (sufficiency === "thin") {
    evidencePresentation = { mode: "thin-or-none", rawEvidenceText: primarySource?.evidenceText };
  } else {
    evidencePresentation = { mode: "thin-or-none", rawEvidenceText: undefined };
  }

  const researchDirective = buildResearchDirective(contentOpportunity);
  const systemMessage = [SYSTEM_PROMPT, researchDirective, buildContentPackagePrompt(30)].join("\n\n");
  const userMessage = buildUserMessage(contentOpportunity, evidencePresentation);
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
      model: CONTENT_PACKAGE_EDITORIAL_MODEL,
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

  const verifiedClaims = evidencePresentation.mode === "verified" ? evidencePresentation.facts.map((f) => f.claim) : [];

  const contentPackage: ContentPackage = {
    topic: modelPackage.topic,
    source: modelPackage.source,
    hook: modelPackage.hook,
    caption: ensureSignature(modelPackage.caption),
    hashtags: sanitizeLocalityHashtags(modelPackage.hashtags, contentOpportunity.topic, verifiedClaims),
    format,
    slides,
    // Deterministic Calendar-Date Fact Sanitizer: strips the exact
    // proven invalid pattern (a date decomposed into role="component"
    // facts) before validation runs, so this specific model mistake
    // degrades to a smaller/possibly-empty facts[] rather than failing
    // the whole package.
    facts: sanitizeCalendarDateFacts(modelPackage.facts),
  };

  const validation = validateContentPackage(contentPackage);
  if (!validation.ok) {
    console.error("Content package failed deterministic validation:", validation.reason);
    return jsonError("Oluşturulan içerik paketi doğrulamadan geçemedi. Lütfen tekrar deneyin.", 502);
  }

  return Response.json({ contentPackage });
}
