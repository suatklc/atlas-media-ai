import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same loader convention used throughout tests/*.test.mjs.
function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader, ...globals };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
const discover = loadTypeScriptModule(
  "src/lib/ai/research/discover.ts",
  (specifier) => {
    if (specifier === "../context/businessProfile") return businessProfile;
    if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => [] };
    return {};
  },
  { URL },
);
const freshnessBand = loadTypeScriptModule("src/lib/ai/research/freshnessBand.ts");
const formatRecommendation = loadTypeScriptModule("src/lib/ai/research/formatRecommendation.ts");

// Full ContentPlan chain, for a genuine functional (not just source-
// contract) check that the "Tek görsel üret." suffix + intentOverride
// combination — exactly what assistant/route.ts and generate-visual/
// route.ts now build for every ContentOpportunity-driven request —
// actually resolves outputMode "single" (never "carousel", which
// generate-visual/route.ts still rejects with its pre-existing 422).
const intent = loadTypeScriptModule("src/lib/ai/content/intent.ts");
const goal = loadTypeScriptModule("src/lib/ai/content/goal.ts");
const audience = loadTypeScriptModule("src/lib/ai/content/audience.ts");
const format = loadTypeScriptModule("src/lib/ai/content/format.ts");
const templates = loadTypeScriptModule("src/lib/ai/content/templates.ts");
const plan = loadTypeScriptModule("src/lib/ai/content/plan.ts", (s) => ({
  "./intent": intent, "./goal": goal, "./audience": audience, "./format": format, "./templates": templates,
})[s] ?? {});
const opportunity = loadTypeScriptModule("src/lib/ai/research/opportunity.ts");

function makeResult(overrides) {
  return {
    title: "Örnek Başlık",
    publisher: "Örnek Yayıncı",
    url: "https://example.com/haber",
    publishedAt: "",
    tier: "official-authority",
    snippet: "Örnek Başlık",
    retrievedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================
// Hard freshness rule — discoverCurrentContentOpportunities' maxAgeDays
// ============================================================

test("maxAgeDays: material older than 30 days is excluded, not merely down-ranked", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Güncel Haber", url: "https://a.example/1", publishedAt: "2026-08-20T00:00:00.000Z" }), // 7 days
    makeResult({ title: "Eski Haber (Şubat)", url: "https://a.example/2", publishedAt: "2026-02-10T00:00:00.000Z" }), // >30 days
  ];
  const built = discover.buildContentOpportunities(results, now);
  const withCutoff = discover.rankContentOpportunities(
    built.filter((o) => {
      const publishedAt = o.sources[0]?.publishedAt ?? "";
      if (!publishedAt) return false;
      const ageDays = (now.getTime() - new Date(publishedAt).getTime()) / (1000 * 60 * 60 * 24);
      return ageDays <= 30;
    }),
    [],
    5,
  );
  assert.equal(withCutoff.length, 1);
  assert.equal(withCutoff[0].topic, "Güncel Haber");
});

test("maxAgeDays end-to-end via discoverCurrentContentOpportunities: old February content never reaches the shortlist", async () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const fixedResults = [
    makeResult({ title: "Güncel Faiz Haberi", url: "https://a.example/1", publishedAt: "2026-08-22T00:00:00.000Z" }),
    makeResult({ title: "Şubat Ayı Eski Haberi", url: "https://a.example/2", publishedAt: "2026-02-01T00:00:00.000Z" }),
  ];
  const discoverWithFixedRouter = loadTypeScriptModule(
    "src/lib/ai/research/discover.ts",
    (specifier) => {
      if (specifier === "../context/businessProfile") return businessProfile;
      if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => fixedResults };
      return {};
    },
    { URL },
  );
  const opportunities = await discoverWithFixedRouter.discoverCurrentContentOpportunities({
    now,
    maxAgeDays: 30,
    limit: 5,
  });
  assert.ok(opportunities.every((o) => o.topic !== "Şubat Ayı Eski Haberi"));
  assert.ok(opportunities.some((o) => o.topic === "Güncel Faiz Haberi"));
});

test("maxAgeDays: a missing publication date is never treated as current", async () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const fixedResults = [makeResult({ title: "Tarihsiz Haber", url: "https://a.example/x", publishedAt: "" })];
  const discoverWithFixedRouter = loadTypeScriptModule(
    "src/lib/ai/research/discover.ts",
    (specifier) => {
      if (specifier === "../context/businessProfile") return businessProfile;
      if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => fixedResults };
      return {};
    },
    { URL },
  );
  const opportunities = await discoverWithFixedRouter.discoverCurrentContentOpportunities({
    now,
    maxAgeDays: 30,
    limit: 5,
  });
  assert.equal(opportunities.length, 0);
});

test("maxAgeDays: fewer than the requested limit is returned rather than padding with excluded old material", async () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const fixedResults = [
    makeResult({ title: "Tek Güncel Haber", url: "https://a.example/1", publishedAt: "2026-08-25T00:00:00.000Z" }),
    ...Array.from({ length: 4 }, (_, i) =>
      makeResult({ title: `Eski Haber ${i}`, url: `https://a.example/old-${i}`, publishedAt: "2026-01-01T00:00:00.000Z" }),
    ),
  ];
  const discoverWithFixedRouter = loadTypeScriptModule(
    "src/lib/ai/research/discover.ts",
    (specifier) => {
      if (specifier === "../context/businessProfile") return businessProfile;
      if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => fixedResults };
      return {};
    },
    { URL },
  );
  const opportunities = await discoverWithFixedRouter.discoverCurrentContentOpportunities({
    now,
    maxAgeDays: 30,
    limit: 5,
  });
  assert.equal(opportunities.length, 1, "must not pad with excluded >30-day material");
});

test("maxAgeDays omitted (undefined): existing callers/tests are byte-for-byte unaffected", async () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const fixedResults = [makeResult({ title: "Eski Haber", url: "https://a.example/old", publishedAt: "2026-01-01T00:00:00.000Z" })];
  const discoverWithFixedRouter = loadTypeScriptModule(
    "src/lib/ai/research/discover.ts",
    (specifier) => {
      if (specifier === "../context/businessProfile") return businessProfile;
      if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => fixedResults };
      return {};
    },
    { URL },
  );
  // No maxAgeDays at all — old material must still appear, exactly as
  // Phase 2/3's own tests already rely on.
  const opportunities = await discoverWithFixedRouter.discoverCurrentContentOpportunities({ now, limit: 5 });
  assert.equal(opportunities.length, 1);
});

// ============================================================
// User-facing freshness band labels (0-7 / 8-14 / 15-30 days)
// ============================================================

test("freshness band: 0-7 days is the highest band", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const info = freshnessBand.describeFreshnessBand("2026-08-21T00:00:00.000Z", now); // 6 days
  assert.equal(info.band, "very-fresh");
  assert.equal(info.label, "Güncel");
});

test("freshness band: 8-14 days", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const info = freshnessBand.describeFreshnessBand("2026-08-15T00:00:00.000Z", now); // 12 days
  assert.equal(info.band, "fresh");
  assert.equal(info.label, "Yakın Zamanlı");
});

test("freshness band: 15-30 days", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const info = freshnessBand.describeFreshnessBand("2026-08-05T00:00:00.000Z", now); // 22 days
  assert.equal(info.band, "recent");
  assert.equal(info.label, "Bu Ay İçinde");
});

test("freshness band: beyond 30 days has no band at all", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(freshnessBand.describeFreshnessBand("2026-02-01T00:00:00.000Z", now), undefined);
});

test("freshness band: missing or unparsable date has no band", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(freshnessBand.describeFreshnessBand("", now), undefined);
  assert.equal(freshnessBand.describeFreshnessBand("not a date", now), undefined);
});

// ============================================================
// Format recommendation
// ============================================================

test("format recommendation: a market update recommends Single Image", () => {
  const opportunity = { suggestedContentType: "market-stats" };
  assert.equal(formatRecommendation.recommendVisualFormat(opportunity), "single");
});

test("format recommendation: educational/regulatory content recommends Carousel", () => {
  const opportunity = { suggestedContentType: "educational" };
  assert.equal(formatRecommendation.recommendVisualFormat(opportunity), "carousel");
});

test("format recommendation: listing/announcement/no-type default to Single Image", () => {
  assert.equal(formatRecommendation.recommendVisualFormat({ suggestedContentType: "listing" }), "single");
  assert.equal(formatRecommendation.recommendVisualFormat({ suggestedContentType: "announcement" }), "single");
  assert.equal(formatRecommendation.recommendVisualFormat({}), "single");
});

// ============================================================
// User format override is preserved
// ============================================================

test("format override: choosing Carousel forces suggestedContentType to educational regardless of the natural classification", () => {
  const opportunity = { topic: "x", suggestedContentType: "market-stats" };
  const overridden = formatRecommendation.buildOpportunityForFormat(opportunity, "carousel");
  assert.equal(overridden.suggestedContentType, "educational");
});

test("format override: choosing Tek Görsel leaves the opportunity's natural suggestedContentType untouched", () => {
  const opportunity = { topic: "x", suggestedContentType: "educational" };
  const overridden = formatRecommendation.buildOpportunityForFormat(opportunity, "single");
  assert.equal(overridden.suggestedContentType, "educational");
  assert.deepEqual(Array.from(Object.keys(overridden)).sort(), Array.from(Object.keys(opportunity)).sort());
});

// ============================================================
// Route contract checks — additive-only wiring, and confirmation that
// research/generation actions never publish.
// ============================================================

test("assistant route: message becomes optional exactly when a valid ContentOpportunity is present, and forces single-image framing", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");
  assert.match(routeSource, /if \(!contentOpportunity\) \{\s*\n\s*if \(typeof message !== "string"/);
  assert.match(routeSource, /Tek görsel üret\./);
  assert.match(
    routeSource,
    /const contentPlan = buildContentPlan\(effectiveMessage, contentOpportunity\?\.suggestedContentType\);/,
  );
});

test("generate-visual route: the same ContentOpportunity seam exists, and the pre-existing carousel-visual 422 guard is untouched", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/generate-visual/route.ts"), "utf8");
  assert.match(routeSource, /isContentOpportunity\(rawContentOpportunity\)/);
  assert.match(routeSource, /Tek görsel üret\./);
  assert.match(routeSource, /contentPlan\.outputMode === "carousel"/);
  assert.match(
    routeSource,
    /const contentPlan = buildContentPlan\(effectiveMessage, contentOpportunity\?\.suggestedContentType\);/,
  );
});

test("research discovery route and discover.ts never reference any publishing action", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/research/discover/route.ts"), "utf8");
  const discoverSource = fs.readFileSync(path.join(projectRoot, "src/lib/ai/research/discover.ts"), "utf8");
  for (const source of [routeSource, discoverSource]) {
    assert.doesNotMatch(source, /publishGeneratedPost|publishPost|publishToMeta|generated_posts/i);
  }
});

test("assistant route (content generation) never references any publishing action", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /publishGeneratedPost|publishPost|publishToMeta/i);
});

test("generate-visual route (image generation) writes only status-less inserts — never sets status to 'approved' or 'posted', never calls a publish function", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/generate-visual/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /publishGeneratedPost|publishPost|publishToMeta/i);
  assert.doesNotMatch(routeSource, /status:\s*["'](approved|posted)["']/);
});

test("normal manual Atlas content generation (no ContentOpportunity) still requires a non-empty message, unchanged", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");
  assert.match(routeSource, /return jsonError\("Mesaj boş olamaz\.", 400\);/);
});

// ============================================================
// Functional confirmation (not just source-contract): the "Tek görsel
// üret." suffix + intentOverride combination the routes now build
// resolves outputMode "single" AND the overridden intent, for real,
// through the actual buildContentPlan chain.
// ============================================================

test("a Carousel-selected educational opportunity resolves outputMode 'single' (avoiding the carousel-visual 422) while keeping intent 'educational'", () => {
  const tkgmOpportunity = {
    topic: "Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında",
    angle: "Bu gelişmenin gayrimenkul alıcı ve yatırımcıları için pratik anlamı",
    whyNow: "Tapu ve Kadastro Genel Müdürlüğü (TKGM) tarafından 2026-08-12 tarihinde yayımlandı",
    keyFacts: ["Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında"],
    sources: [
      {
        title: "Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında",
        publisher: "Tapu ve Kadastro Genel Müdürlüğü (TKGM)",
        url: "https://www.tkgm.gov.tr/duyurular/davali-oldugu-halde-tapu-kutugune-tescil-edilen-ve-takbise-aktarilan-tasinmazlar-hakkinda",
        publishedAt: "2026-08-12T21:00:00.000Z",
        tier: "official-authority",
      },
    ],
    freshness: "recent",
    suggestedContentType: "educational",
  };

  const overridden = formatRecommendation.buildOpportunityForFormat(tkgmOpportunity, "carousel");
  const seed = `${opportunity.buildSeedMessage(overridden)} Tek görsel üret.`;
  const contentPlan = plan.buildContentPlan(seed, overridden.suggestedContentType);

  assert.equal(contentPlan.intent, "educational");
  assert.equal(contentPlan.outputMode, "single", "must resolve single, not carousel, or generate-visual's 422 fires");
  assert.equal(contentPlan.template?.id, "EDUCATIONAL_CAROUSEL_01");
});

test("a Tek Görsel-selected market-stats opportunity resolves outputMode 'single' and keeps its natural market-stats intent", () => {
  const tcmbOpportunity = {
    topic: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
    angle: "Bu gelişmenin gayrimenkul alıcı ve yatırımcıları için pratik anlamı",
    whyNow: "Türkiye Cumhuriyet Merkez Bankası (TCMB) tarafından 2026-07-23 tarihinde yayımlandı",
    keyFacts: ["Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)"],
    sources: [
      {
        title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
        publisher: "Türkiye Cumhuriyet Merkez Bankası (TCMB)",
        url: "http://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/duyurular/basin/2026/duy2026-28",
        publishedAt: "2026-07-23T11:00:00.000Z",
        tier: "official-authority",
      },
    ],
    freshness: "evergreen-adjacent",
    suggestedContentType: "market-stats",
  };

  const kept = formatRecommendation.buildOpportunityForFormat(tcmbOpportunity, "single");
  const seed = `${opportunity.buildSeedMessage(kept)} Tek görsel üret.`;
  const contentPlan = plan.buildContentPlan(seed, kept.suggestedContentType);

  assert.equal(contentPlan.intent, "market-stats");
  assert.equal(contentPlan.outputMode, "single");
  assert.equal(contentPlan.template?.id, "INFOGRAPHIC_01");
});
