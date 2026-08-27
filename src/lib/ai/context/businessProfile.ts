// Phase 1 (Research -> Content Opportunity): a generic, industry-neutral
// business/tenant context layer. This is the ONLY place any geography- or
// industry-specific term (Zekeriyaköy, Sarıyer, "real estate") may live —
// content/*, creative/*, image/*, and publishing/* must never reference
// these names directly. A future non-real-estate tenant, or a second
// region, is just another BusinessProfile value, not a code change
// anywhere else.

export type BusinessProfileGeography = {
  primary: string;
  nearby: string[];
};

export type BusinessProfile = {
  industry: string;
  geography: BusinessProfileGeography;
  expertiseTopics: string[];
  excludedTopics: string[];
};

// Atlas's first tenant/use-case configuration — not a permanent global
// identity. Not yet consumed by any route/classifier in this phase
// (deliberately: wiring it into topic discovery/ranking is later work);
// exists now as the structural seam that work will read from.
export const ATLAS_DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  industry: "real-estate",
  geography: {
    primary: "Zekeriyaköy",
    nearby: ["Uskumruköy", "Demirciköy", "Gümüşdere", "Kilyos", "Sarıyer"],
  },
  expertiseTopics: [
    "villa",
    "arsa / arazi yatırımı",
    "gayrimenkul yatırımı",
    "mülk satın alma kararları",
    "imar / planlama",
    "tapu ve mülk belgeleri",
    "bölgesel piyasa bilgisi",
  ],
  excludedTopics: [],
};
