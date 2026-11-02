import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same sandboxed loader convention used throughout tests/*.test.mjs.
function loadTypeScriptModule(relativePath, dependencyLoader = () => ({})) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const places = loadTypeScriptModule("src/lib/ai/research/turkishPlaces.ts");
const { ATLAS_DEFAULT_BUSINESS_PROFILE: profile } = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
const weeklyPlan = loadTypeScriptModule("src/lib/ai/content/weeklyPlan.ts", (specifier) =>
  specifier === "../research/turkishPlaces" ? places : {},
);
const strategy = profile.contentStrategy;
const NOW = new Date("2026-11-02T09:00:00.000Z");
const HOME = ["İstanbul", profile.geography.primary, ...profile.geography.nearby];

function opportunity(topic, angle = "Konut alıcıları ve sahipleri açısından: " + topic, url = `https://example.gov.tr/${encodeURIComponent(topic)}`) {
  return {
    topic,
    angle,
    whyNow: "x",
    keyFacts: [topic],
    sources: [{ title: topic, publisher: "ÇŞİDB", url, publishedAt: "2026-10-30T00:00:00.000Z", tier: "official-authority" }],
    freshness: "recent",
  };
}

const plan = (extra = {}) => weeklyPlan.buildWeeklyContentPlan({ profile, now: NOW, ...extra });

// ===== Content library =====

test("library: every pillar is real, has enough ideas for weeks of rotation, and ids are unique", () => {
  const pillars = Object.keys(strategy.pillarLabels);
  assert.deepEqual(pillars.sort(), ["buyer-seller", "evergreen", "investment", "land-zoning", "regional", "villa-home"]);
  for (const pillar of pillars) {
    assert.ok(strategy.ideas.filter((idea) => idea.pillar === pillar).length >= 6, pillar);
  }
  assert.equal(new Set(strategy.ideas.map((idea) => idea.id)).size, strategy.ideas.length);
});

test("library: every idea is a valid expert instruction — 15..1000 chars, one audience, no numbers, has a signature", () => {
  for (const idea of strategy.ideas) {
    assert.ok(idea.instruction.length >= 15 && idea.instruction.length <= 1000, idea.id);
    assert.doesNotMatch(idea.instruction, /\d/, `${idea.id}: no numbers in an evergreen instruction`);
    assert.match(idea.instruction, /paylaşım hazırla/, idea.id);
    assert.ok(idea.signature.length >= 1 && idea.title && idea.reason && idea.format, idea.id);
  }
});

test("library: not villa-only — villa/konut is one pillar among six", () => {
  const villaIdeas = strategy.ideas.filter((idea) => /villa/i.test(idea.instruction));
  assert.ok(villaIdeas.length < strategy.ideas.length / 2, "villa appears in less than half of the ideas");
  for (const term of ["TAKS", "imar durumu", "hisseli", "çekme mesafe", "tapu", "yatırım", "kira"]) {
    assert.ok(strategy.ideas.some((idea) => idea.instruction.includes(term)), term);
  }
});

test("profile: the service area includes Bahçeköy and Maden", () => {
  assert.ok(profile.geography.nearby.includes("Bahçeköy"));
  assert.ok(profile.geography.nearby.includes("Maden"));
});

// ===== Weekly plan =====

test("Radar returns 0 -> still 4 strong ideas: regional + land/zoning + buyer-seller/investment + evergreen/villa", () => {
  const result = plan({ radarOpportunities: [] });
  assert.equal(result.items.length, 4);
  assert.equal(result.radar, "no-qualifying-topic");
  assert.ok(result.items.every((item) => item.kind === "idea"));
  const labels = result.items.map((item) => item.label);
  assert.equal(labels[0], "Bölgesel");
  assert.equal(labels[1], "Arsa/İmar");
  assert.ok(["Alıcı/Satıcı", "Yatırım"].includes(labels[2]));
  assert.ok(["Evergreen", "Villa/Konut"].includes(labels[3]));
  assert.equal(new Set(result.items.map((item) => item.format)).size, 4, "four different formats/hook styles");
  assert.equal(result.alternates.length, 2);
});

test("Radar unavailable (error) -> the plan still has 4 ideas", () => {
  const result = plan({ radarOpportunities: undefined });
  assert.equal(result.items.length, 4);
  assert.equal(result.radar, "unavailable");
});

test("a development local to another district (Maltepe) never takes the weekly current slot", () => {
  const result = plan({ radarOpportunities: [opportunity("MALTEPE’DE VATANDAŞLAR SAĞLAM KONUTLARINA KAVUŞUYOR")] });
  assert.equal(result.radar, "no-qualifying-topic");
  assert.ok(result.items.every((item) => item.kind === "idea"));
});

test("a national / İstanbul-wide / home-area development takes the current slot (slot 4)", () => {
  for (const topic of [
    "Tapu işlemlerinde yeni düzenleme",
    "İstanbul genelinde kentsel dönüşüm desteği",
    "Sarıyer'e yeni metro hattı için ihale tamamlandı",
  ]) {
    const result = plan({ radarOpportunities: [opportunity("MALTEPE’DE yeni proje"), opportunity(topic)] });
    assert.equal(result.radar, "used", topic);
    assert.equal(result.items[3].kind, "current", topic);
    assert.equal(result.items[3].label, "Güncel/Trend");
    assert.equal(result.items[3].title, topic);
    assert.equal(result.items.length, 4);
  }
});

test("a current topic already drafted recently is not suggested again", () => {
  const topic = opportunity("Tapu işlemlerinde yeni düzenleme");
  const result = plan({ radarOpportunities: [topic], recentDrafts: [{ text: "x", sourceUrl: topic.sources[0].url }] });
  assert.equal(result.radar, "no-qualifying-topic");
});

test("recently used ideas are skipped", () => {
  const first = plan({ radarOpportunities: [] });
  const usedLand = strategy.ideas.find((idea) => idea.id === first.items[1].ideaId);
  const again = plan({ radarOpportunities: [], recentDrafts: [{ text: usedLand.signature.join(" ") }] });
  assert.notEqual(again.items[1].ideaId, usedLand.id);
  assert.equal(again.items[1].label, "Arsa/İmar");
});

test("recency is not over-eager: an unrelated recent draft changes nothing", () => {
  const base = plan({ radarOpportunities: [] }).items.map((item) => item.ideaId);
  const withUnrelated = plan({ radarOpportunities: [], recentDrafts: [{ text: "Faiz kararı ve enflasyon raporu" }] }).items.map((item) => item.ideaId);
  assert.deepEqual(withUnrelated, base);
});

test("consecutive weeks get different ideas and alternate the rotating slots", () => {
  const weeks = [0, 1, 2, 3].map((n) =>
    weeklyPlan.buildWeeklyContentPlan({ profile, now: new Date(NOW.getTime() + n * 7 * 86400000), radarOpportunities: [] }),
  );
  const regional = new Set(weeks.map((w) => w.items[0].ideaId));
  assert.equal(regional.size, 4, "four different regional ideas over four weeks");
  assert.notEqual(weeks[0].items[2].label, weeks[1].items[2].label, "buyer-seller and investment alternate");
  for (const w of weeks) {
    assert.equal(w.items.length, 4);
    assert.equal(new Set(w.items.map((i) => i.ideaId)).size, 4);
  }
});

test("the plan never repeats an idea between items and alternates", () => {
  const result = plan({ radarOpportunities: [] });
  const ids = [...result.items, ...result.alternates].map((item) => item.ideaId);
  assert.equal(new Set(ids).size, ids.length);
});

test("isLocalToElsewhere: another district/province -> true; home area, İstanbul-wide or national -> false", () => {
  assert.equal(places.isLocalToElsewhere("MALTEPE’DE VATANDAŞLAR SAĞLAM KONUTLARINA KAVUŞUYOR", HOME), true);
  assert.equal(places.isLocalToElsewhere("İzmir'de konut satışları", HOME), true);
  assert.equal(places.isLocalToElsewhere("Sarıyer'de imar planı askıya çıktı", HOME), false);
  assert.equal(places.isLocalToElsewhere("Zekeriyaköy yolu genişletme projesi", HOME), false);
  assert.equal(places.isLocalToElsewhere("Tapu harçlarında yeni düzenleme", HOME), false);
  assert.equal(places.isLocalToElsewhere("İstanbul genelinde kira artışı", HOME), false);
});

// ===== Safety contracts =====

test("/api/content-plan is read-only: no insert/update, no publishing, no status writes; Radar failure is absorbed", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/app/api/content-plan/route.ts"), "utf8");
  assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(source, /from "@\/lib\/publishing|publish\w*\(/);
  assert.doesNotMatch(source, /status: "(draft|approved|posted)"|\.eq\("status"/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /getUser\(\)/);
});

test("vercel.json: Radar-calling routes run in fra1; nothing else is pinned", () => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "vercel.json"), "utf8"));
  assert.deepEqual(Object.keys(config), ["functions"]);
  assert.deepEqual(config.functions, {
    "src/app/api/research/discover/route.ts": { regions: ["fra1"] },
    "src/app/api/content-plan/route.ts": { regions: ["fra1"] },
  });
});

test("dashboard: a plan idea goes through the existing expert instruction flow; a current topic through the existing Radar flow", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/CurrentOpportunities.tsx"), "utf8");
  assert.match(source, /fetch\("\/api\/content-plan"/);
  assert.match(source, /handleGenerateFromInstruction\(item\.instruction\)/);
  assert.match(source, /setOpportunities\(\[item\.opportunity\]\)/);
  assert.doesNotMatch(source, /from "@\/lib\/publishing|publish\w*\(|\/api\/publish/, "the planning surface never publishes");
});
