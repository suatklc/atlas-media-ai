import type { ContentPackage } from "./contentPackage";

// Expert-content quality gate (deterministic, no AI). Expert packages have
// no source and no verified facts, so the writer's brief forbids frequency
// claims, consultant jargon and generic real-estate phrasing — but those
// rules lived only in the prompt, and a real run still shipped "birçok
// alıcının sandığından". This checks every public line of an expert
// package (hook, caption, slide headline/body/facts) and names what it
// finds; the route then regenerates once or refuses the package. News
// packages never pass through here. Also blocks figures and tax/legal
// ruling phrasing (below), which an unsourced package cannot support.

// Shown to the writer in the expert brief (unchanged list).
export const EXPERT_FREQUENCY_WORDS = ["çoğu zaman", "sık sık", "genellikle", "çoğu", "pek çok", "birçok", "her zaman", "en sık"];
export const EXPERT_JARGON = ["rakip grup", "değer önerisi", "segment", "algı yönetimi"];

// Unsupported generalisations — the brief's list plus the inflections and
// spellings a writer actually uses.
const UNSUPPORTED_GENERALISATIONS = [
  ...EXPERT_FREQUENCY_WORDS,
  "bir çok",
  "birçoğu",
  "birçoğunun",
  "çoğunlukla",
  "çoğu kez",
  "genelde",
  "hiçbir zaman",
];

// Generic / AI real-estate phrasing the brief rules out.
const GENERIC_PHRASES = [
  "bir üst seviyeye",
  "hayalinizdeki",
  "doğru adres",
  "kaçırılmayacak",
  "fırsatı kaçırmayın",
  "portföyünüzü bana",
  "yatırımın geleceği",
];

function normalized(text: string): string {
  return ` ${text.toLocaleLowerCase("tr-TR").split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")} `;
}

// Whole-word match: " birçok " never matches inside another word.
function contains(text: string, phrase: string): boolean {
  return text.includes(normalized(phrase));
}

// Tax/legal rulings (2026-11-18): an expert package has no verified source,
// so it may say a question must be checked — never what the rule is. Owner
// proposals built from sector news reach the draft flow as expert topics;
// this keeps a news site's tax/legal statement from becoming a ruling.
const LEGAL_RULING_PHRASES = [
  "muaftır",
  "muaf tutulur",
  "vergiden muaf",
  "vergi alınmaz",
  "vergi ödenmez",
  "vergi çıkmaz",
  "vergi doğmaz",
  "istisnadır",
  "istisna kapsamındadır",
  "zorunludur",
  "yasal olarak",
  "kanunen",
  "yasa gereği",
  "kanun gereği",
];

// Figures: an expert package has no source for any number, rate or date.
// Address/link tokens (wa.me/…, talep.example.net — the contact line) and
// digits glued to letters (labels such as "H1") are not figures.
export const EXPERT_FIGURE_ISSUE = "rakam/oran/tarih";
function hasUnsourcedFigure(text: string): boolean {
  const withoutLinks = text
    .split(/\s+/)
    .filter((token) => !/[/@]|\.\p{L}{2,}/u.test(token))
    .join(" ");
  return /(^|[^\p{L}\p{N}])\p{N}/u.test(withoutLinks);
}

export function findExpertCopyIssues(pkg: Pick<ContentPackage, "hook" | "caption" | "slides">): string[] {
  const raw = [pkg.hook, pkg.caption, ...pkg.slides.flatMap((s) => [s.headline, s.body, ...s.facts])].join("\n");
  const text = normalized(raw);
  const phrases = [...UNSUPPORTED_GENERALISATIONS, ...EXPERT_JARGON, ...GENERIC_PHRASES, ...LEGAL_RULING_PHRASES].filter(
    (phrase) => contains(text, phrase),
  );
  return hasUnsourcedFigure(raw) ? [...phrases, EXPERT_FIGURE_ISSUE] : phrases;
}
