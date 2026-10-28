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
} from "@/lib/ai/content/contentPackage";
import { ATLAS_DEFAULT_BUSINESS_PROFILE } from "@/lib/ai/context/businessProfile";
import {
  capEvidenceText,
  classifyEvidenceSufficiency,
  EVIDENCE_TEXT_MAX_CHARS,
} from "@/lib/ai/research/retrieval/evidenceExtraction";
import { formatTurkeyDateDMY } from "@/lib/ai/research/retrieval/turkishDate";
import {
  FACT_CONTRACT_JSON_SCHEMA,
  findTokenBindingViolations,
  formatBundleForCitation,
  groundBundleFacts,
  isEvidenceFactArray,
  segmentBundle,
  SOURCE_CHANGE_LABEL,
  trustedSourceMetadataTokens,
  type EvidenceBundleSource,
  type EvidenceFact,
} from "@/lib/ai/content/factContract";
import { mayProvideFactEvidence, orderSourcesByAuthority, sourceRoleFor, type SourceRole } from "@/lib/ai/research/sourceRegistry";
import type { ContentOpportunity, SourceTier } from "@/lib/ai/research/types";
import {
  buildEditorialGatePrompt,
  buildEditorialGateUserMessage,
  EDITORIAL_GATE_SCHEMA_NAME,
  findNewFactTokens,
  GATE_CATEGORIES,
  isEditorialGateResult,
  shouldRevise,
  type EditorialGateResult,
  type EditorialRevisionOutcome,
} from "@/lib/ai/content/editorialRevision";

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

// Editorial Quality Repair — the gate+revise call's output (see
// editorialRevision.ts). `revised` is the same package shape as Job 2's,
// or null when the gate passes or the failure isn't wording-level.
const EDITORIAL_GATE_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    failCategories: { type: "array", items: { type: "string", enum: [...GATE_CATEGORIES] } },
    issues: { type: "array", items: { type: "string" } },
    revised: { anyOf: [CONTENT_PACKAGE_JSON_SCHEMA, { type: "null" }] },
  },
  required: ["verdict", "failCategories", "issues", "revised"],
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
  // Live-observed in real 29.09.2026 runs and failed by the Editorial
  // Quality Gate (.claude/skills/atlas-editorial-quality-gate).
  "süreç daha öngörülebilir hale gelir",
  "sürecin kurgusu",
  "işlem kurgusu",
  "iki kritik nokta öne çıktı",
  "yeniden netleştirildi",
  "sadece X değil, Y de",
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

Kural — EDİTORYAL KALİTE KAPISI (Suat bunu HİÇ DÜZENLEMEDEN yayımlamalı):
- hook ve Slayt 1 headline: 5-12 kelime; DEĞİŞEN ŞEYİ söyleyerek başla, okuyucuya hitap et (ör. "... alıyorsanız"), en az bir somut ve doğrulanmış işaret (kurum, belge, süre, tutar) içersin. "netleşti", "öne çıktı", "güncellendi" gibi değişikliğin ne olduğunu söylemeyen fiillerle yetinme.
- Kaynaktaki TANIM cümlelerini ("... dokümandır", "... ifade eder") kopyalama — sade, konuşma diliyle anlat.
- Her kural/süre/rakam ana mesaj olarak YALNIZCA BİR slaytta yer alsın; aynı kuralı birden çok slaytta tekrarlama.
- Slayt 4'teki her madde okuyucunun gerçekten atlayabileceği somut bir kontrol olsun — "işlemin X amaçlı olduğundan emin olun" gibi herkesin zaten bildiği boş maddeler YOK.
- Slayt 5 ve caption'daki uzman görüşü BU değişikliğe özgü olsun (başka bir konuya da aynen uyabilecek genel bir cümle değil): imzadan önce sorulacak soru, sık yapılan hata veya zamanlama riski gibi.
- caption, imzadan hemen önce ölçülü tek bir eylem çağrısıyla bitsin (ör. sorularınız için mesaj).
- Yazmadan önce olguları şu yapıya oturt (yalnızca kaynak destekliyorsa): (A) YENİ değişiklik — "NE DEĞİŞTİ" olguları; (B) MEVCUT kural — "ARKA PLAN" olguları, "zaten/mevcut kural" diye anılır; (C) KİMİ etkiliyor; (D) NE ZAMAN uygulanıyor (kaynak açıkça söylemiyorsa tarih verme); (E) gayrimenkul kararına PRATİK etkisi; (F) Suat'ın YORUMU ("bence", "sahada gördüğüm" — olgu gibi değil).
- Kitle: hook ve caption'ın ilk cümlesi kuralın KİME uygulandığını açıkça söylesin; belirli bir kitleye ait kuralı (ör. yalnızca yabancılar, yalnızca vatandaşlık başvurusu) herkes içinmiş gibi yazma ve kaynaktaki kitle kısıtını asla düşürme.
- Benzer olgular: NE DEĞİŞTİ ile ARKA PLAN'da aynı sayı/süre/kavram geçiyorsa hangisinin yeni hüküm, hangisinin mevcut kural olduğunu açıkça ayır; "X kuralı değişti" gibi belirsiz ifade kullanma, değişen hükmü ayırt edici kelimeleriyle (ör. "herhangi bir") tam söyle.
- Teknik kısaltmayı ilk geçtiği yerde, kaynaktaki tam adıyla bir kez aç ve normal bir okuyucu için ne işe yaradığını kısaca söyle.
- Her tavsiye/fikir paketin TAMAMINDA yalnızca bir kez ana mesaj olsun: slayt 3, slayt 4, slayt 5 ve caption her biri farklı bir şey söylesin.
- Geçmiş bir tarih aralığına ait kuralı bugünkü okuyucu için kontrol maddesi gibi sunma.

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

// ============================================================
// EXPERT content mode (first real production use, 2026-10-18): the
// dashboard's "Instagram paylaşımı hazırla" now sends the user's own
// instruction here instead of the legacy /api/assistant chat. Evergreen
// expert content has NO source and NO verified facts, so the news-
// oriented "what changed" brief above would contradict itself — same
// writer (Job 2), same voice/cliché/signature/hashtag rules, a different
// brief: no factual market claims at all, interpretation framed as
// Suat's view, one audience, one CTA (slide 5 only).
// ============================================================
const EXPERT_SLIDE_ROLE_BRIEF: Record<string, string> = {
  hook: "SLAYT 1 — KAPAK (okuyucunun sorusu/sorunu): headline kapakta fotoğrafın üzerinde büyük görünür — EN FAZLA 55 karakter, TAM ve kendi başına anlamlı bir cümle (yarım kalan bir koşul cümlesi değil — '... satıyorsanız' tek başına YETMEZ); okuyucuya doğrudan hitap eden, 2 saniyede anlaşılan, merak uyandıran ama clickbait olmayan, premium ve sakin bir cümle. Korku dili yok, doğrulanamayan olgusal iddia yok. body: tek kısa cümlelik bağlam.",
  "what-happened":
    "SLAYT 2 — TEŞHİS / KONUNUN ÖZÜ: headline slaytta BÜYÜK BAŞLIK olarak görünür — en fazla 50 karakter, sade Türkçe, tek bir içgörü (etiket gibi değil, anlamlı bir cümle). body: okuyucunun kendi durumunu ayırt edebileceği bir teşhis ya da konunun özü (ör. satışta: ilgi mi yok, ilgi var ama teklif mi yok; arsa alımında: ilk bakılması gerekenler) — kesin hüküm değil, profesyonel değerlendirme dili. En fazla 3 kısa cümle.",
  "why-it-matters":
    "SLAYT 3 — ASIL MESELE (bu mülk türünde ne belirleyici): headline en fazla 50 karakter, büyük başlık. body: talimattaki mülk türüne uyan değerlendirme boyutlarından birkaçıyla Suat'ın uzman bakışını anlat (bir villa/konut yalnızca metrekare ve oda sayısıyla, bir arsa yalnızca büyüklüğü ve fiyatıyla tartılmaz). En fazla 3 kısa cümle. Slayt 2'yi tekrarlama.",
  "what-to-do":
    "SLAYT 4 — NE DEĞİŞİR / NE YAPILMALI: headline en fazla 50 karakter, büyük başlık. facts[]: 3-4 somut madde, her biri en fazla 70 karakterlik tek cümle, rakam yok, talimattaki konuya özgü (satış ise profesyonel satış stratejisinin değiştirdikleri; alım/yatırım ise doğru inceleme adımları; imar/yapılaşma ise hesaplamada ve belgelerde bakılacaklar). body: tek kısa giriş cümlesi.",
  cta: "SLAYT 5 — SUAT'IN UZMAN GÖRÜŞÜ + TEK EYLEM ÇAĞRISI: headline en fazla 50 karakter, büyük başlık — bu konuya özgü tek uzman çıkarımını kendisi söyleyen bir cümle (slayt 1-4'ün özeti DEĞİL; 'asıl soru şu' gibi içeriği başka yere erteleyen başlık değil). body: o çıkarımı 1-2 cümleyle aç, ardından okuyucuyu kendi durumunu (talimattaki konuya göre: mülkünün değeri ve satış stratejisi, arsasının imar durumu ve potansiyeli, yatırım kararı vb.) Suat'la konuşmaya davet eden TEK ölçülü cümle, birinci tekil şahısla ('benimle', 'bana yazabilirsiniz'; 'Suat Kılıç ile' gibi üçüncü şahıs değil). Bu paketteki TEK eylem çağrısıdır.",
};

// Professional evaluation dimensions per property type — the vocabulary of
// real-estate expertise, NOT market data, so the region is more than a place
// name on generic advice. Atlas covers the whole property scope (villa is one
// type, not the default): the writer picks the set that matches the
// instruction.
const PROPERTY_EVALUATION_DIMENSIONS: Record<string, string[]> = {
  "villa / konut": [
    "mikro konum (sokak, ulaşım, çevre dokusu)",
    "müstakil yapı ile site içi yaşam farkı",
    "arsa ve bahçe ilişkisi",
    "mahremiyet",
    "mimari karakter ve fiziksel durum",
    "gerçekten kullanılabilir yaşam alanı",
    "sunum (fotoğraf, ilan metni, gösterim)",
    "aynı alıcının aynı bütçeyle bakabildiği alternatifler",
    "hedef alıcı profili",
  ],
  "arsa / arazi": [
    "imar durumunun resmi kaynaktan (belediye imar durumu belgesi) teyidi",
    "tapu niteliği ve hisseli/müstakil tapu farkı",
    "yola cephe ve ulaşım",
    "eğim, zemin ve topografya",
    "altyapıya (yol, su, elektrik) erişim",
    "parselin şekli ve gerçekten kullanılabilir alanı",
    "hedef kullanım (konut, yatırım, tarım)",
  ],
  "imar / yatırım / inşaat-yapılaşma": [
    "emsal (KAKS) ve TAKS gibi kavramların yapılaşmaya etkisi (oran/sayı vermeden)",
    "çekme mesafeleri ve plan notlarının kullanılabilir alana etkisi",
    "resmi plan ve imar durumu belgesine dayanmanın önemi",
    "maliyet kalemlerini hesaba katma mantığı (rakam vermeden)",
    "yatırım süresi, likidite ve çıkış senaryosu",
  ],
  "piyasa / bölgesel gelişmeler": [
    "aynı bölgedeki benzer mülklerle karşılaştırma mantığı",
    "mikro konum farkları",
    "bölgesel gelişmelerin mülk değerine olası etkisini (uydurmadan) değerlendirme",
  ],
};

// A production review flagged these as unsupported frequency claims and
// consultant jargon in expert copy.
const EXPERT_FREQUENCY_WORDS = ["çoğu zaman", "sık sık", "genellikle", "çoğu", "pek çok", "birçok", "her zaman", "en sık"];
const EXPERT_JARGON = ["rakip grup", "değer önerisi", "segment", "algı yönetimi"];

function buildExpertContentPackagePrompt(): string {
  const geography = ATLAS_DEFAULT_BUSINESS_PROFILE.geography;
  const dimensions = Object.entries(PROPERTY_EVALUATION_DIMENSIONS)
    .map(([type, items]) => `- ${type}: ${items.join("; ")}`)
    .join("\n");

  return `Kimlik: ${SIGNATURE_NAME} (${SIGNATURE_TITLE}) için çalışan profesyonel bir gayrimenkul içerik stratejistisin. Bu bir HABER içeriği DEĞİL: kullanıcının talimatındaki konu için KALICI (evergreen) bir UZMAN İÇERİĞİ üretiyorsun. Okuyucu sonunda "bu danışman bu konuyu ve bu bölgeyi gerçekten biliyor; onunla konuşmalıyım" demeli.

Ses: profesyonel, bilgili, sakin, güvenilir, sade ve insani Türkçe; okuyucuyla yüz yüze konuşan deneyimli bir danışman gibi. ASLA: kurumsal PR dili, yapay zeka dolgu dili, abartı, korku/satış baskısı, "hayatınızı bir üst seviyeye taşıyın" gibi kalıplar, "portföyünüzü bana verin" gibi doğrudan talep. Şu kalıplardan ve yakın varyasyonlarından kaçın: ${AVOIDED_CLICHE_PHRASES.map((p) => `"${p}"`).join(", ")}.
Danışman jargonu kullanma, sade Türkçe karşılığını yaz: ${EXPERT_JARGON.map((p) => `"${p}"`).join(", ")} (ör. "rakip grup" yerine "aynı alıcının aynı bütçeyle bakabildiği benzer mülkler").

Görev: Talimata göre TEK bir yapılandırılmış içerik paketi üret. Yalnızca istenen JSON alanlarını doldur.

Kural — KONU KAPSAMI: Önce talimattaki konuyu ve mülk türünü belirle (villa/konut, arsa/arazi, imar/yatırım, inşaat/yapılaşma, gayrimenkul piyasası/bölgesel gelişme, yatırım eğitimi). Talimat villa demiyorsa villa varsayma; paketin tamamını (slaytlar, caption, hashtag, visualBrief) o konuya göre yaz.

Kural — KİTLE: Talimattaki hedef kitleye TEK kitle olarak yaz. Talimatta olmayan kitleleri (alıcı, yatırımcı, kiracı, kiraya veren, arsa sahibi, yabancı alıcı, genel mülk sahibi vb.) EKLEME — caption dahil hiçbir yerde. Okuyucuya doğrudan hitap et.

Kural — TEK İLERLEYİŞ, TEKRARSIZLIK: okuyucunun sorusu/sorunu (slayt 1) → teşhis / konunun özü (slayt 2) → bu mülk türünde asıl belirleyici olan (slayt 3) → ne değişir / ne yapılmalı (slayt 4) → ${SIGNATURE_NAME}'ın görüşü + tek eylem çağrısı (slayt 5). Her slayt yalnızca kendi işini yapar; aynı fikri iki slaytta ya da slayt + caption'da ana mesaj olarak tekrarlama.

Kural — UZMANLIK, VERİ DEĞİL: Bölge adını genel tavsiyenin başına eklemek yetmez. Uzmanlığı talimattaki konuya uyan profesyonel değerlendirme boyutlarıyla göster (uyanları seç, hepsini zorlama):
${dimensions}
Bunlar piyasa istatistiği değil, bir danışmanın mülke bakış açısıdır.

Kural — OLGU YOK, YORUM VAR (kritik): Doğrulanmış bir kaynak YOK. Hiçbir istatistik, fiyat, oran, süre (ör. ortalama satış süresi), talep/alıcı sayısı, piyasa performansı, mevzuat bilgisi (yürürlük tarihi, oran, zorunluluk) veya doğrulanamayan yerel bilgi YAZMA; rakam kullanma. Bir kavramı (ör. emsal/TAKS) genel olarak açıklayabilirsin ama okuyucuyu kendi durumunun resmi belgesine (imar durumu, tapu kaydı) yönlendir. ContentPackage.facts boş dizi olsun. Şu sıklık/kesinlik ifadelerini KULLANMA: ${EXPERT_FREQUENCY_WORDS.map((p) => `"${p}"`).join(", ")}. Bir gözlem paylaşacaksan açıkça ${SIGNATURE_NAME}'ın kişisel değerlendirmesi olarak ve sıklık iddiası kurmadan yaz ("bence ...", "bir mülke bakarken ilk sorduğum ..."). Sahte deneyim/otorite iddiası ("20 yıllık tecrübemle" gibi) ekleme.

Yerel konumlandırma: ${SIGNATURE_NAME}'ın uzmanlık bölgesi ${geography.primary} ve çevresi (${geography.nearby.join(", ")}). Talimatta geçen bölgeyi doğal biçimde an; bölge hakkında uydurma bilgi verme.

Slayt içerikleri (sıra ve rol sistem tarafından sabittir; yalnızca headline/body/facts/visualBrief doldur). Slayt 2-5'in headline'ları slaytlarda BÜYÜK BAŞLIK olarak görünür; body'ler mobilde okunacak kadar kısa olsun:
${Object.values(EXPERT_SLIDE_ROLE_BRIEF).join("\n")}
visualBrief: SADECE görsel konsept, konuya uygun sahne tarifi (villa/konut ise ör. "olgun ağaçlarla çevrili, geniş bahçeli çağdaş müstakil villa, doğal taş ve ahşap, yumuşak gün ışığı"; arsa/arazi ise ör. "kuzey İstanbul'un ağaçlık, yeşil kırsal dokusunda boş bir arazi parseli, doğal gün ışığı"; imar/yapılaşma ise ör. "mimari vaziyet planı ve maket üzerinde çalışılan sakin bir masa") — ekranda yazı, marka veya logo isteme.

hook: 5-12 kelime, talimattaki hedef kitleye hitap eden kısa açılış cümlesi; slayt 1 headline ile birebir aynı olmasın. Yazım hatası olmasın.

Caption (karuselin tekrarı DEĞİL; slayt cümlelerini yeniden yazma): 2-3 kısa paragraf — kısa bağlam + ${SIGNATURE_NAME}'ın slaytlarda olmayan kişisel bakışı + son paragrafta tek kısa, birinci tekil şahısla konuşma daveti (yeni/ikinci bir eylem önerme; slayt 5'teki davet cümlesini tekrarlama — farklı, daha kişisel bir ifade kullan). Caption baştan sona birinci tekil şahıs; kendinden üçüncü şahısla söz etme. Şu imzayla biter:
${SIGNATURE_NAME}
${SIGNATURE_TITLE}

Hashtag: 5-9 arası, konuya uygun; her biri BOŞLUKSUZ tek kelime (ör. #VillaSatışı veya #ArsaYatırımı, "#villa satışı" değil); bölge etiketi yalnızca talimatta geçen bölge için; jenerik yığın yok; tutarlı yazım.

topic: talimatın kısa özeti. source: {"name": "", "url": "", "publishedAt": ""} — sistem doldurur.`;
}

// Expert packages have no external source: an honest, deterministic
// attribution (never a fabricated citation). Shown in the dashboard
// preview; the carousel does not render a source line for expert content.
function expertSource(): ContentPackage["source"] {
  return { name: `${SIGNATURE_NAME} — uzman değerlendirmesi`, url: "atlas:expert-content", publishedAt: "" };
}

const MIN_INSTRUCTION_LENGTH = 15;
const MAX_INSTRUCTION_LENGTH = 1000;

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

// Expert-mode hashtag repair: a real expert run returned "#villa satışı"
// — a space ends an Instagram hashtag, so the published tag would be
// "#villa". Joins the words in Turkish-aware PascalCase ("#VillaSatışı").
// Expert-only so news packages stay byte-identical.
function joinMultiWordHashtags(hashtags: string[]): string[] {
  return hashtags.map((tag) => {
    const words = tag.replace(/^#/, "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return tag;
    return `#${words.map((w) => w.charAt(0).toLocaleUpperCase("tr-TR") + w.slice(1)).join("")}`;
  });
}

// Expert-mode copy repair for two writer defects that real runs repeated
// despite explicit prompt rules (expert-only; news copy is untouched):
//  - "villa" + possessive misspelled ("Vilanız", "Villianız" for
//    "Villanız") — on the cover, twice in a row;
//  - an adverbial frequency claim ("çoğu zaman", "genellikle", "sık sık",
//    "çoğu kez") with no data behind it. It is reframed as Suat's own view
//    ("bence") — the framing the brief allows — rather than deleted, which
//    would turn it into an even stronger unqualified statement.
const MISSPELLED_VILLA_POSSESSIVE = /\b([Vv])il(?:li)?(anız)/gu;
const ADVERBIAL_FREQUENCY_CLAIM = /(^|[\s(“"'])(çoğu zaman|çoğu kez|genellikle|sık sık)(?=[\s,])/giu;

function normalizeExpertCopy(text: string): string {
  return text
    .replace(MISSPELLED_VILLA_POSSESSIVE, "$1ill$2")
    .replace(ADVERBIAL_FREQUENCY_CLAIM, (_match, lead: string, phrase: string) =>
      `${lead}${/^[ÇGS]/u.test(phrase) ? "Bence" : "bence"}`,
    );
}

// Verified Fact Contract — Job 1's prompt. Deliberately short and
// mechanical: this call's ONLY job is factual classification, never
// hooks/captions/advice/interpretation. See factContract.ts's own
// header comment for why this exists as a separate call rather than
// another instruction inside the editorial prompt.
function buildFactExtractionPrompt(): string {
  return `Görev: SADECE olgusal iddiaları çıkar ve sınıflandır. Sosyal medya metni, başlık, caption, tavsiye veya yorum ÜRETME — bu senin işin değil.

Aşağıda bir KONU/FIRSAT ve aynı gelişmeye ait bir veya birden fazla KAYNAK (K1, K2, ...) verilecek. Kaynak metinlerindeki HER ayrı olgusal iddiayı çıkar (en fazla 12) ve şu üç durumdan birine sınıflandır:
- "current-topic": Kanıtta açıkça belirtilmiş VE verilen konuya doğrudan uygulanır.
- "different-scenario": Kanıtta gerçekten geçer AMA farklı bir koşula/istisnaya/tarafa/senaryoya aittir — verilen konuya doğrudan uygulanmaz.
- "unsupported": Kanıtın açıkça belirtmediği, önerilen/olası bir iddia.

Kurallar:
- Bir sayı/süre/prosedür/yükümlülük geçmesi, onu otomatik olarak "current-topic" yapmaz — SADECE kaynağın o bilgiyi verilen konuya açıkça bağladığı durumda "current-topic" ver.
- Kaynak metninde "[AYRI KOŞUL / SENARYO BLOĞU]" işareti yalnızca yapısal bir ipuçtur — otomatik bir "different-scenario" kararı DEĞİLDİR; işaretten sonraki metin GERÇEKTEN farklı bir senaryoyu tanımlıyorsa "different-scenario" ver, tanımlamıyorsa "current-topic" verebilirsin.
- Kaynağın YAYIM TARİHİ, metin açıkça belirtmedikçe bir yürürlük/başlangıç tarihi değildir; bunu ayrı bir olgu olarak değerlendir.
- Birden fazla kaynak verildiyse hepsi AYNI gelişmeyi anlatır (sistem bunları aynı olay olarak birleştirdi): bir kaynağın başlığı/numarası konudan farklı görünse de onun olguları bu konunun parçasıdır. "different-scenario"yu yalnızca o kaynağın KENDİ metni farklı bir koşul/istisna/tarafı anlatıyorsa ver.
- Her olgu TEK bir kaynaktan gelmeli: farklı kaynaklardaki bilgileri tek bir iddiada/alıntıda BİRLEŞTİRME. İki kaynak birbiriyle çelişiyorsa her birini ayrı olgu olarak çıkar.
- Kaynak metni [S1], [S2], ... şeklinde numaralı bölümlere ayrılmıştır. sentenceIds, iddiayı destekleyen bölüm numaralarıdır (en fazla 3, ardışık; örn. [4] veya [4,5]).
- evidenceFragment, kaynaktan kısa ve BİREBİR alıntı olmalı (numara etiketi hariç) — kelimeleri değiştirme, iki bölümü karıştırma, asla icat edilmiş bir alıntı verme.
- "${SOURCE_CHANGE_LABEL}" etiketli bölümler, kaynağın kendisinin değişiklik olarak işaretlediği hükümlerdir — bu bölümlerdeki olguları mutlaka çıkar.
- claim kısa ve düz bir olgu ifadesi olsun — yorum, tavsiye veya slogan değil.`;
}

function buildFactExtractionUserMessage(
  opportunity: { topic: string; angle: string; whyNow: string },
  formattedBundle: string,
): string {
  return [
    `Konu/Fırsat: ${opportunity.topic}`,
    `Bağlam (yorum, olgu değil): ${opportunity.angle}`,
    // Numbered exact source spans per source (Sentence-Anchored Citation
    // + source identity) — the texts themselves are unmodified; see
    // factContract.ts's segmentBundle/formatBundleForCitation.
    "Kaynak metinleri (numaralı bölümler):",
    formattedBundle,
    "Yukarıdaki kaynak metnindeki olguları çıkar ve sınıflandır.",
  ].join("\n");
}

// Source Intelligence — the evidence bundle Job 1 grounds against: every
// source whose trust role may provide fact evidence (never social
// intelligence) and whose evidence is MEANINGFUL, fact authorities first.
// Thin/absent sources are left out here (the existing thin/none path for
// the primary source still applies when the bundle is empty).
const MAX_BUNDLE_SOURCES = 3;
// "K1", "K2'ye", "(K3)" — a bundle label used as a word in public copy.
const INTERNAL_SOURCE_LABEL_PATTERN = /(?<![\p{L}\d])K[1-9](?![\p{L}\d]|[.,]\d)/u;
const ROLE_LABELS: Record<SourceRole, string> = {
  "fact-authority": "resmi birincil kaynak",
  "discovery-context": "haber/sektör kaynağı — bağlam",
  "social-intelligence": "sosyal medya — olgu kaynağı değil",
};

function buildEvidenceBundle(
  sources: { title: string; publisher: string; url: string; publishedAt: string; tier?: SourceTier; evidenceText?: string }[],
): EvidenceBundleSource[] {
  return orderSourcesByAuthority(sources)
    .filter((source) => mayProvideFactEvidence(sourceRoleFor(source)))
    .filter((source) => source.evidenceText && classifyEvidenceSufficiency(source.evidenceText) === "meaningful")
    .slice(0, MAX_BUNDLE_SOURCES)
    .map((source, index) => ({
      label: `K${index + 1}`,
      title: source.title,
      publisher: source.publisher,
      url: source.url,
      publishedAt: source.publishedAt,
      roleLabel: ROLE_LABELS[sourceRoleFor(source)],
      text: source.evidenceText as string,
    }));
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
  formattedBundle: string,
): Promise<EvidenceFact[] | null> {
  try {
    const completion = await openai.chat.completions.create({
      model: AI_TEXT_MODEL,
      response_format: {
        type: "json_schema",
        json_schema: { name: "evidence_fact_contract", schema: FACT_CONTRACT_JSON_SCHEMA, strict: true },
      },
      // 1200 was live-observed to truncate mid-JSON on a dense, real
      // 4800-char TKGM Genelge (~10 facts of Turkish legal text) — the
      // run then failed closed to title-only copy. Still fails closed on
      // any truncation; this only gives a complete answer room to fit.
      // Raised again for multi-source bundles (up to 3 sources, 12 facts).
      max_completion_tokens: 3600,
      messages: [
        { role: "system", content: buildFactExtractionPrompt() },
        { role: "user", content: buildFactExtractionUserMessage(opportunity, formattedBundle) },
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
  | { mode: "verified"; facts: EvidenceFact[]; sources: EvidenceBundleSource[] }
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
    // Turkey-local calendar date, never the raw UTC instant — see
    // turkishDate.ts's toTurkeyCalendarDate for the live-observed
    // one-day-early defect this prevents.
    const sourceDate = formatTurkeyDateDMY(source.publishedAt) ?? source.publishedAt;
    lines.push(`Kaynak: ${source.publisher} — ${source.url} — ${sourceDate}`);
    // Source Intelligence: same-event related sources, each with its own
    // identity — facts below carry the label of the ONE source they come from.
    if (evidence.mode === "verified" && evidence.sources.length > 1) {
      for (const bundleSource of evidence.sources) {
        lines.push(
          `${bundleSource.label}: ${bundleSource.publisher} — "${bundleSource.title}" — ${formatTurkeyDateDMY(bundleSource.publishedAt) ?? bundleSource.publishedAt} (${bundleSource.roleLabel})`,
        );
      }
      lines.push(
        "K1/K2/K3 yalnızca SİSTEM İÇİ etiketlerdir — paketin hiçbir metninde (hook, caption, slaytlar, facts) ASLA kullanma; kaynağı adıyla an (ör. \"TKGM duyurusuna göre\"). Bu kaynaklar AYNI gelişmeyi anlatır. Farklı kaynaklardaki olguları tek bir alıntı/iddia gibi birleştirme; bir kaynak değişikliği açıkça anlatıyorsa (ör. \"Bu kez ...\") değişikliği ONDAN anlat. Kaynaklar çelişirse kesinlik uydurma — ikisini ayrı ayrı belirt.",
      );
    }

    if (evidence.mode === "verified") {
      // Verified Fact Contract: this is now the ONLY factual boundary
      // for meaningful evidence — the editorial call never sees the
      // full raw document, only the facts Job 1 already confirmed
      // apply to THIS topic.
      lines.push("KANIT DURUMU: YETERLİ (DOĞRULANMIŞ OLGULAR)");
      lines.push(
        "DOĞRULANMIŞ OLGULAR — SADECE bunlar mevcut konu için kesin olgu kaynağıdır; bunların DIŞINDA kaynaktan başka bir kesin tarih/tutar/prosedür/yükümlülük EKLEME:",
      );
      // Source Change Markers: only when the source itself marks an
      // amendment (deterministic — see factContract.ts's
      // markSourceChanges); otherwise this block is byte-for-byte as before.
      const changeFacts = evidence.facts.filter((fact) => fact.changedBySource);
      const sourceTag = (fact: EvidenceFact) =>
        evidence.sources.length > 1 && fact.sourceIndex !== undefined ? `[${evidence.sources[fact.sourceIndex].label}] ` : "";
      const formatFact = (fact: EvidenceFact) => `- ${sourceTag(fact)}${fact.claim} (kanıt: "${fact.evidenceFragment}")`;
      if (changeFacts.length > 0) {
        // Two separate sections — structure, not a softer inline hint: a
        // live run showed inline labels alone still let Job 2 headline a
        // background rule as the news.
        lines.push(
          `NE DEĞİŞTİ — kaynağın KENDİSİNİN değişiklik olarak işaretlediği hükümler [${SOURCE_CHANGE_LABEL}]. Haberin özü budur: hook, slide 1 ve slide 2 (what-happened) BU değişikliği anlatmalı:`,
        );
        for (const fact of changeFacts) lines.push(formatFact(fact));
        lines.push(
          `ARKA PLAN — zaten yürürlükte olan kurallar, bu duyurunun getirdiği değişiklik DEĞİL. Bağlam ve "ne yapmalı" için kullanılabilir; ama "artık", "yeni", "değişti", "kaldırıldı", "netleşti" gibi ifadelerle yeni bir gelişmeymiş gibi SUNULAMAZ:`,
        );
        for (const fact of evidence.facts.filter((fact) => !fact.changedBySource)) lines.push(formatFact(fact));
      } else {
        for (const fact of evidence.facts) lines.push(formatFact(fact));
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
        `Bu kaynak için ayrıntılı doğrulanmış bilgi YOK; yalnızca başlık düzeyinde bilgi var say. Tarih, tutar, belge zorunluluğu, işlem sonucu, yüzde, ücret, istatistik gibi HİÇBİR kesin ayrıntıyı UYDURMA. Yayım tarihi (${sourceDate}) bir yürürlük/başlangıç/son tarihi OLARAK sunulamaz.`,
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

  const {
    contentOpportunity: rawContentOpportunity,
    visualFormat: rawVisualFormat,
    instruction: rawInstruction,
  } = body as {
    contentOpportunity?: unknown;
    visualFormat?: unknown;
    instruction?: unknown;
  };

  // A Radar opportunity (news mode) or, for the dashboard's "Instagram
  // paylaşımı hazırla", the user's own instruction (expert mode — see
  // buildExpertContentPackagePrompt). An instruction becomes an honest,
  // source-less opportunity: no sources means no Job 1 and no evidence,
  // so nothing can be presented as verified.
  const instruction = typeof rawInstruction === "string" ? rawInstruction.trim() : "";
  let contentOpportunity: ContentOpportunity;
  let contentMode: "news" | "expert";
  if (isContentOpportunity(rawContentOpportunity)) {
    contentOpportunity = rawContentOpportunity;
    contentMode = "news";
  } else if (instruction.length >= MIN_INSTRUCTION_LENGTH && instruction.length <= MAX_INSTRUCTION_LENGTH) {
    contentOpportunity = {
      topic: instruction,
      angle: "Kullanıcı talimatına göre kalıcı uzman içeriği",
      whyNow: "Kalıcı uzman içeriği — güncel bir kaynağa dayanmıyor",
      keyFacts: [],
      sources: [],
      freshness: "evergreen-adjacent",
    };
    contentMode = "expert";
  } else {
    return jsonError("Geçerli bir içerik fırsatı veya en az 15 karakterlik bir talimat gerekli.", 400);
  }

  // Authoritative, never re-decided by the model — see Section 7 of the
  // Gold Standard brief and contentPackage.ts's own validator, which
  // rejects anything that doesn't match this exact slide count.
  if (!isVisualFormat(rawVisualFormat)) {
    return jsonError("Geçerli bir görsel format seçimi gerekli.", 400);
  }
  const format = rawVisualFormat;
  const expectedSlideCount = format === "carousel" ? 5 : 1;

  let openai: ReturnType<typeof getOpenAITextClient>;
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

  // Source Intelligence — multi-source evidence bundle: every source of
  // this opportunity whose trust role may provide fact evidence (fact
  // authority / discovery-context, never social) AND whose evidence is
  // MEANINGFUL, fact authorities first, max MAX_BUNDLE_SOURCES. Each keeps
  // its own identity; see factContract.ts's groundBundleFacts.
  const evidenceBundle = buildEvidenceBundle(contentOpportunity.sources);

  if (evidenceBundle.length > 0) {
    const bundleSegments = segmentBundle(evidenceBundle);
    const verifiedFacts = await extractVerifiedFacts(
      openai,
      contentOpportunity,
      formatBundleForCitation(evidenceBundle, bundleSegments),
    );
    // Per source, unchanged and in the same order as the single-source
    // pipeline: citation rescue → Gap 1 (exact quote in THAT source) →
    // Scenario Boundary rule (THAT source's zones) → source change markers.
    // A fact that can't be tied to exactly one source is dropped.
    const resolvedFacts = verifiedFacts ? groundBundleFacts(verifiedFacts, evidenceBundle, bundleSegments) : [];
    // Observability (Section 10): counts only, never evidence content.
    console.log(
      `Fact contract: sources=${evidenceBundle.length} extracted=${verifiedFacts?.length ?? 0} grounded=${resolvedFacts.length} perSource=${evidenceBundle
        .map((_, i) => resolvedFacts.filter((fact) => fact.sourceIndex === i).length)
        .join("/")} sourceChanges=${resolvedFacts.filter((fact) => fact.changedBySource).length} failClosed=${verifiedFacts === null}`,
    );
    evidencePresentation =
      resolvedFacts.length > 0
        ? { mode: "verified", facts: resolvedFacts, sources: evidenceBundle }
        : { mode: "thin-or-none", rawEvidenceText: undefined };
  } else if (sufficiency === "thin") {
    evidencePresentation = { mode: "thin-or-none", rawEvidenceText: primarySource?.evidenceText };
  } else {
    evidencePresentation = { mode: "thin-or-none", rawEvidenceText: undefined };
  }

  const systemMessage =
    contentMode === "expert"
      ? [SYSTEM_PROMPT, buildExpertContentPackagePrompt()].join("\n\n")
      : [SYSTEM_PROMPT, buildResearchDirective(contentOpportunity), buildContentPackagePrompt(30)].join("\n\n");
  const userMessage =
    contentMode === "expert"
      ? `KULLANICI TALİMATI: ${instruction}\nİÇERİK TÜRÜ: kalıcı uzman içeriği — doğrulanmış kaynak ve olgu YOK.`
      : buildUserMessage(contentOpportunity, evidencePresentation);
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

  const verifiedFacts = evidencePresentation.mode === "verified" ? evidencePresentation.facts : [];
  const verifiedClaims = verifiedFacts.map((f) => f.claim);
  const trustedTokens = new Set<string>(trustedSourceMetadataTokens(primarySource));
  if (evidencePresentation.mode === "verified") {
    for (const bundleSource of evidencePresentation.sources) {
      for (const token of trustedSourceMetadataTokens(bundleSource)) trustedTokens.add(token);
    }
  }

  // One assembly path for BOTH Job 2's package and the editorial
  // revision (below), so a revision can never skip a normalization step.
  const copy = contentMode === "expert" ? normalizeExpertCopy : (text: string) => text;
  const assemblePackage = (model: ModelPackage): ContentPackage => ({
    topic: model.topic,
    // Expert content has no external source — deterministic, honest
    // attribution, never the model's own text.
    source: contentMode === "expert" ? expertSource() : model.source,
    ...(contentMode === "expert" ? { contentMode } : {}),
    hook: copy(model.hook),
    caption: ensureSignature(copy(model.caption)),
    hashtags: (contentMode === "expert" ? joinMultiWordHashtags : (tags: string[]) => tags)(
      sanitizeLocalityHashtags(model.hashtags, contentOpportunity.topic, verifiedClaims),
    ),
    // Stamp the deterministic index/role sequence and the caller's own
    // format choice — never read from the model's own output.
    format,
    slides: model.slides.map((slide, i) => ({
      index: i + 1,
      role: roleSequence[i],
      headline: copy(slide.headline),
      body: copy(slide.body),
      facts: slide.facts.map(copy),
      visualBrief: slide.visualBrief,
    })),
    // Deterministic Calendar-Date Fact Sanitizer: strips the exact
    // proven invalid pattern (a date decomposed into role="component"
    // facts) before validation runs, so this specific model mistake
    // degrades to a smaller/possibly-empty facts[] rather than failing
    // the whole package.
    facts: sanitizeCalendarDateFacts(model.facts),
  });

  // One safety path for both, too: returns the first failure reason, or
  // null when the package passes every deterministic check.
  const findSafetyViolation = (candidate: ContentPackage): string | null => {
    const validation = validateContentPackage(candidate);
    if (!validation.ok) return `validation: ${validation.reason}`;
    // Source Intelligence: the bundle's internal source labels (K1, K2, ...)
    // must never reach public copy — a real, live-observed leak ("K1'e
    // göre ..."). Fails closed like every other check here.
    if (evidencePresentation.mode === "verified" && evidencePresentation.sources.length > 1) {
      const publicText = [
        candidate.hook,
        candidate.caption,
        ...candidate.slides.flatMap((slide) => [slide.headline, slide.body, ...slide.facts]),
      ].join("\n");
      const leaked = publicText.match(INTERNAL_SOURCE_LABEL_PATTERN);
      if (leaked) return `internal source label in copy: "${leaked[0]}"`;
    }
    // Verified Token-to-Claim Binding Check (Gap 2, narrow slice): only
    // meaningful when there's a verified fact set to bind against — a
    // proven, live-observed defect where Job 2 combined a date verified
    // under one fact with a different fact's subject inside one slide's
    // facts[] string, asserting a claim neither fact actually made.
    // trustedTokens: the primary source's own publishedAt/title are
    // handed to Job 2 directly in the prompt — stating them back is not
    // an unverified claim.
    if (evidencePresentation.mode === "verified") {
      const slideFactStrings = candidate.slides.flatMap((slide) => slide.facts);
      const bindingViolations = findTokenBindingViolations(verifiedFacts, slideFactStrings, trustedTokens);
      if (bindingViolations.length > 0) return `token-binding: ${bindingViolations.join(" | ")}`;
    }
    return null;
  };

  const contentPackage = assemblePackage(modelPackage);
  const violation = findSafetyViolation(contentPackage);
  if (violation) {
    console.error("Content package failed deterministic checks:", violation);
    return jsonError("Oluşturulan içerik paketi doğrulamadan geçemedi. Lütfen tekrar deneyin.", 502);
  }

  // Editorial Quality Repair (final step, max ONE attempt) — see
  // editorialRevision.ts. Never blocks: any failure keeps the original,
  // which has already passed every check above.
  const { finalPackage, outcome } = await runEditorialQualityRepair(contentPackage);
  console.log(
    `Editorial gate: verdict=${outcome.verdict} categories=${outcome.failCategories.join(",") || "-"} revisionTriggered=${outcome.triggered}${
      outcome.triggered ? ` revisionAccepted=${outcome.accepted}` : ""
    }${outcome.reason ? ` reason=${outcome.reason}` : ""}`,
  );

  const provenance =
    evidencePresentation.mode === "verified"
      ? {
          sources: evidencePresentation.sources.map(({ label, title, publisher, url, publishedAt, roleLabel }) => ({
            label,
            title,
            publisher,
            url,
            publishedAt,
            role: roleLabel,
          })),
          facts: evidencePresentation.facts.map((fact) => ({
            claim: fact.claim,
            source: fact.sourceIndex !== undefined ? evidencePresentation.sources[fact.sourceIndex].label : null,
            changedBySource: Boolean(fact.changedBySource),
          })),
        }
      : null;

  return Response.json({ contentPackage: finalPackage, editorialRevision: outcome, provenance });

  async function runEditorialQualityRepair(
    original: ContentPackage,
  ): Promise<{ finalPackage: ContentPackage; outcome: EditorialRevisionOutcome }> {
    // OFF unless explicitly enabled: live-measured (2026-10-17, 4 gated
    // TKGM runs) it did not raise independent Quality Gate scores and once
    // widened a rule's audience — a semantic change no deterministic guard
    // here can detect. Disabled = exactly the pre-revision pipeline.
    if (process.env.EDITORIAL_REVISION_ENABLED !== "true") {
      return { finalPackage: original, outcome: { triggered: false, verdict: "DISABLED", failCategories: [] } };
    }
    let gate: EditorialGateResult & { revised: ModelPackage | null };
    try {
      const completion = await openai.chat.completions.create({
        model: CONTENT_PACKAGE_EDITORIAL_MODEL,
        response_format: {
          type: "json_schema",
          json_schema: { name: EDITORIAL_GATE_SCHEMA_NAME, schema: EDITORIAL_GATE_JSON_SCHEMA, strict: true },
        },
        max_completion_tokens: 6000,
        messages: [
          { role: "system", content: buildEditorialGatePrompt() },
          { role: "user", content: buildEditorialGateUserMessage(userMessage, original) },
        ],
      });
      const raw = completion.choices[0]?.message?.content;
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (!isEditorialGateResult(parsed)) throw new Error("malformed gate response");
      gate = parsed as EditorialGateResult & { revised: ModelPackage | null };
    } catch (error) {
      return {
        finalPackage: original,
        outcome: {
          triggered: false,
          verdict: "UNAVAILABLE",
          failCategories: [],
          reason: error instanceof Error ? error.message : String(error),
        },
      };
    }

    if (!shouldRevise(gate)) {
      return {
        finalPackage: original,
        outcome: {
          triggered: false,
          verdict: gate.verdict,
          failCategories: gate.failCategories,
          reason: gate.verdict === "FAIL" ? "non-revisable category — original kept for review" : undefined,
        },
      };
    }

    const reject = (reason: string) => ({
      finalPackage: original,
      outcome: { triggered: true as const, verdict: "FAIL" as const, failCategories: gate.failCategories, accepted: false, reason },
    });
    const revisedModel = gate.revised;
    if (!revisedModel || !Array.isArray(revisedModel.slides) || revisedModel.slides.length !== expectedSlideCount) {
      return reject("revision missing or wrong slide count");
    }
    // topic/source are never the revision's to change.
    const revised = assemblePackage({ ...revisedModel, topic: original.topic, source: original.source });
    const revisedViolation = findSafetyViolation(revised);
    if (revisedViolation) return reject(revisedViolation);
    const newTokens = findNewFactTokens(original, revised, verifiedFacts, trustedTokens);
    if (newTokens.length > 0) return reject(`new fact tokens: ${newTokens.join(", ")}`);

    return {
      finalPackage: revised,
      outcome: { triggered: true, verdict: "FAIL", failCategories: gate.failCategories, accepted: true },
    };
  }
}
