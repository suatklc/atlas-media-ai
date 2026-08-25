import type { ContentIntent } from "../content/types";
import type { CreativeBrief } from "./types";

const NOT_APPLICABLE = "uygulanamaz";

// Deliberately exhaustive (not just "no text") — a shorter prohibition left
// room for the model to still add titles/labels/CTA-like graphics while
// technically avoiding "text". Applies to every template unconditionally:
// every current visual (hero included) is built on the same "AI generates a
// clean base image, Atlas renders all typography deterministically"
// architecture, so a stronger prohibition here is never in tension with any
// template's own goals.
const SAFETY_CLAUSE =
  "Görselde hiçbir okunabilir metin, harf, rakam, başlık, alt başlık, etiket, madde işareti veya liste metni, hashtag, CTA/buton metni, logo yazısı, watermark, tabela, arayüz/kart metni, infografik yazısı veya okunması amaçlanan tipografik/grafik öğe olmasın; yalnızca temiz görsel sahne, fotoğraf veya illüstrasyon; bozuk/deforme mimari veya imkânsız geometri olmasın.";

const PHOTOGRAPHY_QUALITY_CLAUSE =
  "üst düzey mimari fotoğrafçılık, editoryal emlak fotoğrafçılığı kalitesinde; gerçekçi malzemeler, gerçekçi ışık, doğal mimari oranlar, ticari kullanıma uygun kompozisyon, fotogerçekçi; sürreal veya abartılı mimari yok";

// Deliberately atmosphere-only, not location-specific: any neighborhood the
// user names must never be rendered as identifiable real streets/buildings —
// this is a conceptual visual, and the existing listing disclaimer already
// says so. Fires unconditionally (harmless when no place is mentioned).
const GEOGRAPHIC_CONTEXT_CLAUSE =
  "Talepte belirli bir semt/bölge geçiyorsa yalnızca genel atmosferini yansıt (yoğunluk, yeşillik, mahremiyet, prestij seviyesi); gerçek, tanınabilir sokak, bina veya dönüm noktası betimleme.";

// Reworded to drop "başlık/logo" — naming what goes there risked reading as
// an instruction to sketch a title/logo placeholder in that space rather
// than leaving it genuinely empty. Now states only that it's reserved for
// later digital addition and explicitly forbids drawing anything there.
const NEGATIVE_SPACE_CLAUSE =
  "Kompozisyonda, sonradan dijital olarak metin ve marka öğeleri eklenecek sade, dolu olmayan bir alan bırak; bu alana kendin herhangi bir yazı, sembol veya grafik ekleme.";

// ===== Primary Visual Subject =====
//
// Root cause (read-only Nano Banana Pro benchmark audit): CreativeBrief's
// imagerySubject is entirely audience/intent/template lookup-table prose
// (see brief.ts/lookups.ts) — it never reads the user's message, so a
// request explicitly about an interior ("...villa için modern salon ve
// yaşam alanı odaklı...") still inherited villa-buyer's hardcoded exterior
// hint ("dış cephe ve bahçe genel görünüm"), and a request explicitly
// excluding a villa ("...ana konusu yapı veya villa değil...") still got a
// positive "villa tipolojisinde bir yapı" clause because the descriptor
// matcher had no negation awareness. This section adds a small, message-
// derived classification of what the image is fundamentally supposed to
// depict, and a matching negation guard, so explicit subject/exclusion
// wording in the user's own message outranks generic audience/template
// defaults. Deliberately not exported beyond what's needed to keep
// buildImagePrompt itself the only real public surface of this file.

export type PrimaryVisualSubject = "exterior" | "interior" | "land" | "neighborhood" | "abstract";

// JavaScript's \b word-boundary is ASCII-only (\w = [A-Za-z0-9_]), so it
// silently fails at the edge of a Turkish word ending in ç/ğ/ı/ö/ş/ü —
// \btaş\b never actually matches "taş " because "ş" isn't a \w character,
// so the boundary check between "ş" and the following space fails. This
// builds an equivalent boundary using explicit Turkish-aware lookaround
// instead of \w. Only needed for single words whose first/last letter is
// one of those six characters (e.g. "taş"); words that start and end in
// plain ASCII letters (even if they contain a Turkish letter internally,
// like "ahşap") are unaffected and use plain \b as before.
const TURKISH_WORD_CHARS = "a-zA-ZçğıöşüÇĞİÖŞÜ0-9_";
function turkishWordBoundarySource(word: string): string {
  return `(?<![${TURKISH_WORD_CHARS}])${word}(?![${TURKISH_WORD_CHARS}])`;
}

// Small, reusable, conservative negation guard — not full linguistic
// parsing, just a fixed marker list checked within a short word window
// immediately around a matched term, same conservative style as every
// other evidence-gated mechanism in this file. Turkish negation typically
// follows the noun ("villa değil", "havuz yok", "havuz olmasın"); English
// negation typically precedes it ("no pool", "not a villa", "without a
// pool") — both directions are checked so an excluded concept can never be
// converted into a positive visual instruction.
const NEGATION_MARKERS_AFTER = ["değil", "yok", "olmasın"];
const NEGATION_MARKERS_BEFORE = ["no", "not", "without"];
const NEGATION_WINDOW_WORDS = 4;

function normalizeNegationToken(word: string): string {
  return word.toLocaleLowerCase("tr-TR").replace(/^[.,;:!?'"]+|[.,;:!?'"]+$/g, "");
}

// A word-count window alone isn't enough: in "villa, havuz olmasın." the
// negation marker "olmasın" (negating "havuz") sits within 4 words of
// "villa" too, on the far side of a comma — without a clause boundary, that
// marker would incorrectly negate "villa" as well. This trims the window to
// the nearest clause boundary (.,;: or newline) first, so a negation marker
// belonging to a different clause can never cross into this one.
const CLAUSE_BOUNDARY_PATTERN = /[.,;:\n]/;

function clauseScopedWindow(text: string, direction: "before" | "after"): string {
  if (direction === "after") {
    const boundaryIndex = text.search(CLAUSE_BOUNDARY_PATTERN);
    return boundaryIndex === -1 ? text : text.slice(0, boundaryIndex);
  }
  const reversed = [...text].reverse().join("");
  const boundaryIndex = reversed.search(CLAUSE_BOUNDARY_PATTERN);
  return boundaryIndex === -1 ? text : text.slice(text.length - boundaryIndex);
}

function isNegatedMatch(text: string, matchIndex: number, matchLength: number): boolean {
  const before = clauseScopedWindow(text.slice(0, matchIndex), "before")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-NEGATION_WINDOW_WORDS);
  const after = clauseScopedWindow(text.slice(matchIndex + matchLength), "after")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, NEGATION_WINDOW_WORDS);

  if (after.some((word) => NEGATION_MARKERS_AFTER.includes(normalizeNegationToken(word)))) {
    return true;
  }
  return before.some((word) => NEGATION_MARKERS_BEFORE.includes(normalizeNegationToken(word)));
}

// Checked in this fixed priority order — explicit visual-subject wording
// (interior/land/neighborhood) always outranks the generic property-type
// tier (exterior, which "villa"/"ev"/"daire" alone fall into). This is what
// lets "villa için modern salon ve yaşam alanı odaklı" resolve to
// "interior" rather than "exterior": salon/yaşam alanı is checked before
// exterior's own villa pattern is ever reached. Each candidate match is run
// through the same negation guard used for the descriptor/hard-requirement
// tables below, so "villa değil" can never resolve to "exterior" via its
// own villa pattern either. "çevre" is deliberately NOT a neighborhood
// trigger on its own — it's too ambiguous between "the neighborhood is the
// subject" and "atmosphere around a property that IS the subject" to be a
// safe, conservative signal; only explicit "mahalle"/"semt"/"neighborhood"
// count as the requested subject itself.
type SubjectSignal = { subject: Exclude<PrimaryVisualSubject, "abstract">; patterns: RegExp[] };

const SUBJECT_SIGNALS: SubjectSignal[] = [
  {
    subject: "interior",
    patterns: [
      /\bsalon\b/i,
      /iç mekan|iç mekân/i,
      /yaşam alanı/i,
      /oturma odası/i,
      /living room/i,
      /\binterior\b/i,
    ],
  },
  {
    subject: "land",
    patterns: [/\barsa\b/i, /\barazi\b/i, /\bparsel\b/i, /\bland\b/i, /\bparcel\b/i],
  },
  {
    subject: "neighborhood",
    patterns: [/\bmahalle\b/i, /\bsemt\b/i, /\bneighborhood\b/i],
  },
  {
    subject: "exterior",
    patterns: [
      /dış cephe/i,
      /façade|facade/i,
      /\bvilla\b/i,
      /\bev\b/i,
      /\bdaire\b/i,
      /\bexterior\b/i,
    ],
  },
];

function hasUnnegatedMatch(originalMessage: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    const match = pattern.exec(originalMessage);
    return match !== null && !isNegatedMatch(originalMessage, match.index, match[0].length);
  });
}

// Message-derived only — never reads ContentPlan/CreativeBrief's own
// audience/template defaults, since those are exactly what this exists to
// outrank when the message itself is explicit. Educational content (no
// concrete physical scene to preserve — see the educational branch in
// buildImagePrompt) and any message with no explicit subject signal both
// resolve to "abstract", which buildImagePrompt treats as today's existing
// default behavior — never a new forced framing.
export function detectPrimaryVisualSubject(
  originalMessage: string | undefined,
  intent?: ContentIntent,
): PrimaryVisualSubject {
  if (intent === "educational" || !originalMessage) {
    return "abstract";
  }
  for (const signal of SUBJECT_SIGNALS) {
    if (hasUnnegatedMatch(originalMessage, signal.patterns)) {
      return signal.subject;
    }
  }
  return "abstract";
}

// Pushed first, ahead of every other clause, so the primary subject
// establishes scene hierarchy before secondary aesthetic/material clauses.
// "exterior" and "abstract" intentionally have no entry here — both keep
// today's existing (pre-this-package) behavior unchanged, since exterior is
// already the working case and abstract has no better evidence to lead with.
const SUBJECT_LEAD_CLAUSES: Partial<Record<PrimaryVisualSubject, string>> = {
  interior: "Görselin ana konusu ve kompozisyonun odağı bir İÇ MEKÂN (salon/yaşam alanı) olmalı; dış cephe, bina dışı görünüm veya bahçe ana unsur ya da kompozisyonun odağı OLMAMALI — yalnızca pencereden/cam yüzeyden doğal bir bağlam olarak görünebilir",
  land: "Görselin ana konusu ve kompozisyonun odağı bir ARAZİ/PARSEL olmalı; herhangi bir bina, villa veya yapı kompozisyonun ana unsuru ya da odağı OLMAMALI; yalnızca doğal çevre içinde, gelişime uygun bir arazi net şekilde görünsün",
  neighborhood: "Görselin ana konusu ve kompozisyonun odağı belirli bir binadan çok, mahalle/çevre atmosferi olmalı; belirli bir yapı veya villa kompozisyonun tek/ana kahramanı olmamalı",
};

// Small, deliberately bounded set of hard property requirements that
// CreativeBrief cannot carry (it's built entirely from audience/intent/
// goal/template lookup tables — see brief.ts — and never reads the user's
// literal request text). Without this, a stated pool/garden/luxury level
// never reaches the image prompt at all, regardless of how strongly the
// user stated it. Intentionally not a general NLP extraction system — only
// the concrete, verifiable attributes this fix was scoped to address.
// subjectOverrides lets a term's clause be reframed (never simply dropped)
// for a specific PrimaryVisualSubject — currently only "bahçe"/"garden"
// need this: when the primary subject is "interior", a garden mention is
// evidence for a background/through-window visual connection, not a
// standalone exterior hero requirement.
type HardRequirementTerm = {
  pattern: RegExp;
  clause: string;
  subjectOverrides?: Partial<Record<PrimaryVisualSubject, string>>;
};

const INTERIOR_GARDEN_CONTEXT_CLAUSE =
  "büyük cam yüzeylerden/pencerelerden bahçeyle doğal bir görsel bağlantı olsun; bahçe yalnızca arka plan/ikincil bağlam olmalı, ana görsel odak olmamalı";

const HARD_REQUIREMENT_TERMS: HardRequirementTerm[] = [
  {
    pattern: /havuz/i,
    clause:
      "Görselde net ve belirgin şekilde görünen bir yüzme havuzu MUTLAKA bulunmalı; havuz kompozisyonun görünür, öne çıkan bir parçası olmalı, arka planda kaybolmamalı",
  },
  {
    pattern: /bahçe/i,
    clause: "Görselde özel, bakımlı bir bahçe/yeşil alan MUTLAKA bulunmalı",
    subjectOverrides: { interior: INTERIOR_GARDEN_CONTEXT_CLAUSE },
  },
  {
    // English mirror of the "bahçe" entry above (same clause/override), so
    // an English request gets the same garden handling a Turkish one does.
    pattern: /\bgarden\b/i,
    clause: "Görselde özel, bakımlı bir bahçe/yeşil alan MUTLAKA bulunmalı",
    subjectOverrides: { interior: INTERIOR_GARDEN_CONTEXT_CLAUSE },
  },
  {
    pattern: /(lüks|üst segment|premium)/i,
    clause:
      "Genel sunum belirgin şekilde lüks/üst segment bir mülkü yansıtmalı: kaliteli malzemeler, özenli peyzaj, sofistike ama gerçekçi bir hava; sıradan/mütevazı bir yapı gibi görünmemeli",
  },
];

function extractHardRequirementClauses(
  originalMessage: string | undefined,
  subject: PrimaryVisualSubject,
): string[] {
  if (!originalMessage) {
    return [];
  }
  const clauses: string[] = [];
  for (const term of HARD_REQUIREMENT_TERMS) {
    const match = term.pattern.exec(originalMessage);
    if (match && !isNegatedMatch(originalMessage, match.index, match[0].length)) {
      clauses.push(term.subjectOverrides?.[subject] ?? term.clause);
    }
  }
  return clauses;
}

// Live-verified root cause (a Seedream v4.5 benchmark base image contained
// fake/garbled typography — a mangled rendering of a neighborhood name):
// embedding originalMessage verbatim (the previous behavior here) exposes
// literal proper nouns — project names, neighborhood names — to the image
// model, and a strongly text-capable model can attempt to render that
// literal text as in-scene signage/labels even though SAFETY_CLAUSE already
// forbids it. Same technique as HARD_REQUIREMENT_TERMS above, but for
// supporting architectural/material/interior/nature descriptors rather than
// hard "must include" requirements: each entry emits a FIXED, pre-written
// clause — never a copy of the user's own wording — only when its trigger
// is actually present. Because only vetted, generic, non-proper-noun
// clauses can ever be produced, a project/brand/place name anywhere in
// the message can never leak into the image prompt, regardless of how many
// different real names Atlas is ever used with — this is an allowlist of
// safe concepts, not a denylist trying to detect every possible name (which
// would need real NER to be reliable). Bilingual (Turkish + English), since
// Atlas accepts mixed-language prompts (see content/intent.ts). Deliberately
// small and literal, not a general NLP/NER system — mirrors
// HARD_REQUIREMENT_TERMS's own scale and style.
// excludeForSubjects: a structure/typology clause (villa/residence) is
// evidence of property TYPE, not of the requested visual subject — when the
// message has already established "land" or "neighborhood" as the primary
// subject, a structure/building must not dominate the scene (see the audit:
// "villa tipolojisinde bir yapı" appearing alongside "arazi/parsel genel
// görünüm" was a direct, self-contradictory prompt), so these two entries
// are suppressed for those subjects specifically.
type VisualDescriptorTerm = {
  pattern: RegExp;
  clause: string;
  excludeForSubjects?: PrimaryVisualSubject[];
};

const VISUAL_DESCRIPTOR_TERMS: VisualDescriptorTerm[] = [
  {
    pattern: /(contemporary architecture|çağdaş mimari|modern mimari)/i,
    clause: "çağdaş/modern mimari çizgiler",
  },
  {
    // Paired specifically with a room/interior word ("geniş ve ferah
    // salon", "spacious living room"), not bare "geniş"/"spacious" alone —
    // those also legitimately describe a garden/parcel size ("geniş
    // bahçeli", "geniş bir arazi"), which would be a false positive for an
    // "interior feeling" clause in an exterior/land context.
    pattern: /(spacious interior|geniş iç mekan|ferah iç mekan|geniş ve ferah salon|geniş salon|ferah salon|spacious (living room|room))/i,
    clause: "geniş, ferah iç mekan hissi",
  },
  {
    pattern: /(private garden|özel bahçe)/i,
    clause: "özel, bakımlı bir bahçe/yeşil alan",
  },
  {
    pattern: /(natural (surroundings|environment)|doğal çevre|doğayla iç içe)/i,
    clause: "doğal, yeşil çevresiyle uyumlu bir konum hissi",
  },
  {
    pattern: /(\bforest\b|orman)/i,
    clause: "ormanlık/yeşil doku çevresi",
  },
  {
    pattern: /(coastal|waterfront|\bsahil\b|deniz kıyısı)/i,
    clause: "sahil/kıyı atmosferi",
  },
  {
    // \btaş\b alone would silently never match ("ş" fails the ASCII \b
    // check — see turkishWordBoundarySource above); this pairs the fixed
    // Turkish-aware boundary with the existing ASCII-safe alternatives.
    pattern: new RegExp(
      `(stone facade|taş cephe|${turkishWordBoundarySource("taş")}|\\bstone\\b)`,
      "i",
    ),
    clause: "taş doku/malzeme vurgusu",
  },
  {
    pattern: /(wood(en)? (detail|accent)|ahşap detay|\bahşap\b|\bwood(en)?\b)/i,
    clause: "ahşap doku/malzeme vurgusu",
  },
  {
    pattern: /(\bpool\b|swimming pool)/i,
    clause: "yüzme havuzu",
  },
  {
    pattern: /\bvilla\b/i,
    clause: "villa tipolojisinde bir yapı",
    excludeForSubjects: ["land", "neighborhood"],
  },
  {
    pattern: /(\bresidence(s)?\b|\bapartment(s)?\b|\bdaire\b|\bkonut\b)/i,
    clause: "konut/residence tipolojisinde bir yapı",
    excludeForSubjects: ["land", "neighborhood"],
  },
  {
    pattern: /\bmodern\b/i,
    clause: "modern tasarım dili",
  },
];

function extractVisualDescriptorClauses(
  originalMessage: string | undefined,
  subject: PrimaryVisualSubject,
): string[] {
  if (!originalMessage) {
    return [];
  }
  const clauses: string[] = [];
  for (const term of VISUAL_DESCRIPTOR_TERMS) {
    if (term.excludeForSubjects?.includes(subject)) {
      continue;
    }
    const match = term.pattern.exec(originalMessage);
    if (match && !isNegatedMatch(originalMessage, match.index, match[0].length)) {
      clauses.push(term.clause);
    }
  }
  return clauses;
}

// True for photography-based intents (listing, announcement); false for
// icon/illustration-based ones (educational, comparison, market-stats),
// which already signal this via cameraDirection === NOT_APPLICABLE. Reused
// here so photography-only direction — and physical-scene hard requirements
// like "a visible pool" — never contradict an icon/illustration brief.
function isPhotographicBrief(cameraDirection: string): boolean {
  return cameraDirection !== NOT_APPLICABLE;
}

// Live-verified root cause (educational base images still contained a
// baked-in three-line title even after SAFETY_CLAUSE/sanitizeImageryTreatment
// were strengthened): the general clause vocabulary below still described a
// COMPLETED artifact for educational content specifically —
// (a) originalMessage was embedded verbatim as "mülk detayları", but for a
//     content-generation request that text itself contains instructions
//     meant for Claude ("başlık kısa olsun", "hashtag ekle"), which the
//     image model read as instructions to draw a title and hashtags;
// (b) e.composition for EDUCATIONAL_CAROUSEL_01 includes "ana kavram/veri
//     öne çıkarılmalı" (foreground the core concept/data) — visual-hierarchy
//     language that invites text/infographic thinking.
// Educational images are generic icon/illustration/property-context visuals
// never tied to specific stated property attributes the way listing images
// are (isPhotographic is already false for educational, so
// extractHardRequirementClauses was never applied to it either) — so unlike
// hero/listing, dropping originalMessage/composition/imagerySubject entirely
// for this branch costs nothing real and removes the leak at its source.
const EDUCATIONAL_BACKGROUND_CLAUSE =
  "Sonradan grafik tasarımla üzerine kompozisyon eklenecek, gayrimenkul/mülk/arazi temalı, tamamen görsel bir arka plan sahnesi veya fotoğrafı oluştur; yalnızca görsel sahneyi göster. İnfografik, poster, sosyal medya kartı veya bitmiş bir gönderi tasarlama; başlık, madde listesi, numaralandırılmış konu yapısı veya herhangi bir yazılı bilgi bloğu oluşturma. Sonradan eklenecek katmanlar için bol, temiz negatif alan bırak; yalnızca görsel konu/sahne içeriği kullan.";

// Pure string assembly only — no API calls, no environment access. Reads
// brief.execution's photographic fields plus, when provided, evidence-gated
// descriptor clauses scanned from the user's original request text (see
// extractVisualDescriptorClauses above) — never the raw text itself.
// Deliberately excludes typographyHierarchy,
// textPlacement, logoPlacement, ctaVisualTreatment, headlineHookNote,
// structureConstraint and consistencyNote — those describe copy/branding/
// multi-slide structure that Atlas composites or plans deterministically
// elsewhere, never something the image model itself should be asked to
// render. Returns "" when there is no brief (mirrors buildCreativeDirective's
// no-op behavior). intent is optional and used only to route educational
// content to its dedicated background-only branch below — every other
// intent's behavior is unaffected by it.
export function buildImagePrompt(
  brief: CreativeBrief | undefined,
  originalMessage?: string,
  intent?: ContentIntent,
): string {
  if (!brief) {
    return "";
  }

  const { execution: e } = brief;

  if (intent === "educational") {
    const educationalClauses = [
      EDUCATIONAL_BACKGROUND_CLAUSE,
      `renk paleti: ${e.colorDirection}`,
      `format: ${e.aspectRatio} (${e.dimensionsPx}), Instagram gönderisi için`,
    ];
    return `${educationalClauses.join("; ")}. ${SAFETY_CLAUSE}`;
  }

  const subject = detectPrimaryVisualSubject(originalMessage, intent);
  const isPhotographic = isPhotographicBrief(e.cameraDirection);

  const clauses: string[] = [];

  const subjectLeadClause = SUBJECT_LEAD_CLAUSES[subject];
  if (subjectLeadClause) {
    clauses.push(subjectLeadClause);
  }

  if (isPhotographic) {
    clauses.push(...extractHardRequirementClauses(originalMessage, subject));
  }
  clauses.push(...extractVisualDescriptorClauses(originalMessage, subject));

  // e.imagerySubject is CreativeBrief's own audience/intent lookup-table
  // prose (see brief.ts/lookups.ts) — it can itself default to an
  // exterior/property-hero framing (e.g. villa-buyer's hardcoded "dış cephe
  // ve bahçe genel görünüm") that would directly contradict an explicit
  // interior/land/neighborhood subject already established above by the
  // lead clause. Once the message itself has provided that explicit
  // evidence, it outranks the generic lookup-table default; for "exterior"
  // and "abstract" (no better evidence than the lookup tables), this stays
  // exactly as it was before this package.
  if (subject === "exterior" || subject === "abstract") {
    clauses.push(e.imagerySubject);
  }
  clauses.push(sanitizeImageryTreatment(e.imageryTreatment));

  if (e.cameraDirection !== NOT_APPLICABLE) {
    clauses.push(`kamera açısı: ${e.cameraDirection}`);
  }
  if (e.lightingDirection !== NOT_APPLICABLE) {
    clauses.push(`ışık: ${e.lightingDirection}`);
  }

  clauses.push(`renk paleti: ${e.colorDirection}`);
  clauses.push(`kompozisyon: ${sanitizeComposition(e.composition)}`);
  if (isPhotographic) {
    clauses.push(PHOTOGRAPHY_QUALITY_CLAUSE);
  }
  clauses.push(GEOGRAPHIC_CONTEXT_CLAUSE);
  clauses.push(NEGATIVE_SPACE_CLAUSE);
  clauses.push(`format: ${e.aspectRatio} (${e.dimensionsPx}), Instagram gönderisi için`);

  return `${clauses.join("; ")}. ${SAFETY_CLAUSE}`;
}

// composition (from brief.ts) occasionally names the zone reserved for a
// later headline/CTA overlay — e.g. "overlay metin alanı", "başlık bandı",
// or the literal marketing abbreviation "CTA". Those are layout facts (an
// area to keep visually clean), not requests to render text, but passing
// the words themselves to an image model risks it filling that zone with
// placeholder glyphs. Reworded to pure spatial language; the trailing
// SAFETY_CLAUSE is the actual hard constraint, this is defense in depth.
function sanitizeComposition(composition: string): string {
  return composition
    .replace(/overlay metin alanı/gi, "boş overlay alanı")
    .replace(/başlık bandı/gi, "şerit")
    .replace(/CTA/g, "vurgu alanı");
}

// imageryTreatment (from brief.ts) ends with template.visualEmphasis
// (content/templates.ts's declarative catalog) verbatim — "text-forward"
// for EDUCATIONAL_CAROUSEL_01/ANNOUNCEMENT_01, "data-visualization" for
// COMPARISON_01/INFOGRAPHIC_01. Those are internal layout classifiers, not
// wording meant for the image model: sent unsanitized, they're a direct
// instruction to emphasize text/data typography in the base image,
// contradicting SAFETY_CLAUSE. Replaced with neutral, non-text-implying
// equivalents; everything else (audience mood wording, "photo-forward")
// passes through unchanged.
function sanitizeImageryTreatment(imageryTreatment: string): string {
  return imageryTreatment
    .replace(/text-forward/gi, "visual-context-forward")
    .replace(/data-visualization/gi, "diagrammatic-context");
}
