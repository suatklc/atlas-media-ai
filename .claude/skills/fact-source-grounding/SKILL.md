---
name: fact-source-grounding
description: Use whenever generating, reviewing, or validating factual claims in Atlas content (ContentPackage generation, caption/slide copy, prompt changes touching facts/dates/numbers). A guardrail against unsupported factual claims — not a general research skill. Trigger on requests like "generate the content package", "review this for factual accuracy", "does this claim have source support".
---

# Fact / Source Grounding

Guardrail against unsupported factual claims in Atlas-generated content.
This is a constraint skill, not a research methodology — it doesn't teach
how to research, only what a generated claim is allowed to assert.

## The core rule

Every precise factual statement must be traceable to the evidence
actually supplied (the source/topic context passed into the generation
call). If it isn't in the evidence, it doesn't go in the output —
full stop.

Requires explicit source support: dates, prices, fees, percentages,
legal/regulatory requirements, official procedures, statistics,
quotations, deadlines, exemptions.

## SOURCE FACT vs. EXPERT INTERPRETATION

Keep these two visibly distinct in every output:

- **SOURCE FACT** — something the source itself states. State it as
  fact, attributed to the source.
- **EXPERT INTERPRETATION** — a professional reading derived from the
  verified facts (e.g. "bu gelişme ... gösteriyor/gündeme getiriyor").
  Allowed and often valuable, but must be clearly framed as
  interpretation and must never smuggle in a new factual claim under the
  cover of "interpretation."

## Do not

- Do not turn ambiguity into certainty (a source saying "approximately
  150,000 TL" never becomes an itemized breakdown that wasn't given).
- Do not infer a regulatory/legal obligation unless the source explicitly
  supports it.
- Do not manufacture numbers, dates, fees, percentages, legal
  requirements, procedures, or market statistics to fill a gap.
- Do not let a caption/slide state a number that doesn't also appear,
  consistently, in the package's own facts.

## When evidence is insufficient

Prefer a narrower, honestly-scoped claim over a confident invented one.
State uncertainty or omit the claim entirely — never fabricate missing
source content to make a section feel more complete.

## Applying this

This skill is a checklist for judging output, not a license to patch
prompts reactively. If a real generation produces an unsupported claim,
treat it as a signal to investigate why the grounding broke (what
evidence was actually passed in, and whether the generation step used
it correctly) — not as a cue to bolt on another prompt rule. See
CLAUDE.md's "Known Open Risk — Source Grounding" section: a full
root-cause audit of this pipeline is planned and already scoped: don't
pre-empt it with ad hoc fixes.

The `ContentPackage` structural validator (`src/lib/ai/content/
contentPackage.ts`) already enforces some of this deterministically
(arithmetic consistency, cross-field number consistency). Do not weaken
those checks — this skill's rules are the editorial layer on top, not a
replacement for them.
