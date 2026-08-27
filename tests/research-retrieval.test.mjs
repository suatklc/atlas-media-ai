import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same loader convention as tests/output-mode.test.mjs and
// tests/educational-metadata.test.mjs.
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

// sourceQuality.ts's classifySourceTier uses the built-in URL constructor
// (see the same established pattern in tests/meta-oauth-callback.test.mjs)
// — vm.runInNewContext's isolated global object does not include Node's
// globals unless explicitly passed in here.
const sourceQuality = loadTypeScriptModule("src/lib/ai/research/retrieval/sourceQuality.ts", () => ({}), { URL });
const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
const discover = loadTypeScriptModule("src/lib/ai/research/discover.ts", (specifier) => {
  if (specifier === "../context/businessProfile") return businessProfile;
  if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => [] };
  return {};
});

// Full existing pipeline, loaded exactly the way research-opportunity.test
// .mjs and output-mode.test.mjs already load it — used to verify a
// discover.ts-built ContentOpportunity can still travel through it
// unmodified.
const intent = loadTypeScriptModule("src/lib/ai/content/intent.ts");
const goal = loadTypeScriptModule("src/lib/ai/content/goal.ts");
const audience = loadTypeScriptModule("src/lib/ai/content/audience.ts");
const format = loadTypeScriptModule("src/lib/ai/content/format.ts");
const templates = loadTypeScriptModule("src/lib/ai/content/templates.ts");
const plan = loadTypeScriptModule("src/lib/ai/content/plan.ts", (s) => ({
  "./intent": intent, "./goal": goal, "./audience": audience, "./format": format, "./templates": templates,
})[s] ?? {});
const lookups = loadTypeScriptModule("src/lib/ai/creative/lookups.ts");
const brief = loadTypeScriptModule("src/lib/ai/creative/brief.ts", (specifier) =>
  specifier === "./lookups" ? lookups : {},
);
const opportunity = loadTypeScriptModule("src/lib/ai/research/opportunity.ts");

function makeResult(overrides) {
  return {
    title: "Örnek Başlık",
    publisher: "Örnek Yayıncı",
    url: "https://example.com/haber",
    publishedAt: "",
    tier: "commentary",
    snippet: "Örnek Başlık",
    retrievedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

// ============================================================
// Source-tier classification
// ============================================================

test("official domains are recognized as Tier 1 (official-authority)", () => {
  assert.equal(sourceQuality.classifySourceTier("https://www.tcmb.gov.tr/foo"), "official-authority");
  assert.equal(sourceQuality.classifySourceTier("https://tuik.gov.tr/bar"), "official-authority");
  assert.equal(sourceQuality.classifySourceTier("https://www.resmigazete.gov.tr/x"), "official-authority");
  assert.equal(sourceQuality.classifySourceTier("https://www.sariyer.bel.tr/duyuru"), "official-authority");
});

test("a subdomain of a known official domain is still recognized", () => {
  assert.equal(sourceQuality.classifySourceTier("https://graph.tcmb.gov.tr/x"), "official-authority");
});

test("unknown domains are NOT promoted to official-authority — they default to commentary", () => {
  assert.equal(sourceQuality.classifySourceTier("https://random-blog.example/post"), "commentary");
  assert.equal(sourceQuality.classifySourceTier("https://totally-unofficial-tcmb.example.com/x"), "commentary");
  // A domain merely CONTAINING "tcmb.gov.tr" as a substring (not a real
  // subdomain of it) must not match — same boundary discipline as the
  // content-intent fix, applied here to hostnames instead of Turkish text.
  assert.equal(sourceQuality.classifySourceTier("https://tcmb.gov.tr.evil.example/x"), "commentary");
});

test("a malformed URL is treated as commentary, never thrown", () => {
  assert.equal(sourceQuality.classifySourceTier("not a url"), "commentary");
});

// ============================================================
// BusinessProfile query bias
// ============================================================

test("buildRetrievalQuery includes both base topic vocabulary and BusinessProfile terms", () => {
  const query = discover.buildRetrievalQuery(businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE);
  assert.ok(query.keywords.includes("faiz"));
  assert.ok(query.keywords.includes("konut"));
  assert.ok(query.keywords.includes("Zekeriyaköy"));
  assert.ok(query.keywords.includes("Sarıyer"));
  assert.ok(query.keywords.includes("villa"));
});

test("a different BusinessProfile changes the query without any retrieval-engine code change", () => {
  const otherProfile = {
    industry: "yacht-brokerage",
    geography: { primary: "Bodrum", nearby: ["Marmaris"] },
    expertiseTopics: ["yat", "marina"],
    excludedTopics: [],
  };
  const query = discover.buildRetrievalQuery(otherProfile);
  assert.ok(query.keywords.includes("Bodrum"));
  assert.ok(query.keywords.includes("yat"));
  assert.ok(!query.keywords.includes("Zekeriyaköy"));
});

// ============================================================
// Freshness handling
// ============================================================

test("freshness: breaking / recent / evergreen-adjacent thresholds", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(discover.classifyFreshness("2026-08-25T00:00:00.000Z", now), "breaking"); // 2 days
  assert.equal(discover.classifyFreshness("2026-08-10T00:00:00.000Z", now), "recent"); // 17 days
  assert.equal(discover.classifyFreshness("2026-01-01T00:00:00.000Z", now), "evergreen-adjacent"); // >30 days
});

test("freshness: missing publication date is never assumed current — explicit unknown resolves to evergreen-adjacent", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(discover.classifyFreshness("", now), "evergreen-adjacent");
});

test("freshness: an unparsable or future-dated timestamp is never trusted as current", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(discover.classifyFreshness("not a date", now), "evergreen-adjacent");
  assert.equal(discover.classifyFreshness("2027-01-01T00:00:00.000Z", now), "evergreen-adjacent");
});

// ============================================================
// Deduplication
// ============================================================

test("duplicate-event deduplication: same URL from two feeds becomes one opportunity, not two", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
      url: "https://www.tcmb.gov.tr/x/duy2026-28",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      // Same event, same URL, retrieved from a second feed — must collapse
      // to one opportunity.
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
      url: "https://www.tcmb.gov.tr/x/duy2026-28",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Farklı Bir Duyuru",
      url: "https://www.tcmb.gov.tr/x/duy2026-29",
      publishedAt: "2026-08-21T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const opportunities = discover.buildContentOpportunities(results, now);
  assert.equal(opportunities.length, 2);
});

// ============================================================
// Ranking
// ============================================================

test("ranking favors higher source tier, stronger freshness, and keyword relevance", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz kararı hakkında ikincil bir yorum",
      url: "https://blog.example/yorum",
      publishedAt: "2026-01-01T00:00:00.000Z", // old
      tier: "commentary", // low tier
    }),
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/faiz-karari",
      publishedAt: "2026-08-25T00:00:00.000Z", // fresh (breaking)
      tier: "official-authority", // high tier
    }),
  ];
  const opportunities = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(opportunities, ["faiz"], 5);
  assert.equal(ranked[0].sources[0].tier, "official-authority");
  assert.equal(ranked[0].freshness, "breaking");
});

test("ranking respects the requested limit and returns a small shortlist", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = Array.from({ length: 8 }, (_, i) =>
    makeResult({
      title: `Faiz Duyurusu ${i}`,
      url: `https://www.tcmb.gov.tr/x/faiz-${i}`,
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  );
  const opportunities = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(opportunities, ["faiz"], 3);
  assert.equal(ranked.length, 3);
});

// ============================================================
// National vs. local factual-claim safety
// ============================================================

test("a national statistic's angle never claims Zekeriyaköy-specific relevance the source doesn't support", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  // A genuinely national TCMB result, ranked highly because
  // BusinessProfile's Zekeriyaköy/villa terms happen to co-occur in query
  // keywords used for RANKING relevance — but the built opportunity's own
  // angle/whyNow/keyFacts text must never assert this is Zekeriyaköy-
  // specific data, since TCMB's source is national.
  const results = [
    makeResult({
      title: "Türkiye genelinde konut kredisi faiz oranları güncellendi",
      url: "https://www.tcmb.gov.tr/x/ulusal-faiz",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  const fullText = `${built.angle} ${built.whyNow} ${built.keyFacts.join(" ")}`;
  assert.doesNotMatch(fullText, /Zekeriyaköy/i);
  assert.doesNotMatch(fullText, /Sarıyer/i);
});

// ============================================================
// Commentary-only evidence safety
// ============================================================

test("commentary-only evidence receives a riskCaveat and is never presented as verified fact", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Piyasa hakkında bir görüş yazısı",
      url: "https://blog.example/gorus",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "commentary",
    }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.ok(built.riskCaveat, "commentary-only opportunity must carry a riskCaveat");
  assert.match(built.riskCaveat, /ikincil yorum/);
});

test("regulatory/legal content gets an appropriate caveat even from an official source", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Tapu işlemlerinde yeni bir mevzuat düzenlemesi",
      url: "https://www.tkgm.gov.tr/x/mevzuat",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.ok(built.riskCaveat, "regulatory opportunity must carry a riskCaveat");
  assert.match(built.riskCaveat, /hukuki tavsiye/);
});

test("an official-source opportunity with no regulatory language gets no forced caveat", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/faiz",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(built.riskCaveat, undefined);
});

// ============================================================
// ContentOpportunity produced by discover.ts still travels through the
// EXISTING, unmodified buildSeedMessage -> buildContentPlan ->
// buildCreativeBrief pipeline.
// ============================================================

test("a discover.ts-built ContentOpportunity travels through buildSeedMessage -> buildContentPlan -> buildCreativeBrief", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
      url: "https://www.tcmb.gov.tr/x/duy2026-28",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(opportunity.isContentOpportunity(built), true);

  const seed = opportunity.buildSeedMessage(built);
  assert.doesNotMatch(seed, /\.\./, "whyNow must not produce a double period in the seed message");

  const contentPlan = plan.buildContentPlan(seed);
  assert.notEqual(contentPlan.intent, "none");
  assert.ok(contentPlan.template);

  const creativeBrief = brief.buildCreativeBrief(contentPlan);
  assert.ok(creativeBrief);
});
