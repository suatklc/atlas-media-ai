import type { PlatformId } from "./config";

// Phase 2: lightweight, industry-neutral platform COPY guidance — how
// Claude should phrase/structure the response, not what it's about. Reuses
// the same PlatformId allowlist Step 1 already established (no second
// platform-id definition). Deliberately describes communication behavior
// only (tone, length, structure, CTA style, hashtag usage) — never
// hardcoded finished captions, and never a real-estate-specific term, so
// this same layer works unchanged for a future non-real-estate industry
// profile without rewriting the platform architecture.
type PlatformCopyGuidance = {
  label: string;
  style: string;
};

const PLATFORM_COPY_GUIDANCE: Record<PlatformId, PlatformCopyGuidance> = {
  instagram: {
    label: "Instagram",
    style:
      "Güçlü, dikkat çekici bir açılış cümlesiyle başla; kısa ve taranabilir paragraflar kullan; görselle uyumlu, kısa bölümler halinde yaz. Doğal bir eylem çağrısı (CTA) ekle. Uygun olduğunda hashtag kullanılabilir. Konuşma diline yakın ama profesyonel bir ton kullan; hantal, uzun soluklu metinlerden kaçın.",
  },
  facebook: {
    label: "Facebook",
    style:
      "Instagram'a kıyasla biraz daha açıklayıcı bağlam ver; doğal, sohbet havasında ve akıcı bir dil kullan; feed gönderisine uygun, okunması kolay paragraflar kur. Net bir eylem çağrısı (CTA) ekle. Hashtag kullanımını minimumda tut, metne baskın hale getirme. Instagram biçimlendirmesini birebir kopyalama.",
  },
  linkedin: {
    label: "LinkedIn",
    style:
      "Profesyonel ve güvenilir bir ton kullan; önce içgörüyü/değeri ver. Uygun olduğunda iş, yatırım veya sektör çerçevesini netleştir. Süslü/abartılı ifadeleri azalt. Hashtag kullanımını sınırlı ve seçici tut. Instagram tarzı dikkat çekme veya etkileşim tuzağı ifadeler kullanma. Her paylaşımı yapay şekilde aşırı kurumsallaştırma; doğal bir uzman sesi koru.",
  },
  "google-business": {
    label: "Google Business",
    style:
      "Doğrudan ve yerel olarak faydalı bilgi ver; sunulan değeri kısa ve net şekilde açıkla. Güvenilirlik ve açıklığı önceliklendir. Basit, net bir eylem çağrısı (CTA) kullan. Hashtag kullanımına neredeyse hiç ihtiyaç duyma. Gereksiz sosyal medya tarzı dolgu ifadelerinden kaçın. Konum, çalışma saatleri, fiyat, kampanya veya iletişim bilgisi gibi somut ayrıntıları asla uydurma; yalnızca kullanıcının verdiği bilgiyi kullan.",
  },
};

// Pure string assembly only — no API calls, no environment access. Always
// non-empty (every PlatformId has an entry), unlike the other directive
// builders in this codebase which can return "" when there's nothing to
// say. Appended as the final, most specific styling instruction, after the
// content/creative directives that establish what the response should
// actually contain — this only shapes how it's phrased.
export function buildPlatformDirective(platformId: PlatformId): string {
  const guidance = PLATFORM_COPY_GUIDANCE[platformId];

  return [
    `HEDEF PLATFORM: ${guidance.label}`,
    guidance.style,
    "Bu platform yönergesine göre yalnızca dili, uzunluğu, paragraf yapısını, CTA tarzını ve hashtag kullanımını uyarla; olgusal anlamı, kullanıcının verdiği bilgileri ve mevcut görsel başlık ([[VISUAL_HEADLINE]]) uzunluk kuralını değiştirme; yeni bilgi uydurma.",
  ].join("\n");
}
