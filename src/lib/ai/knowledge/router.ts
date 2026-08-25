import type { KnowledgeEntry } from "./types";

const KEYWORD_POINTS = 10;
const KEYWORD_MAX_COUNTED = 2;
const INTENT_POINTS = 10;
const INTENT_MAX_COUNTED = 2;
const SUPPORTING_POINTS = 3;
const SUPPORTING_MAX_COUNTED = 3;
const MATCH_THRESHOLD = 10;
const MAX_MATCHED_TOPICS = 2;

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
}

function countMatches(normalizedMessage: string, phrases: string[], cap: number): number {
  let count = 0;
  for (const phrase of phrases) {
    if (normalizedMessage.includes(normalize(phrase))) {
      count += 1;
      if (count >= cap) break;
    }
  }
  return count;
}

function hasAnyMatch(normalizedMessage: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalizedMessage.includes(normalize(phrase)));
}

type ScoredEntry = {
  entry: KnowledgeEntry;
  score: number;
  hasKeywordMatch: boolean;
  declarationIndex: number;
};

// Inspects only the current message — never conversation history — so a
// Transform Action re-sending an earlier reply never re-triggers routing.
export function matchTopics(message: string, entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const normalizedMessage = normalize(message);

  const scored: ScoredEntry[] = [];

  entries.forEach((entry, declarationIndex) => {
    if (hasAnyMatch(normalizedMessage, entry.exclusionSignals)) {
      return;
    }

    const keywordMatches = countMatches(normalizedMessage, entry.keywords, KEYWORD_MAX_COUNTED);
    const intentMatches = countMatches(normalizedMessage, entry.strongIntentPhrases, INTENT_MAX_COUNTED);
    const supportingMatches = countMatches(normalizedMessage, entry.supportingTerms, SUPPORTING_MAX_COUNTED);

    const score =
      keywordMatches * KEYWORD_POINTS +
      intentMatches * INTENT_POINTS +
      supportingMatches * SUPPORTING_POINTS;

    if (score < MATCH_THRESHOLD) {
      return;
    }

    scored.push({ entry, score, hasKeywordMatch: keywordMatches > 0, declarationIndex });
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.hasKeywordMatch !== b.hasKeywordMatch) return a.hasKeywordMatch ? -1 : 1;
    return a.declarationIndex - b.declarationIndex;
  });

  return scored.slice(0, MAX_MATCHED_TOPICS).map((s) => s.entry);
}
