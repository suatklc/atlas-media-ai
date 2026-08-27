import type { AudienceType, ContentIntent } from "../content/types";
import type { ContentOpportunity, ResearchSource, SourceTier } from "./types";

const VALID_FRESHNESS = new Set(["breaking", "recent", "evergreen-adjacent"]);
const VALID_TIERS = new Set([
  "official-authority",
  "primary-data",
  "financial-news",
  "specialist",
  "commentary",
]);

function isResearchSource(value: unknown): value is ResearchSource {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.title === "string" &&
    typeof v.publisher === "string" &&
    typeof v.url === "string" &&
    typeof v.publishedAt === "string" &&
    typeof v.tier === "string" &&
    VALID_TIERS.has(v.tier)
  );
}

// Untrusted-input guard for a client/caller-supplied ContentOpportunity —
// same defensive posture as every other client-supplied field in this
// pipeline (isPlatformId, sanitizeHeadline, etc). Deliberately coarse on
// audience/suggestedContentType/riskCaveat (string-or-absent only, no enum
// check against content/types.ts): they only ever shape wording hints in
// buildSeedMessage/buildResearchDirective below, never a security- or
// data-integrity-relevant decision, so a stricter check would add
// complexity without reducing real risk.
export function isContentOpportunity(value: unknown): value is ContentOpportunity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (typeof v.topic !== "string" || !v.topic.trim()) return false;
  if (typeof v.angle !== "string" || !v.angle.trim()) return false;
  if (typeof v.whyNow !== "string") return false;
  if (!Array.isArray(v.keyFacts) || !v.keyFacts.every((f) => typeof f === "string")) return false;
  if (!Array.isArray(v.sources) || !v.sources.every(isResearchSource)) return false;
  if (typeof v.freshness !== "string" || !VALID_FRESHNESS.has(v.freshness)) return false;
  if (v.audience !== undefined && typeof v.audience !== "string") return false;
  if (v.riskCaveat !== undefined && typeof v.riskCaveat !== "string") return false;
  if (v.suggestedContentType !== undefined && typeof v.suggestedContentType !== "string") return false;

  return true;
}

// --- buildSeedMessage ---
//
// Renders a ContentOpportunity as one natural Turkish message so it can
// enter the EXISTING buildContentPlan()/buildCreativeBrief() pipeline
// exactly as a human-typed chat message would — no new parsing path, no
// change to either function, no parallel classification logic. The hints
// below are wording nudges only: they reuse real trigger words the
// existing classifiers (content/intent.ts's SUBJECT_SIGNALS, content/
// audience.ts's signal lists) already key on, but detectContentIntent and
// resolveAudience remain the sole authority on the final ContentPlan —
// nothing here inspects or overrides their output.
const INTENT_HINTS: Partial<Record<ContentIntent, string>> = {
  listing: "satılık fırsatları öne çıkaran",
  educational: "bilgilendirici ve eğitici",
  comparison: "karşılaştırmalı",
  "market-stats": "piyasa istatistiklerine dayanan",
  announcement: "duyuru niteliğinde",
};

// Record (not Partial<Record>) over the closed AudienceType enum forces
// compile-time exhaustiveness, same pattern creative/lookups.ts already
// uses for its own audience-keyed tables.
const AUDIENCE_LABELS: Record<AudienceType, string> = {
  "luxury-home-buyer": "lüks segment alıcılar",
  "villa-buyer": "villa alıcıları",
  "land-investor": "arsa yatırımcıları",
  "property-owner": "mülk sahipleri",
  "first-time-home-buyer": "ilk kez ev alacaklar",
  "commercial-investor": "ticari yatırımcılar",
  "general-buyer": "genel alıcı kitlesi",
};

export function buildSeedMessage(opportunity: ContentOpportunity): string {
  const intentHint = opportunity.suggestedContentType ? INTENT_HINTS[opportunity.suggestedContentType] : undefined;

  const opener = [intentHint, `${opportunity.topic} hakkında güncel gelişmelere dayanan içerik hazırla.`]
    .filter(Boolean)
    .join(" ");

  const sentences: string[] = [opener, `Açı: ${opportunity.angle}.`];

  if (opportunity.audience) {
    sentences.push(`Hedef kitle bağlamı: ${AUDIENCE_LABELS[opportunity.audience]}.`);
  }
  if (opportunity.whyNow) {
    sentences.push(`Güncellik nedeni: ${opportunity.whyNow}.`);
  }
  if (opportunity.keyFacts.length > 0) {
    sentences.push(`Bilinmesi gerekenler: ${opportunity.keyFacts.join("; ")}.`);
  }

  return sentences.join(" ").trim();
}

// --- buildResearchDirective ---
//
// Pure string assembly only — no matching/derivation logic, no history
// access, never mutates its input. Same shape as content/directive.ts and
// creative/directive.ts: an internal header the model is told not to
// repeat, a hard character cap, and safe truncation that drops whole
// trailing (least-critical) lines rather than slicing mid-string. Unlike
// those two, there is no "no-op" input case — a ContentOpportunity always
// carries at least a topic, so this always returns a non-empty directive.
// Raised from 900 (Grounded Content Safety): the new fact/interpretation
// framework and social-copy-voice lines below are both required, protected
// content — the previous budget would have forced them out via the
// safe-truncation loop on nearly every real opportunity. Still a hard cap,
// still safely truncated by dropping whole trailing (lowest-priority) lines
// first, never mid-string.
const MAX_DIRECTIVE_CHARS = 2200;

const TIER_LABELS: Record<SourceTier, string> = {
  "official-authority": "resmi/kamu otoritesi",
  "primary-data": "birincil veri kaynağı",
  "financial-news": "saygın finans/haber kaynağı",
  specialist: "güvenilir uzman kaynağı",
  commentary: "ikincil yorum/görüş",
};

function formatSource(source: ResearchSource): string {
  return `${source.publisher} (${source.publishedAt}, ${TIER_LABELS[source.tier]})`;
}

export function buildResearchDirective(opportunity: ContentOpportunity): string {
  const lines: string[] = [
    "[Dahili araştırma zemini — bu istek için, yanıtta tekrar etme]",
    `Konu: ${opportunity.topic}; güncellik: ${opportunity.freshness}`,
  ];

  if (opportunity.riskCaveat) {
    lines.push(`Dikkat notu (mutlaka yansıt): ${opportunity.riskCaveat}`);
  }

  // The single load-bearing anti-fabrication rule — always present,
  // protected by requiredLineCount below regardless of truncation: covers
  // source-attribution, date preservation, no invented statistics/claims,
  // no timeless-izing of current/uncertain information, and predictions
  // vs. established facts in one line so it can never be dropped alone.
  lines.push(
    "Olgusal bilgiyi yalnızca sağlanan kaynaklara dayandır; 'X, Y tarihinde yayımlanan kaynağa göre...' biçiminde referans ver; tarihleri koru; kaynakların içermediği hiçbir istatistik, rakam veya iddia uydurma; güncel/değişken bilgiyi zamansız kesin gerçek gibi sunma; tahmin ve öngörüleri kesin olgudan açıkça ayır.",
  );

  // Fact vs. interpretation framework (Grounded Content Safety): the line
  // above stops invented statistics/dates; this stops a subtler failure —
  // stating an unsupported LEGAL/PROCEDURAL claim as if the source itself
  // established it (e.g. a headline about a title-deed dispute topic being
  // silently expanded into "a TAKBİS query definitively reveals whether a
  // property has a lawsuit/lien", which the source never said). Both lines
  // are required and protected by requiredLineCount below — this is the
  // core of Part 1's grounding requirement, not an optional refinement.
  lines.push(
    "Kaynağın açıkça belirttiği olguları kesin olgu olarak sun; kaynağın ötesine geçen her çıkarım veya yorumu 'Bu gelişme ... gündeme getiriyor/gösteriyor' gibi açıkça yorum/çerçeveleme ifadesiyle ayır. Kaynakta yer almayan hiçbir hukuki sonuç, prosedür, hak, istatistik, eşik değeri veya mevzuat gereği uydurma; bir başlıktan ayrıntılı bir hukuki kural çıkarma; kaynak açıkça belirtmedikçe belirli bir sorgu, belge veya kontrolün bir hukuki durumu kesin olarak ortaya çıkardığını iddia etme. Dış bilgi gerektiren öneriler varsa bunları kaynaklı hukuki olgu değil, genel ve ihtiyatlı bir durum tespiti önerisi olarak ifade et. Kanıt zayıfsa boşlukları doldurmaya çalışmak yerine dar kapsamlı ve doğru bir gönderi tercih et.",
  );

  const requiredLineCount = lines.length;

  if (opportunity.sources.length > 0) {
    lines.push(`Kaynaklar: ${opportunity.sources.map(formatSource).join("; ")}`);
  }

  const hasOnlyCommentarySources =
    opportunity.sources.length > 0 && opportunity.sources.every((source) => source.tier === "commentary");
  lines.push(
    hasOnlyCommentarySources
      ? "Tüm kaynaklar ikincil yorum niteliğindedir; hiçbir bilgiyi doğrulanmış kesin olgu gibi sunma."
      : "İkincil yorum/görüş niteliğindeki bilgiyi doğrulanmış olgu gibi sunma; kaynağın niteliğini belirt.",
  );

  lines.push("Kaynaklar birbiriyle çelişiyorsa bunu ihtiyatla belirt; tek taraflı kesin sonuca varma.");

  lines.push(
    "Hukuki/mevzuatla ilgili bilgi yalnızca genel bilgilendirme niteliğindedir; bireysel hukuki tavsiye olarak sunma; kesin işlemler için ilgili resmi kurum/uzmana yönlendirilmeli.",
  );

  // Social-copy voice (Grounded Content Safety, Part 1): lowest-priority
  // line — style guidance, not an anti-fabrication rule — so it's the
  // first dropped under truncation if the directive ever runs long.
  lines.push(
    "Üslup: kurumsal rapor tonu değil, profesyonel, net, güvenilir ve tüketici dostu bir sosyal medya sesi kullan; clickbait yok, gereksiz alarm/abartı yok. Kaynakta geçmeyen bir semt/mahalle (ör. yalnızca ulusal ölçekli bir kaynak için Zekeriyaköy/Sarıyer gibi) uydurup ekleme. 'X'den güncel duyuru', 'Bu neden önemli', 'Özetle' gibi kalıp başlıkları yalnızca yapısal olarak gerçekten gerekliyse kullan, her seferinde tekrarlama. Tercih edilen akış: dikkat çekici giriş -> kısa öz açıklama -> neden önemli olduğu -> (destekleniyorsa/ihtiyatla çerçevelenmiş) 2-4 pratik değerlendirme noktası -> kaynak ataması -> kısa ve net CTA.",
  );

  let directive = lines.join("\n");
  while (directive.length > MAX_DIRECTIVE_CHARS && lines.length > requiredLineCount) {
    lines.pop();
    directive = lines.join("\n");
  }
  if (directive.length > MAX_DIRECTIVE_CHARS) {
    directive = directive.slice(0, MAX_DIRECTIVE_CHARS);
  }

  return directive;
}
