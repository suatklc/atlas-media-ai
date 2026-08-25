import type { ContentPlan } from "./types";
import { detectContentIntent } from "./intent";
import { resolveContentGoal } from "./goal";
import { resolveAudience } from "./audience";
import { resolveOutputSpecification, selectContentFormat } from "./format";
import { selectTemplate } from "./templates";

// Pipeline order: Intent -> Goal -> Audience -> Format -> Template.
// Template Selection is a pure lookup keyed by the already-resolved
// format, so it must run last. Reads only the current message — never
// conversation history.
export function buildContentPlan(message: string): ContentPlan {
  const intent = detectContentIntent(message);
  const goal = resolveContentGoal(message, intent);
  const audience = resolveAudience(message);
  const { outputMode, slideCount } = resolveOutputSpecification(message, intent);
  const format = selectContentFormat(intent);
  const template = selectTemplate(format);

  return { intent, goal, audience, outputMode, slideCount, format, template };
}
