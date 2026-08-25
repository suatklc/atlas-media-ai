import type { KnowledgeEntry } from "./types";

const MAX_KNOWLEDGE_CONTEXT_CHARS = 2000;

function formatEntry(entry: KnowledgeEntry): string {
  const limitationsList = entry.limitations.map((item) => `- ${item}`).join("\n");
  return `### ${entry.title}\n${entry.content}\n\nSınırlamalar:\n${limitationsList}`;
}

// Pure string assembly only — no matching/scoring logic, no history access.
// Returns basePrompt byte-identically when nothing matched.
export function buildSystemContext(basePrompt: string, matchedEntries: KnowledgeEntry[]): string {
  if (matchedEntries.length === 0) {
    return basePrompt;
  }

  const header = "İlgili referans bilgi (yalnızca bu istek için):\n\n";
  const knowledgeBlock = matchedEntries.map(formatEntry).join("\n\n");
  let fullBlock = header + knowledgeBlock;

  if (fullBlock.length > MAX_KNOWLEDGE_CONTEXT_CHARS) {
    fullBlock = fullBlock.slice(0, MAX_KNOWLEDGE_CONTEXT_CHARS);
  }

  return `${basePrompt}\n\n${fullBlock}`;
}
