import type { KnowledgeEntry } from "../types";

export const tapuTypesEntry: KnowledgeEntry = {
  id: "tapu-types-basics",
  topic: "title-deed-types",
  title: "Kat mülkiyeti, kat irtifakı ve hisseli tapu",
  keywords: [
    "kat mülkiyeti",
    "kat irtifakı",
    "kat irtifaklı",
    "hisseli tapu",
    "hisseli",
    "müstakil tapu",
    "paylı mülkiyet",
    "tapu durumu",
  ],
  strongIntentPhrases: [
    "bu tapu türü ne demek",
    "kat irtifaklı daire almak",
    "hisseli arsa almak riskli mi",
    "tapu türleri arasındaki fark nedir",
    "iskan aldı mı",
  ],
  supportingTerms: ["tapu", "mülkiyet", "bağımsız bölüm", "iskan", "yapı kullanma izni"],
  exclusionSignals: ["tapu harcı", "tapu masrafı"],
  content:
    "Kat mülkiyeti = tamamlanmış ve iskanlı yapıdaki bağımsız bölüm üzerindeki tam mülkiyet. " +
    "Kat irtifakı = henüz tamamlanmamış yapı için kurulan geçici hak; tamamlanma ve iskan sonrası bir " +
    "başvuru ile kat mülkiyetine dönüştürülür (otomatik değildir). Hisseli tapu (paylı mülkiyet) = " +
    "birden fazla kişi arasında pay esaslı ortak mülkiyet; fiziksel olarak belirli bir bölüm üzerinde " +
    "tek başına tasarruf hakkı yoktur.",
  limitations: [
    "Bu bilgiler genel tapu kavramlarıdır; belirli bir taşınmazın gerçek tapu durumunu temsil etmez.",
    "Kat irtifakından kat mülkiyetine geçiş otomatik değildir; tamamlanma, iskan ve başvuru gerektirir.",
    "Bu açıklama bağlayıcı bir hukuki görüş değildir.",
    "Kesin durum için tapu müdürlüğü, noter veya avukata danışılmalıdır.",
  ],
  lastReviewed: "2026-07-30",
  provenance: {
    basis: "genel-mevzuat-kavramı",
    notes: "Tapu türü tanımları genel mülkiyet hukuku kavramlarıdır; belge bazlı doğrulama içermez.",
  },
  reasoning: {
    supportedRequestTypes: ["conceptual"],
    requiredAnchors: [],
    optionalAnchors: [],
    calculationCapability: "none",
    riskSignals: [
      {
        flag: "parcel-specific",
        patterns: ["benim tapum", "bu tapum", "elimdeki tapu", "kendi tapum"],
      },
      {
        flag: "legal-uncertainty",
        patterns: ["geçerli mi", "hukuki olarak", "dava", "mahkeme", "sözleşme geçerli mi"],
      },
    ],
    clarificationConditions: [],
  },
};
