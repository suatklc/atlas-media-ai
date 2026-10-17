import type { ContentPackage } from "./contentPackage";
import { extractNotableTokens, spellOutDurationsToDigits, type EvidenceFact } from "./factContract";

// ============================================================
// Editorial Quality Repair — the FINAL step of /api/content-package, not
// a second content pipeline (approved by Suat, 2026-10-17). After Job 2's
// package has already passed every deterministic check, ONE combined
// gate+revise call judges it against the Editorial Quality Gate
// (.claude/skills/atlas-editorial-quality-gate) and — only when it FAILS
// for a wording-level reason — returns a rewritten package. The revision
// may rewrite, shorten, reorder or de-duplicate wording; it may never add a
// factual claim. Its output is re-assembled and re-checked exactly like
// the original (validateContentPackage, Gap 2 token binding) PLUS
// findNewFactTokens below; any failure discards it and the already-safe
// original is returned. Exactly one attempt — never a loop. Grounding
// (Job 1, Gap 1, Scenario Boundary, source change markers) is upstream
// and untouched: the revision only ever sees facts that already survived
// it. Approval/publishing is unaffected — this only edits a draft's text.
// ============================================================

export const EDITORIAL_GATE_SCHEMA_NAME = "editorial_gate";

// Wording-level failures — the only ones a revision may repair.
// "novelty-framing" (background presented as new) is a wording fix: the
// facts stay, only the "artık/yeni" framing changes.
export const REVISABLE_CATEGORIES = ["writing", "readability", "repetition", "style", "novelty-framing"] as const;
// Never repaired by rewriting — a factual/audience problem is a grounding
// signal, so the original (which already passed every deterministic check)
// is kept and the concern is logged for review.
export const NON_REVISABLE_CATEGORIES = ["factual", "audience"] as const;
export const GATE_CATEGORIES = [...REVISABLE_CATEGORIES, ...NON_REVISABLE_CATEGORIES] as const;
export type GateCategory = (typeof GATE_CATEGORIES)[number];

export type EditorialGateResult = {
  verdict: "PASS" | "FAIL";
  failCategories: GateCategory[];
  issues: string[];
};

// What the route logs and returns — counts/categories only, never content.
export type EditorialRevisionOutcome =
  | { triggered: false; verdict: "PASS" | "UNAVAILABLE" | "FAIL" | "DISABLED"; failCategories: GateCategory[]; reason?: string }
  | {
      triggered: true;
      verdict: "FAIL";
      failCategories: GateCategory[];
      accepted: boolean;
      reason?: string;
    };

export function isEditorialGateResult(value: unknown): value is EditorialGateResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.verdict === "PASS" || v.verdict === "FAIL") &&
    Array.isArray(v.failCategories) &&
    v.failCategories.every((c) => (GATE_CATEGORIES as readonly string[]).includes(c as string)) &&
    Array.isArray(v.issues) &&
    v.issues.every((i) => typeof i === "string")
  );
}

// Revise only on a FAIL whose every category is wording-level. Any
// factual/audience category blocks revision entirely (keep the original).
export function shouldRevise(gate: EditorialGateResult): boolean {
  if (gate.verdict !== "FAIL" || gate.failCategories.length === 0) return false;
  return gate.failCategories.every((c) => (REVISABLE_CATEGORIES as readonly string[]).includes(c));
}

function packageText(pkg: Pick<ContentPackage, "hook" | "caption" | "slides">): string {
  return [pkg.hook, pkg.caption, ...pkg.slides.flatMap((s) => [s.headline, s.body, ...s.facts])].join("\n");
}

function tokensOf(text: string): Set<string> {
  return new Set([...extractNotableTokens(text), ...extractNotableTokens(spellOutDurationsToDigits(text))]);
}

// The deterministic "no new factual claims" guard: every notable token
// (date, amount, duration, legal reference, percentage, large number) in
// the revised text must already exist in the original package, the
// verified facts, or trusted source metadata. A revision may drop or move
// a number; it may never introduce one.
export function findNewFactTokens(
  original: ContentPackage,
  revised: ContentPackage,
  verifiedFacts: EvidenceFact[],
  trustedTokens: Set<string>,
): string[] {
  const allowed = new Set<string>([
    ...tokensOf(packageText(original)),
    ...verifiedFacts.flatMap((fact) => [...tokensOf(`${fact.claim} ${fact.evidenceFragment}`)]),
    ...trustedTokens,
  ]);
  return [...extractNotableTokens(packageText(revised))].filter((token) => !allowed.has(token));
}

export function buildEditorialGatePrompt(): string {
  return `Görev: Sen Atlas'ın EDİTORYAL KALİTE KAPISISIN. Tek soru: "Suat Kılıç (Gayrimenkul Yatırım Danışmanı) bu içeriği profesyonel hesabında HİÇ DÜZENLEMEDEN yayımlar mı?"

Verilen içerik paketi tüm olgusal/güvenlik kontrollerinden ZATEN geçti. Senin işin yazım kalitesi.

FAIL kategorileri (birden fazla seçilebilir):
- "writing": dilbilgisi hatası, ters/çelişkili anlam taşıyan cümle, doğal olmayan ifade.
- "readability": resmi/bürokratik dil, kaynaktan kopyalanmış tanım cümleleri, gereksiz uzun cümle.
- "repetition": aynı fikir/kural birden fazla slaytta veya caption'da ana mesaj olarak tekrar ediyor; slayt 5 slayt 1-4'ü özetliyor.
- "style": jenerik/kalıp ifade (başka her konuya uyacak cümle, "sadece X değil Y" kalıbı, "süreç daha öngörülebilir"), zayıf hook (değişikliği söylemiyor, okuyucuya hitap etmiyor), boş kontrol listesi maddesi, eksik ya da doğal olmayan eylem çağrısı.
- "novelty-framing": "ARKA PLAN" olgusu "artık/yeni/değişti/kaldırıldı/netleşti" gibi yeni bir gelişmeymiş gibi sunulmuş; ya da "NE DEĞİŞTİ" değişikliği hook/slayt 1/slayt 2'de yok.
- "factual": verilen olgularda olmayan bir iddia. (Bunu YENİDEN YAZARAK düzeltme — sadece işaretle.)
- "audience": bir kuralın uygulandığı kitle yanlış/genişletilmiş. (Bunu da sadece işaretle.)

Ayrıca şunların HER BİRİNİ tek tek kontrol et (biri bile varsa FAIL; şüphede FAIL):
- Kitle: hook ve caption'ın ilk cümlesi kuralın KİME uygulandığını açıkça söylüyor mu? Sadece belirli bir kitleye uygulanan bir kural herkes içinmiş gibi yazılmışsa → "style" (+ kitle genişletilmişse "audience").
- Benzer olgular: NE DEĞİŞTİ ile ARKA PLAN'da aynı sayı/süre/kavram geçiyorsa metin hangisinin YENİ hükmün, hangisinin MEVCUT kuralın olduğunu açıkça ayırıyor mu? "X kuralı değişti" gibi belirsiz ifade, değişen hükmü tam söylemiyorsa → "novelty-framing".
- Değişikliğin ayırt edici kelimeleri (ör. "herhangi bir", "artık ... da") NE DEĞİŞTİ olgusundaki gibi korunmuş mu? Kaybolmuşsa → "novelty-framing".
- Kısaltmalar: hiç açılmamış teknik kısaltma (ilk geçtiği yerde, kaynak olgularındaki tam adıyla açılmalı) → "readability".
- Tanım kopyası: "... dokümandır", "... ifade eder" gibi kaynak tanım cümlesi → "readability".
- Tekrar: aynı tavsiye/fikir (ör. "tarihleri kontrol edin") birden fazla slaytta veya caption'da ana mesaj → "repetition".
- Geçmiş tarih aralığına ait bir kural bugünkü okuyucu için kontrol maddesi gibi sunulmuşsa → "style".

Karar:
- Hiçbir sorun yoksa verdict="PASS", failCategories=[], revised=null.
- Sorun varsa verdict="FAIL", failCategories ve issues (kısa, somut; alıntıyla) doldur.
- failCategories YALNIZCA writing/readability/repetition/style/novelty-framing içeriyorsa "revised" alanına DÜZELTİLMİŞ TAM paketi yaz. "factual" veya "audience" varsa revised=null.

Revizyon kuralları (KESİN):
- Yalnızca yeniden yaz, kısalt, sırala, tekrarı kaldır. YENİ OLGU EKLEME: verilen pakette veya DOĞRULANMIŞ OLGULARDA olmayan hiçbir tarih, tutar, süre, yüzde, belge, prosedür, yükümlülük, istisna, sonuç veya kitle ekleme.
- "NE DEĞİŞTİ" anlamını koru: değişiklik hook'ta, slayt 1 ve slayt 2'de kalmalı; değişen hükmü ayırt edici kelimeleriyle TAM söyle. ARKA PLAN olgularını yeni gibi sunma; benzer bir ARKA PLAN kuralı anılıyorsa "mevcut kural" / "zaten" diye açıkça ayır.
- Kitleyi hook'ta ve caption'ın ilk cümlesinde açıkça söyle. Teknik kısaltmayı ilk geçtiği yerde, kaynak olgularındaki tam adıyla bir kez aç.
- Her tavsiye/fikir paketin TAMAMINDA yalnızca bir kez ana mesaj olsun; slayt 3, slayt 5 ve caption her biri farklı bir şey söylesin. Geçmiş tarih aralığına ait kuralları bugünkü okuyucu için kontrol maddesi yapma.
- Tam olarak aynı slayt sayısı ve sırası (hook, what-happened, why-it-matters, what-to-do, cta). topic ve source alanlarını AYNEN koru.
- Her slaytın facts[] dizisinde yalnızca doğrulanmış olgulardan birebir veya sadeleştirilmiş ifadeler olsun; iki farklı olgunun sayısını tek cümlede birleştirme.
- Uzman yorumu yorum olarak çerçevelensin ("bence", "sahada gördüğüm"); sahte deneyim/istatistik iddiası yok.
- hook 5-12 kelime, değişikliği söylesin, okuyucuya hitap etsin. Slayt 4 maddeleri gerçek kontroller olsun. Slayt 5 bu değişikliğe özgü tek bir uzman çıkarımı + ölçülü eylem çağrısı. Caption slaytları tekrar anlatmasın; imzadan önce ölçülü tek bir eylem çağrısı; imza: "Suat Kılıç\\nGayrimenkul Yatırım Danışmanı".
- Doğal, akıcı, dilbilgisi doğru Türkçe. Hashtag 5-9, konuya uygun.`;
}

export function buildEditorialGateUserMessage(evidenceSection: string, original: ContentPackage): string {
  const { topic, source, hook, caption, hashtags, slides, facts } = original;
  const modelShape = {
    topic,
    source,
    hook,
    caption,
    hashtags,
    slides: slides.map(({ headline, body, facts: slideFacts, visualBrief }) => ({ headline, body, facts: slideFacts, visualBrief })),
    facts,
  };
  return [
    "KAYNAK OLGULARI (paket bunlarla üretildi):",
    evidenceSection,
    "",
    "DEĞERLENDİRİLECEK İÇERİK PAKETİ (JSON):",
    JSON.stringify(modelShape),
  ].join("\n");
}
