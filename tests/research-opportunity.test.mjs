import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same loader convention as tests/output-mode.test.mjs and
// tests/educational-metadata.test.mjs: transpile one TS source file via the
// project's own `typescript` package, run it in a fresh VM context, and
// resolve its relative imports through a small dependencyLoader map. Type-
// only imports (import type { ... }) are erased by transpileModule, so
// files whose only imports are type-only (research/opportunity.ts,
// context/businessProfile.ts) need no dependencyLoader at all.
function loadTypeScriptModule(relativePath, dependencyLoader = () => ({})) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

// Full, real ContentPlan -> CreativeBrief chain, loaded exactly the way
// output-mode.test.mjs already loads it — proves this task reused the
// EXISTING pipeline rather than introducing a parallel one.
const intent = loadTypeScriptModule("src/lib/ai/content/intent.ts");
const goal = loadTypeScriptModule("src/lib/ai/content/goal.ts");
const audience = loadTypeScriptModule("src/lib/ai/content/audience.ts");
const format = loadTypeScriptModule("src/lib/ai/content/format.ts");
const templates = loadTypeScriptModule("src/lib/ai/content/templates.ts");
const plan = loadTypeScriptModule("src/lib/ai/content/plan.ts", (specifier) => ({
  "./intent": intent,
  "./goal": goal,
  "./audience": audience,
  "./format": format,
  "./templates": templates,
})[specifier] ?? {});
const lookups = loadTypeScriptModule("src/lib/ai/creative/lookups.ts");
const brief = loadTypeScriptModule("src/lib/ai/creative/brief.ts", (specifier) =>
  specifier === "./lookups" ? lookups : {},
);

const opportunity = loadTypeScriptModule("src/lib/ai/research/opportunity.ts");
const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");

// --- Fixtures (no network calls — plain data objects) ---

const MORTGAGE_OPPORTUNITY = {
  topic: "Konut kredisi faiz oranlarındaki güncel değişim",
  angle: "Faiz değişiminin alıcı kararlarına etkisi",
  whyNow: "TCMB'nin son politika faizi kararı konut kredisi maliyetlerini doğrudan etkiliyor",
  keyFacts: [
    "Politika faizi son toplantıda güncellendi",
    "Bankaların konut kredisi faiz oranları buna paralel değişti",
  ],
  sources: [
    {
      title: "Politika Faizi Kararı",
      publisher: "TCMB",
      url: "https://www.tcmb.gov.tr/ornek-karar",
      publishedAt: "2026-08-20",
      tier: "official-authority",
    },
  ],
  freshness: "recent",
  suggestedContentType: "market-stats",
  riskCaveat: "Faiz oranları hızla değişebilir; kesin güncel oran için ilgili bankayla teyit önerilmeli.",
};

const REGIONAL_OPPORTUNITY = {
  topic: "Zekeriyaköy'de villa talebindeki bölgesel gelişmeler",
  angle: "Bölgedeki arz/talep dengesinin fiyatlara yansıması",
  whyNow: "Bölgede yeni altyapı projeleri gündemde",
  keyFacts: ["Bölgedeki villa talebi son dönemde arttı"],
  sources: [
    {
      title: "Bölgesel Emlak Raporu",
      publisher: "Sarıyer Belediyesi",
      url: "https://www.sariyer.bel.tr/ornek-rapor",
      publishedAt: "2026-07-15",
      tier: "official-authority",
    },
    {
      title: "Piyasa Yorumu",
      publisher: "Bir Emlak Blogu",
      url: "https://ornek-blog.example/yorum",
      publishedAt: "2026-08-01",
      tier: "commentary",
    },
  ],
  freshness: "recent",
  audience: "villa-buyer",
  // Corrected (Handoff — content-intent priority fix): this opportunity's
  // topic/angle describe regional demand/supply-price dynamics — market
  // information, not an actual "list this property for sale" request. It
  // was originally authored as suggestedContentType: "listing", which
  // caused buildSeedMessage's wording hint to inject explicit "satılık"
  // (for-sale) language into the seed message — a genuine listing-purpose
  // signal, not a subject-noun false positive, so it wasn't wrong given
  // that hint, but the hint itself didn't match this fixture's actual
  // content. Corrected to reflect what this opportunity is actually about.
  suggestedContentType: "market-stats",
};

const REGULATORY_OPPORTUNITY = {
  topic: "Tapu işlemlerinde güncel prosedür değişiklikleri",
  angle: "Alıcıların yeni süreçte dikkat etmesi gereken adımlar",
  whyNow: "Tapu ve Kadastro Genel Müdürlüğü işlem prosedüründe güncelleme yaptı",
  keyFacts: ["Bazı işlemler artık e-Devlet üzerinden tamamlanabiliyor"],
  sources: [
    {
      title: "Tapu İşlemleri Duyurusu",
      publisher: "Tapu ve Kadastro Genel Müdürlüğü",
      url: "https://www.tkgm.gov.tr/ornek-duyuru",
      publishedAt: "2026-06-10",
      tier: "official-authority",
    },
  ],
  freshness: "evergreen-adjacent",
  suggestedContentType: "educational",
  riskCaveat: "Bu bilgi genel bilgilendirme amaçlıdır; bireysel işlemler için resmi kurumla teyit edilmelidir.",
};

const FIXTURES = [
  ["mortgage / interest-rate", MORTGAGE_OPPORTUNITY],
  ["Zekeriyaköy / Sarıyer regional", REGIONAL_OPPORTUNITY],
  ["regulatory / property-documentation", REGULATORY_OPPORTUNITY],
];

for (const [label, fixture] of FIXTURES) {
  test(`${label}: isContentOpportunity accepts the fixture`, () => {
    assert.equal(opportunity.isContentOpportunity(fixture), true);
  });

  test(`${label}: travels ContentOpportunity -> buildSeedMessage -> buildContentPlan -> buildCreativeBrief -> buildResearchDirective`, () => {
    const seed = opportunity.buildSeedMessage(fixture);
    assert.equal(typeof seed, "string");
    assert.ok(seed.length > 0);
    assert.ok(seed.includes(fixture.topic), "seed message must carry the opportunity's topic verbatim");
    assert.ok(seed.includes(fixture.angle), "seed message must carry the opportunity's angle verbatim");

    // The EXISTING, unmodified pipeline — proves buildContentPlan/
    // buildCreativeBrief needed no changes and no bypass.
    const contentPlan = plan.buildContentPlan(seed);
    assert.notEqual(contentPlan.intent, "none", `expected a non-none intent for seed: "${seed}"`);
    assert.ok(contentPlan.template, `expected a resolved template for seed: "${seed}"`);

    const creativeBrief = brief.buildCreativeBrief(contentPlan);
    assert.ok(creativeBrief, "expected a CreativeBrief for a non-none ContentPlan");
    assert.ok(creativeBrief.execution.dimensionsPx);

    const directive = opportunity.buildResearchDirective(fixture);
    assert.equal(typeof directive, "string");
    assert.ok(directive.length > 0);
    assert.ok(directive.length <= 900, "research directive must respect its character cap");
    assert.match(directive, /\[Dahili araştırma zemini/);
    assert.match(directive, /uydurma/, "must instruct against inventing facts/statistics");
    if (fixture.riskCaveat) {
      assert.ok(directive.includes(fixture.riskCaveat), "riskCaveat must influence the directive wording");
    }
  });
}

test("buildResearchDirective: all-commentary sources trigger the stronger non-fact wording", () => {
  const commentaryOnly = {
    topic: "Piyasa görüşleri",
    angle: "Uzman yorumları",
    whyNow: "",
    keyFacts: [],
    sources: [
      {
        title: "Görüş yazısı",
        publisher: "Bir Blog",
        url: "https://ornek-blog.example/gorus",
        publishedAt: "2026-08-10",
        tier: "commentary",
      },
    ],
    freshness: "recent",
  };
  const directive = opportunity.buildResearchDirective(commentaryOnly);
  assert.match(directive, /Tüm kaynaklar ikincil yorum niteliğindedir/);
});

test("buildResearchDirective: mixed-tier sources use the general (non-'all commentary') wording", () => {
  const directive = opportunity.buildResearchDirective(REGIONAL_OPPORTUNITY);
  assert.doesNotMatch(directive, /Tüm kaynaklar ikincil yorum niteliğindedir/);
  assert.match(directive, /kaynağın niteliğini belirt/);
});

test("isContentOpportunity rejects malformed shapes", () => {
  assert.equal(opportunity.isContentOpportunity(undefined), false);
  assert.equal(opportunity.isContentOpportunity(null), false);
  assert.equal(opportunity.isContentOpportunity({}), false);
  assert.equal(
    opportunity.isContentOpportunity({ ...MORTGAGE_OPPORTUNITY, topic: "" }),
    false,
    "empty topic must be rejected",
  );
  assert.equal(
    opportunity.isContentOpportunity({ ...MORTGAGE_OPPORTUNITY, freshness: "sometime" }),
    false,
    "invalid freshness value must be rejected",
  );
  assert.equal(
    opportunity.isContentOpportunity({
      ...MORTGAGE_OPPORTUNITY,
      sources: [{ ...MORTGAGE_OPPORTUNITY.sources[0], tier: "made-up-tier" }],
    }),
    false,
    "invalid source tier must be rejected",
  );
  assert.equal(
    opportunity.isContentOpportunity({ ...MORTGAGE_OPPORTUNITY, sources: "not-an-array" }),
    false,
  );
});

test("BusinessProfile: Zekeriyaköy/Sarıyer geography lives only in the profile layer", () => {
  const profile = businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE;
  assert.equal(profile.industry, "real-estate");
  assert.equal(profile.geography.primary, "Zekeriyaköy");
  assert.ok(profile.geography.nearby.includes("Sarıyer"));
  assert.ok(profile.geography.nearby.includes("Uskumruköy"));
  assert.ok(profile.expertiseTopics.length > 0);
  // .length check rather than assert.deepEqual against a literal []: the
  // profile object crosses a vm.runInNewContext realm boundary, and
  // deepStrictEqual (what assert.deepEqual resolves to from
  // "node:assert/strict") treats a same-realm [] and a cross-realm [] as
  // structurally different — the same reason other tests in this suite
  // (see educational-metadata.test.mjs's plain() helper) normalize
  // cross-realm values before comparing them.
  assert.equal(profile.excludedTopics.length, 0);
});

test("global architecture files never reference Zekeriyaköy/Sarıyer by name", () => {
  const globalFiles = [
    "src/lib/ai/content/plan.ts",
    "src/lib/ai/content/intent.ts",
    "src/lib/ai/content/goal.ts",
    "src/lib/ai/content/audience.ts",
    "src/lib/ai/content/format.ts",
    "src/lib/ai/content/templates.ts",
    "src/lib/ai/content/directive.ts",
    "src/lib/ai/creative/brief.ts",
    "src/lib/ai/creative/directive.ts",
    "src/lib/ai/creative/lookups.ts",
    "src/lib/ai/creative/image-prompt.ts",
    "src/lib/ai/platform/config.ts",
    "src/lib/ai/platform/copy.ts",
    "src/lib/publishing/router.ts",
    "src/lib/publishing/eligibility.ts",
  ];
  for (const relativePath of globalFiles) {
    const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /Zekeriyaköy|Sarıyer/i, `${relativePath} must not hard-code geography`);
  }
});

test("assistant route: research integration is additive-only — behavior is byte-identical when contentOpportunity is absent", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");

  // message validation (required, non-empty, max length) still runs for
  // every ordinary chat message — as of the Current Content Opportunities
  // UI task, this check is scoped to `!contentOpportunity` (a valid
  // ContentOpportunity now makes `message` itself optional, since it
  // supplies its own seed message), but for every request that has NO
  // contentOpportunity at all — every existing/ordinary caller — this
  // exact validation still runs, unchanged.
  assert.match(routeSource, /if \(!contentOpportunity\) \{/);
  assert.match(routeSource, /if \(typeof message !== "string" \|\| message\.trim\(\)\.length === 0\)/);

  // contentOpportunity is optional and defaults to undefined on anything
  // malformed — never a 400, never required.
  assert.match(
    routeSource,
    /const contentOpportunity = isContentOpportunity\(rawContentOpportunity\) \? rawContentOpportunity : undefined;/,
  );

  // effectiveMessage falls back to message.trim() byte-identically when
  // contentOpportunity is absent/invalid — the entire safety property this
  // task depends on for "ordinary flow unchanged". (message as string) is
  // a safe cast, not a behavior change: the branch above already proved
  // `message` is a validated non-empty string whenever this branch runs.
  assert.match(
    routeSource,
    /const effectiveMessage = contentOpportunity\s*\n\s*\? `\$\{buildSeedMessage\(contentOpportunity\)\} Tek görsel üret\.`\s*\n\s*: \(message as string\)\.trim\(\);/,
  );

  // The research directive is a no-op ("") when contentOpportunity is
  // absent, same pattern as every other optional directive in this route.
  assert.match(
    routeSource,
    /const researchDirective = contentOpportunity \? buildResearchDirective\(contentOpportunity\) : "";/,
  );
});
