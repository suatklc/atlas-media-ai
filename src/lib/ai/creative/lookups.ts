import type { AudienceType, ContentGoal, ContentIntent } from "../content/types";

// Four independent, single-dimension lookup tables — never a cross-product.
// Each output field in brief.ts reads from exactly one (occasionally two)
// of these, with a documented primary owner per field. Using `Record` (not
// `Partial<Record>`) over the closed enums forces compile-time exhaustiveness:
// a missing entry is a type error, not a runtime gap.

export type AudienceCreative = {
  emotionalTone: string;
  narrativeAngle: string;
  colorDirection: string;
  imagerySubjectHint: string;
  imageryMoodHint: string;
};

export const BY_AUDIENCE: Record<AudienceType, AudienceCreative> = {
  "luxury-home-buyer": {
    emotionalTone: "sofistike, sakin, davetkâr",
    narrativeAngle: "ayrıcalık ve özel yaşam",
    colorDirection: "koyu nötr zemin, altın/bronz vurgu",
    imagerySubjectHint: "geniş açılı, ışıklı mekan",
    imageryMoodHint: "doğal ışık, minimal düzenleme",
  },
  "villa-buyer": {
    emotionalTone: "sıcak, doğal, ferah",
    narrativeAngle: "özgürlük ve aile yaşamı",
    colorDirection: "toprak tonu zemin, yeşil vurgu",
    imagerySubjectHint: "dış cephe ve bahçe genel görünüm",
    imageryMoodHint: "gün ışığı, canlı ama doğal",
  },
  "land-investor": {
    emotionalTone: "net, güvenilir, potansiyel odaklı",
    narrativeAngle: "büyüme ve fırsat",
    colorDirection: "nötr zemin, mavi/yeşil vurgu",
    imagerySubjectHint: "arazi/parsel genel görünüm",
    imageryMoodHint: "net, gündüz, sınır belirgin",
  },
  "commercial-investor": {
    emotionalTone: "profesyonel, kurumsal, sonuç odaklı",
    narrativeAngle: "iş potansiyeli ve getiri",
    colorDirection: "koyu lacivert/gri zemin, net kontrast",
    imagerySubjectHint: "bina cephesi, kullanım potansiyeli",
    imageryMoodHint: "keskin, kurumsal, yüksek kontrast",
  },
  "property-owner": {
    emotionalTone: "güven verici, samimi",
    narrativeAngle: "değerin doğru anlatımı",
    colorDirection: "sıcak nötr tonlar",
    imagerySubjectHint: "mülkün öne çıkan iç mekanı",
    imageryMoodHint: "sıcak, davetkâr",
  },
  "first-time-home-buyer": {
    emotionalTone: "sıcak, güven verici, davetkâr",
    narrativeAngle: "güven ve rehberlik",
    colorDirection: "açık/pastel nötr zemin, yumuşak vurgu",
    imagerySubjectHint: "yaşanabilir, samimi iç mekan",
    imageryMoodHint: "yumuşak ışık, sade",
  },
  "general-buyer": {
    emotionalTone: "profesyonel, dengeli",
    narrativeAngle: "dengeli ve güvenilir sunum",
    colorDirection: "marka nötr paleti",
    imagerySubjectHint: "mülkün genel görünümü",
    imageryMoodHint: "temiz, dengeli",
  },
};

export type IntentCreative = {
  primaryMessage: string;
  secondaryMessage: string;
  imagerySubject: string;
  cameraDirection: string;
  lightingDirection: string;
};

export const BY_INTENT: Record<Exclude<ContentIntent, "none">, IntentCreative> = {
  listing: {
    primaryMessage: "mülkün en güçlü somut özelliği",
    secondaryMessage: "konum ve yaşam tarzı avantajları",
    imagerySubject: "gerçek mekan fotoğrafı",
    cameraDirection: "geniş açı, göz hizası",
    lightingDirection: "doğal gündüz ışığı, altın saat tercih",
  },
  educational: {
    primaryMessage: "öğretilen temel kavram",
    secondaryMessage: "pratik uygulama örneği",
    imagerySubject: "ikon/illüstrasyon ağırlıklı",
    cameraDirection: "uygulanamaz",
    lightingDirection: "uygulanamaz",
  },
  comparison: {
    primaryMessage: "iki seçenek arasındaki temel fark",
    secondaryMessage: "karar kriterleri",
    imagerySubject: "ikon tabanlı, düşük fotoğraf ağırlığı",
    cameraDirection: "uygulanamaz",
    lightingDirection: "uygulanamaz",
  },
  "market-stats": {
    primaryMessage: "en dikkat çekici veri noktası",
    secondaryMessage: "verinin pratik anlamı",
    imagerySubject: "grafik/ikon ağırlıklı",
    cameraDirection: "uygulanamaz",
    lightingDirection: "uygulanamaz",
  },
  announcement: {
    primaryMessage: "duyurunun kendisi",
    secondaryMessage: "bundan nasıl faydalanılacağı",
    imagerySubject: "marka/mekan görseli veya temiz arka plan",
    cameraDirection: "orta açı, net",
    lightingDirection: "net, aydınlık",
  },
};

export type GoalCreative = {
  attentionFocus: string;
  visualPriority: string;
  ctaVisualTreatment: string;
};

export const BY_GOAL: Record<ContentGoal, GoalCreative> = {
  "lead-generation": {
    attentionFocus: "harekete geçirici teklif",
    visualPriority: "CTA ve öne çıkan özellik",
    ctaVisualTreatment: "yüksek kontrastlı, büyük buton hissi",
  },
  "brand-awareness": {
    attentionFocus: "marka/danışman güvenilirliği",
    visualPriority: "marka unsuru ve genel izlenim",
    ctaVisualTreatment: "ince, düşük baskılı davet",
  },
  education: {
    attentionFocus: "öğretilen kavramın kendisi",
    visualPriority: "ana kavram/veri",
    ctaVisualTreatment: "yumuşak, bilgi odaklı davet",
  },
  authority: {
    attentionFocus: "uzmanlık/veri kanıtı",
    visualPriority: "veri/analiz unsuru",
    ctaVisualTreatment: "danışma daveti, orta vurgulu",
  },
  engagement: {
    attentionFocus: "soru veya tartışma noktası",
    visualPriority: "soru/etkileşim unsuru",
    ctaVisualTreatment: "yorum/paylaşım ikonu vurgusu",
  },
};

export type TemplateCreative = {
  eyeFlow: string;
  aspectRatio: string;
  dimensionsPx: string;
  composition: string;
  typographyHierarchy: string;
  textPlacement: string;
  logoPlacement: string;
};

// Keyed by Sprint 8's existing template IDs (read-only reference — never
// modifies content/templates.ts). Deliberately a plain string-keyed record,
// not a closed union, since template IDs are catalog data, not a type.
export const BY_TEMPLATE_ID: Record<string, TemplateCreative> = {
  PREMIUM_LISTING_01: {
    eyeFlow: "üstten hero görsele, alta metin/CTA'ya",
    aspectRatio: "4:5",
    dimensionsPx: "1080x1350",
    composition: "tek güçlü hero görsel, alt üçte bir overlay metin alanı",
    typographyHierarchy: "büyük başlık, ince alt metin",
    textPlacement: "alt üçte bir, görsel üzerine overlay",
    logoPlacement: "sağ alt köşe, sabit",
  },
  EDUCATIONAL_CAROUSEL_01: {
    eyeFlow: "slayt slayt, sol-sağ kaydırma sırasıyla",
    aspectRatio: "1:1",
    dimensionsPx: "1080x1080",
    composition: "her slaytta sabit üst başlık bandı",
    typographyHierarchy: "her slaytta tutarlı boyut hiyerarşisi",
    textPlacement: "üst-orta başlık, ortada gövde metni",
    logoPlacement: "her slaytta sağ alt köşe, sabit",
  },
  COMPARISON_01: {
    eyeFlow: "soldan sağa, iki sütun karşılaştırma",
    aspectRatio: "1:1",
    dimensionsPx: "1080x1080",
    composition: "dikey orta çizgiyle net iki sütun ayrımı",
    typographyHierarchy: "başlık üstte, sütun başlıkları eşit ağırlık",
    textPlacement: "her sütun kendi alanında",
    logoPlacement: "üst orta, sabit",
  },
  INFOGRAPHIC_01: {
    eyeFlow: "yukarıdan aşağıya, veri bloğu sırasıyla",
    aspectRatio: "4:5",
    dimensionsPx: "1080x1350",
    composition: "dikey akış, her veri bloğu net ayraç",
    typographyHierarchy: "başlık en büyük, veri noktaları tutarlı ikincil boyut",
    textPlacement: "her blok kendi hizasında",
    logoPlacement: "alt orta, sabit",
  },
  ANNOUNCEMENT_01: {
    eyeFlow: "merkezden dışa, tek mesaj odağı",
    aspectRatio: "1:1",
    dimensionsPx: "1080x1080",
    composition: "merkezi kompozisyon, büyük tek mesaj odağı",
    typographyHierarchy: "büyük, kutlama/duyuru hissi veren başlık",
    textPlacement: "merkez",
    logoPlacement: "alt orta, sabit",
  },
};
