import type { BusinessProfile, ContentIdea } from "../context/businessProfile";
import type { RankedContentOpportunity } from "../research/retrieval/types";
import { isLocalToElsewhere } from "../research/turkishPlaces";

// Weekly content plan: picks the week's ideas from the business's content
// strategy (businessProfile.ts) and, when one qualifies, a current Radar
// topic. It only chooses TOPICS — every pick goes through the existing
// /api/content-package → carousel → draft → approval flow unchanged
// (an idea as an expert-mode instruction, a current topic as the Radar
// opportunity itself). Deterministic, no AI, no network.
//
// - Each slot rotates through its pillars week by week; inside a pillar the
//   ideas rotate too, so consecutive weeks differ.
// - Ideas whose signature appears in a recent draft are skipped (unless
//   every idea of that pillar was used recently).
// - No two picks share a format, so the week never repeats one hook style.
// - A current topic is used only when Radar found one that is not local to
//   another district/province and was not already drafted; otherwise the
//   slot falls back to its evergreen pillars. Radar returning nothing
//   never stops the plan.

export type WeeklyPlanItem =
  | { kind: "idea"; label: string; title: string; reason: string; format: string; instruction: string; ideaId: string }
  | { kind: "current"; label: string; title: string; reason: string; opportunity: RankedContentOpportunity };

export type RadarStatus = "used" | "no-qualifying-topic" | "unavailable";

export type WeeklyContentPlan = {
  items: WeeklyPlanItem[];
  alternates: WeeklyPlanItem[];
  radar: RadarStatus;
};

// What a recent draft says about itself (its stored ContentPackage).
export type RecentDraft = { text: string; sourceUrl?: string };

const MAX_ALTERNATES = 2;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// 1970-01-05 was a Monday; weeks start on Monday, Turkey time (UTC+3).
const FIRST_MONDAY_MS = Date.UTC(1970, 0, 5);
const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;

export function weekIndex(now: Date): number {
  return Math.floor((now.getTime() + TURKEY_OFFSET_MS - FIRST_MONDAY_MS) / WEEK_MS);
}

function normalized(text: string): string {
  return ` ${text.toLocaleLowerCase("tr-TR").split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")}`;
}

// A signature entry matches at a word start ("parsel" -> "parselin";
// "imar durumu" -> "imar durumu belgesi").
function matchesSignature(text: string, entry: string): boolean {
  return text.includes(normalized(entry));
}

export function isUsedRecently(idea: ContentIdea, recentTexts: string[]): boolean {
  const needed = Math.min(2, idea.signature.length);
  return recentTexts.some((text) => idea.signature.filter((entry) => matchesSignature(text, entry)).length >= needed);
}

function rotate<T>(list: T[], offset: number): T[] {
  if (list.length === 0) return list;
  const start = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(start), ...list.slice(0, start)];
}

function toIdeaItem(idea: ContentIdea, label: string): WeeklyPlanItem {
  return {
    kind: "idea",
    label,
    title: idea.title,
    reason: idea.reason,
    format: idea.format,
    instruction: idea.instruction,
    ideaId: idea.id,
  };
}

export type BuildWeeklyPlanInput = {
  profile: BusinessProfile;
  now: Date;
  // Undefined when Radar could not run (error/timeout) — never a reason to
  // stop the plan.
  radarOpportunities?: RankedContentOpportunity[];
  recentDrafts?: RecentDraft[];
};

export function buildWeeklyContentPlan({ profile, now, radarOpportunities, recentDrafts = [] }: BuildWeeklyPlanInput): WeeklyContentPlan {
  const strategy = profile.contentStrategy;
  if (!strategy) return { items: [], alternates: [], radar: radarOpportunities ? "no-qualifying-topic" : "unavailable" };

  const week = weekIndex(now);
  const recentTexts = recentDrafts.map((draft) => normalized(draft.text));
  const recentSourceUrls = new Set(recentDrafts.map((draft) => draft.sourceUrl).filter(Boolean));
  const homeNames = ["İstanbul", profile.geography.primary, ...profile.geography.nearby];

  const usedIdeaIds = new Set<string>();
  const usedFormats = new Set<string>();
  const labelOf = (pillar: string) => strategy.pillarLabels[pillar] ?? pillar;

  function pickIdea(pillar: string): ContentIdea | undefined {
    const pool = strategy!.ideas.filter((idea) => idea.pillar === pillar && !usedIdeaIds.has(idea.id));
    const fresh = pool.filter((idea) => !isUsedRecently(idea, recentTexts));
    const candidates = rotate(fresh.length > 0 ? fresh : pool, week);
    const pick = candidates.find((idea) => !usedFormats.has(idea.format)) ?? candidates[0];
    if (pick) {
      usedIdeaIds.add(pick.id);
      usedFormats.add(pick.format);
    }
    return pick;
  }

  const current = (radarOpportunities ?? []).find(
    (opportunity) =>
      !isLocalToElsewhere(`${opportunity.topic} ${opportunity.angle}`, homeNames) &&
      !opportunity.sources.some((source) => recentSourceUrls.has(source.url)),
  );
  let currentUsed = false;

  const items: WeeklyPlanItem[] = [];
  const usedPillars = new Set<string>();
  for (const slot of strategy.weeklySlots) {
    if (slot.allowCurrent && current && !currentUsed) {
      currentUsed = true;
      const publisher = current.sources[0]?.publisher;
      items.push({
        kind: "current",
        label: strategy.currentLabel,
        title: current.topic,
        reason: publisher ? `${current.angle} (Kaynak: ${publisher})` : current.angle,
        opportunity: current,
      });
      continue;
    }
    const pillars = rotate(slot.pillars, week);
    for (const pillar of pillars) {
      const idea = pickIdea(pillar);
      if (idea) {
        usedPillars.add(pillar);
        items.push(toIdeaItem(idea, labelOf(pillar)));
        break;
      }
    }
  }

  // Alternates: pillars the week's plan did not use first, then any other.
  const allPillars = Object.keys(strategy.pillarLabels);
  const alternatePillars = [...allPillars.filter((p) => !usedPillars.has(p)), ...allPillars.filter((p) => usedPillars.has(p))];
  const alternates: WeeklyPlanItem[] = [];
  for (const pillar of alternatePillars) {
    if (alternates.length >= MAX_ALTERNATES) break;
    const idea = pickIdea(pillar);
    if (idea) alternates.push(toIdeaItem(idea, labelOf(pillar)));
  }

  const radar: RadarStatus = radarOpportunities === undefined ? "unavailable" : currentUsed ? "used" : "no-qualifying-topic";
  return { items, alternates, radar };
}
