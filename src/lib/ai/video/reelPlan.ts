import type { ContentPackage, ContentSlide } from "../content/contentPackage";

// ============================================================
// Video/Reels V1 — the Reels logic between a GROUNDED ContentPackage and
// media generation. Deliberately not a planning or grounding layer of its
// own: every spoken/on-screen line here is taken from a ContentPackage
// that already passed Job 1 / Gap 1 / Gap 2 / validateContentPackage, so a
// Reel can never state anything the carousel couldn't. Timing analysis is
// adapted from MonsterDylan/instagram-agent-skill's ig-reel beats.py (MIT):
// same structural rules (hook ≤3s, beat ≤4s, no long abstract runs, loop
// back to the hook), retuned for spoken Turkish.
//
// Flow: ContentOpportunity → ContentPlan → CreativeBrief → /api/content-
// package (grounded) → buildReelDraft (this file) → editorial gate → media
// (media/router.ts generateVideo: fal.ai in-app; Higgsfield via Claude Code
// skills) → Atlas preview → SUAT APPROVAL → publish. Nothing here
// generates media, approves, or publishes.
// ============================================================

// Turkish is agglutinative — fewer, longer words than English. ~2.3 words/s
// (≈140 wpm) is a calm advisor's on-camera pace; override per speaker.
export const DEFAULT_TURKISH_WORDS_PER_SECOND = 2.3;
export const HOOK_WINDOW_SECONDS = 3;
export const MAX_BEAT_SECONDS = 4;
export const MAX_ON_SCREEN_WORDS = 6;
const ABSTRACT_RUN = 3;

export type ReelBeatLabel = "HOOK" | "STAKE" | "BODY" | "PAYOFF";

export type ReelBeatInput = {
  label: ReelBeatLabel;
  spoken: string;
  onScreen: string;
  // Scene direction for media generation — from the slide's visualBrief.
  visualBrief: string;
};

export type ReelBeat = ReelBeatInput & {
  index: number;
  startSeconds: number;
  durationSeconds: number;
  words: number;
  flags: string[];
};

export type ReelPlan = {
  beats: ReelBeat[];
  totalSeconds: number;
  notes: string[];
  // true only when no beat carries a flag and the structural notes are clean.
  ready: boolean;
};

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
}

// A number, a percentage, or a capitalized proper noun mid-sentence — the
// "something checkable" a beat needs (beats.py's CONCRETE_RE, Turkish-aware).
function isConcrete(text: string): boolean {
  return /\d/.test(text) || /(?<=\s)\p{Lu}\p{Ll}{2,}/u.test(text);
}

// Stem-ish comparison for the loop check: Turkish suffixes vary between the
// hook and the closing line ("Vatandaşlık" / "vatandaşlığa").
function loopStems(text: string): Set<string> {
  return new Set(
    wordsOf(text)
      .map((word) => word.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]/gu, ""))
      .filter((word) => word.length >= 4)
      .map((word) => word.slice(0, 5)),
  );
}

export function analyzeReelBeats(
  inputs: ReelBeatInput[],
  wordsPerSecond: number = DEFAULT_TURKISH_WORDS_PER_SECOND,
): ReelPlan {
  let clock = 0;
  const beats: ReelBeat[] = inputs.map((input, i) => {
    const words = wordsOf(input.spoken).length;
    const durationSeconds = Math.round((words / wordsPerSecond) * 10) / 10;
    const beat: ReelBeat = { ...input, index: i + 1, startSeconds: Math.round(clock * 10) / 10, durationSeconds, words, flags: [] };
    clock += durationSeconds;
    return beat;
  });
  const totalSeconds = Math.round(clock * 10) / 10;
  const notes: string[] = [];

  if (beats.length === 0) {
    return { beats, totalSeconds: 0, notes: ["Boş senaryo."], ready: false };
  }

  const hook = beats[0];
  if (hook.durationSeconds > HOOK_WINDOW_SECONDS) {
    hook.flags.push(`hook ${hook.durationSeconds}s — ${HOOK_WINDOW_SECONDS}s sınırını aşıyor`);
  }
  if (!isConcrete(hook.spoken)) {
    hook.flags.push("hook'ta sayı/kurum/belge gibi somut bir işaret yok");
  }

  for (const beat of beats) {
    if (beat.index > 1 && beat.durationSeconds > MAX_BEAT_SECONDS) {
      beat.flags.push(`${beat.durationSeconds}s tek beat — ${MAX_BEAT_SECONDS}s üstü, böl veya görüntüyü değiştir`);
    }
    const onScreenWords = wordsOf(beat.onScreen).length;
    if (onScreenWords === 0) beat.flags.push("ekran metni boş");
    if (onScreenWords > MAX_ON_SCREEN_WORDS) {
      beat.flags.push(`ekran metni ${onScreenWords} kelime — en fazla ${MAX_ON_SCREEN_WORDS}`);
    }
  }

  let run = 0;
  for (const beat of beats) {
    run = isConcrete(beat.spoken) ? 0 : run + 1;
    if (run === ABSTRACT_RUN) {
      notes.push(`Beat ${beat.index - ABSTRACT_RUN + 1}-${beat.index} arasında somut hiçbir şey yok.`);
    }
  }

  const hookStems = loopStems(hook.spoken);
  const last = beats[beats.length - 1];
  const loops = beats.length > 1 && [...loopStems(last.spoken)].some((stem) => hookStems.has(stem));
  if (!loops) notes.push("Loop yok: son beat hook'tan hiçbir kelimeyi tekrar etmiyor.");

  if (totalSeconds < 7) notes.push(`${totalSeconds}s — 7s altı Reel neredeyse hiçbir şey taşımaz.`);
  if (totalSeconds > 45) notes.push(`${totalSeconds}s — 45s üstü; tek fikre indir.`);

  const ready = beats.every((beat) => beat.flags.length === 0) && notes.length === 0;
  return { beats, totalSeconds, notes, ready };
}

function firstSentence(text: string): string {
  const match = text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

function slideByRole(contentPackage: ContentPackage, role: ContentSlide["role"]): ContentSlide | undefined {
  return contentPackage.slides.find((slide) => slide.role === role);
}

// A first-cut Reel draft seeded ONLY from an already-grounded carousel
// ContentPackage: hook from the package hook, stake from why-it-matters,
// body beats from what-happened's facts and the what-to-do checklist,
// payoff from the cta slide. On-screen lines start as the slide headlines;
// the plan's flags tell the strategist what to tighten (and the editorial
// gate judges the result). Returns null for a non-carousel package.
export function buildReelDraft(contentPackage: ContentPackage): ReelPlan | null {
  if (contentPackage.format !== "carousel") return null;
  const hook = slideByRole(contentPackage, "hook");
  const whatHappened = slideByRole(contentPackage, "what-happened");
  const why = slideByRole(contentPackage, "why-it-matters");
  const whatToDo = slideByRole(contentPackage, "what-to-do");
  const cta = slideByRole(contentPackage, "cta");
  if (!hook || !whatHappened || !why || !whatToDo || !cta) return null;

  const inputs: ReelBeatInput[] = [
    { label: "HOOK", spoken: contentPackage.hook, onScreen: hook.headline, visualBrief: hook.visualBrief },
    { label: "STAKE", spoken: firstSentence(why.body), onScreen: why.headline, visualBrief: why.visualBrief },
    ...whatHappened.facts.slice(0, 2).map((fact) => ({
      label: "BODY" as const,
      spoken: fact,
      onScreen: whatHappened.headline,
      visualBrief: whatHappened.visualBrief,
    })),
    ...whatToDo.facts.slice(0, 2).map((fact) => ({
      label: "BODY" as const,
      spoken: fact,
      onScreen: whatToDo.headline,
      visualBrief: whatToDo.visualBrief,
    })),
    { label: "PAYOFF", spoken: firstSentence(cta.body), onScreen: cta.headline, visualBrief: cta.visualBrief },
  ];
  return analyzeReelBeats(inputs);
}
