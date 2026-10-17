---
name: atlas-editorial-quality-gate
description: The final editorial gate for any Atlas content before it is shown to Suat Kılıç as ready — ContentPackage (5-slide carousel + caption + hashtags), single-image copy, or a Reel script. Answers one question: "Would Suat Kılıç publish this unchanged on his professional account?" and returns PASS or FAIL with the exact lines to fix. Trigger on "is this ready", "quality check", "gate this", "would Suat publish this", or automatically after every real ContentPackage/Reel generation.
---

# Atlas Editorial Quality Gate

One question decides the verdict:

> **Would Suat Kılıç publish this unchanged on his professional account?**

Schema-valid, test-passing, deterministic-check-passing output can still
FAIL here. Passing the gate is not approval either: only Suat approves,
and only Suat triggers publishing.

## Inputs you need

1. The ContentPackage (or Reel script) exactly as generated.
2. The source evidence it was built from — at minimum the Job 1 facts and,
   when present, the `NE DEĞİŞTİ —` (change) and `ARKA PLAN —`
   (background) sections Job 2 received. Without the source you cannot
   judge "what is new" — say so and FAIL rather than guess.

## Hard fails (any one = FAIL)

1. **Misleading about what is new.** Anything from `ARKA PLAN` (or any
   rule the source does not mark as changed) presented with novelty
   language: "artık", "yeni", "kaldırıldı", "değişti", "netleşti", "ilk
   kez", "bundan sonra". Also FAIL if the actual change (from `NE
   DEĞİŞTİ`) is missing from the hook, slide 1 or slide 2.
2. **Unsupported fact.** Any date, amount, duration, requirement,
   procedure, or consequence not traceable to the source facts. A
   publication date presented as an effective date.
3. **Wrong audience.** A rule that applies to one group (e.g. foreign
   buyers seeking citizenship) written as if it applies to every buyer.
4. **No expert interpretation.** Nothing beyond restating the source —
   no timing advice, no common mistake, no "question to ask before you
   sign". A press summary with a signature is not Suat's voice.
5. **Bureaucratic.** Reads like the circular: definitions, reference
   numbers in the hook ("İlgi (ğ) Makam Oluru"), passive legal voice,
   "usul ve esaslar" as content.
6. **Generic.** The hook or slide 5 would work unchanged for any other
   advisor or any other topic ("Doğru taşınmaz kadar doğru süreç de
   önemli"). If it isn't specific to this change, it fails.
7. **Repetitive.** Two slides carry the same idea, slide 5 summarizes 1–4,
   or the caption re-narrates the slides.
8. **Broken carousel.** Not exactly 5 slides in hook → what-happened →
   why-it-matters → what-to-do → cta order; a what-to-do slide without a
   real checklist.

## Craft checks (score each 1–10; any below 7 = FAIL)

| Check | 10 looks like |
| --- | --- |
| Change clarity | A reader knows in 3 seconds what changed and for whom |
| Expert value | At least one insight the source does not literally say |
| Hook | Passes the hook rubric below |
| Language | Natural Turkish an advisor would say out loud; no AI slop |
| Publish-readiness | Zero edits needed |

### Hook rubric (adapted from `ig-reel`'s hookscore.py, MIT)

Score the hook on five properties; the weakest one caps it:

- **Length** — 5–12 words (spoken ≤3s); on-screen version ≤6 words.
- **Specificity** — at least one concrete, grounded marker: a number,
  an institution, a named document, a duration.
- **Stakes** — something the reader could lose, miss, or get wrong.
- **Front-loading** — the payload in the first 3–4 words; no "Bu
  gelişme...", "Merhaba", "Bugün size...".
- **Address** — aimed at a person ("Vatandaşlık için ev alıyorsanız")
  rather than floating ("Bir genelge yayımlandı").

### Anti-slop (adapted from `ig-human`, MIT)

Flag and fix, don't just count:
- Em-dash chains, "sadece X değil, Y" constructions, rule-of-three triads,
  one-word rhetorical questions ("Peki sonuç?").
- Stock phrases: "önemli bir adım", "kritik önem taşıyor", "bilinçli
  hareket etmek", "güncel gelişmeler ışığında", "süreç daha öngörülebilir
  ilerler", "işlem kurgusu", "masada daha net ilerler".
- Reflex bait: "takip etmeyi unutmayın", "kaydet ve paylaş" walls,
  hashtag walls, emoji bullet lists.
- Invisible characters (zero-width spaces, soft hyphens) in the caption.

## Output format

```
GATE: PASS | FAIL
Would Suat publish this unchanged? YES | NO — <one sentence why>

Change (from source): <the actual change, one line>
Hook: "<hook>" — rubric weakest: <property>

Hard fails:
- <#n name>: "<exact offending text>" → <what it should say instead>

Craft scores: change <n> · expert <n> · hook <n> · language <n> · ready <n>

Fix list (only if FAIL):
1. <slide/caption location>: <concrete rewrite direction>
```

Never rewrite the content yourself inside the gate and call it PASS —
a FAIL goes back to generation (or, if the cause is a lost fact, to a
grounding investigation), then the new output is gated again.
