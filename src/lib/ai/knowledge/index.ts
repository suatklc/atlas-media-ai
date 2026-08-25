import type { KnowledgeEntry } from "./types";
import { taksKaksEntry } from "./entries/taks-kaks";
import { tapuTypesEntry } from "./entries/tapu-types";
import { valuationBasicsEntry } from "./entries/valuation-basics";

export type { KnowledgeEntry, KnowledgeTopic, KnowledgeProvenance } from "./types";

// Fixed declaration order — used as the final, deterministic tie-breaker in router.ts.
export const knowledgeEntries: KnowledgeEntry[] = [taksKaksEntry, tapuTypesEntry, valuationBasicsEntry];
