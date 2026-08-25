import type { ContentGoal, ContentIntent } from "./types";

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
}

function hasAnyMatch(normalizedMessage: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalizedMessage.includes(normalize(phrase)));
}

// Checked before the intent-default table — an explicit goal always wins.
const EXPLICIT_GOAL_SIGNALS: { goal: ContentGoal; patterns: string[] }[] = [
  {
    goal: "lead-generation",
    patterns: ["müşteri adayı topla", "lead topla", "potansiyel müşteri", "talep topla"],
  },
  { goal: "brand-awareness", patterns: ["farkındalık yarat", "marka bilinirliği", "marka farkındalığı"] },
  { goal: "education", patterns: ["eğitici olsun", "bilgilendirici olsun", "öğretici olsun"] },
  { goal: "authority", patterns: ["otorite oluştur", "uzmanlığımı göster", "otorite"] },
  {
    goal: "engagement",
    patterns: ["etkileşim al", "etkileşim yarat", "yorum almak istiyorum", "beğeni almak"],
  },
];

// "engagement" is intentionally absent — explicit-signal only, no intent
// naturally defaults to it.
const DEFAULT_GOAL_BY_INTENT: Partial<Record<ContentIntent, ContentGoal>> = {
  listing: "lead-generation",
  educational: "education",
  comparison: "authority",
  "market-stats": "authority",
  announcement: "brand-awareness",
};

export function resolveContentGoal(message: string, intent: ContentIntent): ContentGoal | undefined {
  if (intent === "none") {
    return undefined;
  }

  const normalizedMessage = normalize(message);

  for (const entry of EXPLICIT_GOAL_SIGNALS) {
    if (hasAnyMatch(normalizedMessage, entry.patterns)) {
      return entry.goal;
    }
  }

  return DEFAULT_GOAL_BY_INTENT[intent];
}
