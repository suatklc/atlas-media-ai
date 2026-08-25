import type { KnowledgeEntry } from "../types";

export const taksKaksEntry: KnowledgeEntry = {
  id: "taks-kaks-basics",
  topic: "development-potential",
  title: "TAKS / KAKS ve temel gelişim potansiyeli",
  keywords: ["taks", "kaks", "emsal", "taban alanı kat sayısı", "kat alanı kat sayısı", "imar durumu"],
  strongIntentPhrases: [
    "kaç daire yapabilirim",
    "bu arsaya ne yapabilirim",
    "arsamın imar durumu nedir",
    "kaç kat çıkabilirim",
    "inşaat alanı ne kadar çıkar",
  ],
  supportingTerms: ["arsa", "parsel", "imar", "inşaat alanı", "kat sayısı", "yapılaşma"],
  exclusionSignals: ["emlak vergisi", "tapu harcı"],
  content:
    "TAKS (taban alanı kat sayısı) = izin verilen taban alanının parsel alanına oranı. " +
    "KAKS/Emsal (kat alanı kat sayısı) = izin verilen toplam inşaat alanının parsel alanına oranı. " +
    "Kabaca kat sayısı ≈ KAKS ÷ TAKS. Bu değerler parsel bazında yerel imar planı tarafından belirlenir " +
    "ve belediyeden belediyeye, parselden parsele değişir. Kullanıcı hem parsel alanını hem de o parselin " +
    "gerçek TAKS/KAKS değerlerini verdiğinde: azami taban alanı = parsel alanı × TAKS; azami toplam inşaat " +
    "alanı = parsel alanı × KAKS; kabaca kat sayısı = KAKS ÷ TAKS (yaklaşık olarak belirt).",
  limitations: [
    "Bu bilgiler genel imar kavramlarıdır; belirli bir parselin gerçek TAKS/KAKS değerini temsil etmez.",
    "Hesaplamalar yalnızca kullanıcının verdiği rakamlara dayanır ve ön bilgi niteliğindedir.",
    "Çekme mesafesi, yükseklik sınırı ve diğer imar koşulları nihai projeyi etkileyebilir.",
    "Kesin imar durumu için ilgili belediyeden güncel imar durumu belgesi alınmalıdır.",
  ],
  lastReviewed: "2026-07-30",
  provenance: {
    basis: "genel-mevzuat-kavramı",
    notes: "TAKS/KAKS tanımları genel imar mevzuatı kavramlarıdır; parsel bazlı veri içermez.",
  },
  reasoning: {
    supportedRequestTypes: ["conceptual", "calculation"],
    requiredAnchors: ["parsel-alani", "taks-degeri", "kaks-degeri"],
    optionalAnchors: [],
    calculationCapability: "present",
    riskSignals: [
      {
        flag: "parcel-specific",
        patterns: ["parselim", "arsam", "benim arsam", "bu parselim", "kendi arsam"],
      },
    ],
    clarificationConditions: ["missing-all-required-on-calculation-request"],
  },
};
