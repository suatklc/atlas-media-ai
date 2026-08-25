import type { KnowledgeEntry } from "../types";

export const valuationBasicsEntry: KnowledgeEntry = {
  id: "valuation-investment-basics",
  topic: "valuation-basics",
  title: "Temel gayrimenkul yatırım ve değerleme mantığı",
  keywords: ["kira getirisi", "yatırım getirisi", "geri ödeme süresi", "değerleme", "brüt getiri", "net getiri", "ekspertiz"],
  strongIntentPhrases: [
    "bu yatırım karlı mı",
    "kaç yılda amorti eder",
    "kira getirisi ne kadar",
    "bu fiyata değer mi",
    "yatırım olarak mantıklı mı",
    "yatırım mantıklı mı",
    "değer mi",
  ],
  supportingTerms: ["kira", "fiyat", "değer", "yatırım", "getiri", "amortisman"],
  exclusionSignals: ["kira sözleşmesi", "kiracı tahliyesi", "kira davası"],
  content:
    "Brüt kira getirisi = yıllık kira ÷ mülk değeri. Kaba geri ödeme süresi = mülk değeri ÷ yıllık net kira. " +
    "Genel değerleme mantığı (gelir yaklaşımı, emsal karşılaştırma mantığı) kavramsal düzeyde açıklanabilir; " +
    "canlı piyasa verisine erişim yoktur. Kullanıcı fiyat ve kira verdiğinde getiri/geri ödeme aritmetiği " +
    "hesaplanabilir; kullanıcı emsal veri noktaları verdiğinde bu emsallere göre konumlandırma mantığı sunulabilir.",
  limitations: [
    "Bu hesaplamalar yalnızca kullanıcının verdiği rakamlara dayanır; gerçek piyasa verisi içermez.",
    "Bu bilgi resmi bir ekspertiz raporunun (SPK lisanslı değerleme) yerine geçmez.",
    "Gelecekteki getiri veya değer artışı garanti edilemez.",
    "Net getiri için aidat, vergi ve boş kalma süreleri gibi giderlerin düşülmesi gerekir.",
  ],
  lastReviewed: "2026-07-30",
  provenance: {
    basis: "genel-finansal-formül",
    notes: "Getiri ve geri ödeme formülleri standart finansal hesaplamalardır; piyasa verisi içermez.",
  },
  reasoning: {
    supportedRequestTypes: ["conceptual", "calculation"],
    requiredAnchors: ["fiyat", "kira-tutari-veya-emsal"],
    optionalAnchors: [],
    calculationCapability: "present",
    riskSignals: [
      {
        flag: "investment-judgment",
        patterns: ["mantıklı mı", "karlı mı", "değer mi", "almalı mıyım", "yapmalı mıyım"],
      },
      {
        flag: "parcel-specific",
        patterns: ["benim dairem", "bu dairem", "kendi evim", "elimdeki daire"],
      },
    ],
    clarificationConditions: ["missing-all-required-on-calculation-request"],
  },
};
