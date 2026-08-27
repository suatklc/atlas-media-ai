import type { ContentIntent, ContentPlan } from "./types";
import { detectContentIntent } from "./intent";
import { resolveContentGoal } from "./goal";
import { resolveAudience } from "./audience";
import { resolveOutputSpecification, selectContentFormat } from "./format";
import { selectTemplate } from "./templates";

// Pipeline order: Intent -> Goal -> Audience -> Format -> Template.
// Template Selection is a pure lookup keyed by the already-resolved
// format, so it must run last. Reads only the current message — never
// conversation history.
//
// intentOverride (Handoff — research-opportunity intent seam): optional,
// and ONLY ever supplied by a caller that already has a grounded,
// research-stage ContentIntent for this exact request — today, that's a
// ContentOpportunity's own suggestedContentType (see research/discover.ts),
// threaded through by assistant/route.ts. When present, it is used
// directly instead of running detectContentIntent on the message text —
// this is what stops a keyword collision in the synthetic seed message
// buildSeedMessage produces (e.g. "gelişme" incidentally matching a
// market-stats trigger) from silently overriding an intent the research
// stage already determined more reliably from the source itself. Every
// OTHER caller — every ordinary user chat message, with no override
// argument at all — is completely unaffected: detectContentIntent still
// runs exactly as before, since intentOverride defaults to undefined.
// This is the whole seam; goal/audience/output/format/template still
// derive from the (now possibly overridden) intent exactly as before, no
// second ContentPlan pipeline.
export function buildContentPlan(message: string, intentOverride?: ContentIntent): ContentPlan {
  const intent = intentOverride ?? detectContentIntent(message);
  const goal = resolveContentGoal(message, intent);
  const audience = resolveAudience(message);
  const { outputMode, slideCount } = resolveOutputSpecification(message, intent);
  const format = selectContentFormat(intent);
  const template = selectTemplate(format);

  return { intent, goal, audience, outputMode, slideCount, format, template };
}
