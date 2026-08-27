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
const turkishDate = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
// discover.ts's classifyTopicFamily also uses the built-in URL constructor
// (for its domain-based fallback) — same reason, same fix.
const discover = loadTypeScriptModule(
  "src/lib/ai/research/discover.ts",
  (specifier) => {
    if (specifier === "../context/businessProfile") return businessProfile;
    if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => [] };
    return {};
  },
  { URL },
);

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

// ============================================================
// Phase 3: new adapter parsers (resmiGazete.ts, tkgm.ts), tested with
// mocked fetch against small, realistic HTML fixtures modeled on real,
// live-captured markup — same mocked-fetch-as-injected-global convention
// tests/meta-oauth-callback.test.mjs already uses for meta-graph.ts.
// ============================================================

function makeMockFetch(html, { ok = true, status = 200, contentType = "text/html; charset=UTF-8" } = {}) {
  return async () => ({
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  });
}

// Modeled directly on real resmigazete.gov.tr homepage markup (captured
// during live investigation): the date heading, and three fihrist-item
// entries chosen specifically to exercise the word-boundary fix — entry 2
// is the REAL entry that live testing found would false-positive on a
// naive substring check for "yapı" (it only contains "yapılmasına", a
// conjugated form of the unrelated verb "yapmak").
const RESMI_GAZETE_FIXTURE_HTML = `
<html><body>
<div class="rg">27 Ağustos 2026 Tarihli ve 33353 Sayılı Resmî Gazete</div>
<div class="html-subtitle">YÖNETMELİKLER</div>
<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260827-7.htm" data-modal="True">–– Tapu Sicili Tüzüğünde Değişiklik Yapılmasına Dair Yönetmelik</a></div>
<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260827-8.htm" data-modal="True">–– Araçların İmal, Tadil ve Montajı Hakkında Yönetmelikte Değişiklik Yapılmasına Dair Yönetmelik</a></div>
<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/08/20260827-9.htm" data-modal="True">–– Elektrik Piyasasında Üretim Faaliyetinde Bulunmak Üzere Su Kullanım Hakkı Anlaşması</a></div>
</body></html>`;

test("resmiGazete.ts: keeps a genuine tapu-related entry and rejects the real false-positive case ('yapılmasına' must not match 'yapı')", async () => {
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../types") return {};
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      return {};
    },
    { fetch: makeMockFetch(RESMI_GAZETE_FIXTURE_HTML), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.equal(results.length, 1, "only the genuine tapu entry should survive the relevance filter");
  assert.match(results[0].title, /Tapu Sicili/);
  assert.equal(results[0].publisher, "T.C. Resmî Gazete");
  assert.equal(results[0].tier, "official-authority");
  assert.equal(results[0].publishedAt, new Date("2026-08-27T00:00:00+03:00").toISOString());
});

test("resmiGazete.ts: a network failure is caught and returns an empty list, never throws", async () => {
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      return {};
    },
    {
      fetch: async () => {
        throw new Error("simulated TLS/network failure");
      },
      URL,
      TextEncoder,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.deepEqual(Array.from(results), []);
});

// Modeled directly on real tkgm.gov.tr /duyurular markup (captured during
// live investigation): the exact card structure, including a genuine
// tapu-related item and its real Turkish long-form date.
const TKGM_FIXTURE_HTML = `
<div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
<a class="group block border-[#E4E4E7] rounded-[10px] border  p-4" href="/duyurular/tapu-harci-guncellemesi"><div class="flex flex-col gap-4"><h3 class="line-clamp-2 text-lg font-semibold">Tapu Harcı Güncellemesi</h3><div class="flex items-center justify-between"><span class="rounded-full">Duyuru</span><p class="text-[15px] font-medium text-gray-500">20 Ağustos 2026</p></div></div></a>
<a class="group block border-[#E4E4E7] rounded-[10px] border  p-4" href="/duyurular/arsiv-hizmetleri-genelgesi"><div class="flex flex-col gap-4"><h3 class="line-clamp-2 text-lg font-semibold">Arşiv Hizmetleri Genelgesi</h3><div class="flex items-center justify-between"><span class="rounded-full">Duyuru</span><p class="text-[15px] font-medium text-gray-500">18 Ağustos 2026</p></div></div></a>
</div>`;

test("tkgm.ts: extracts real card entries with title, URL, and parsed Turkish long-form date", async () => {
  const tkgm = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tkgm.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      return {};
    },
    { fetch: makeMockFetch(TKGM_FIXTURE_HTML), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await tkgm.fetchTkgmAnnouncements();
  // Same fixture HTML is served for both the /duyurular and /haberler
  // fetches in this test (one mock fetch for both pages) — two entries
  // per page fetch = 4 total; what matters is each entry parses correctly.
  assert.ok(results.length >= 2);
  const tapuEntry = results.find((r) => r.title === "Tapu Harcı Güncellemesi");
  assert.ok(tapuEntry, "expected the tapu entry to be extracted");
  assert.equal(tapuEntry.url, "https://www.tkgm.gov.tr/duyurular/tapu-harci-guncellemesi");
  assert.equal(tapuEntry.publishedAt, new Date("2026-08-20T00:00:00+03:00").toISOString());
  assert.equal(tapuEntry.tier, "official-authority");
});

test("tkgm.ts: an unparsable date is left as explicit unknown, never guessed", async () => {
  const badDateHtml = `<a class="group block" href="/duyurular/tarihsiz-duyuru"><div class="flex flex-col gap-4"><h3>Tarihsiz Duyuru</h3><div><span>Duyuru</span><p>bilinmeyen tarih</p></div></div></a>`;
  const tkgm = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tkgm.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      return {};
    },
    { fetch: makeMockFetch(badDateHtml), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await tkgm.fetchTkgmAnnouncements();
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.publishedAt === ""));
});

// ============================================================
// Phase 3: topic-family classification
// ============================================================

test("topic family: keyword rules classify credit-interest, regulation-property, and market-data", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu", url: "https://www.tcmb.gov.tr/x/faiz", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
    makeResult({ title: "Tapu Sicili Tüzüğünde Değişiklik", url: "https://www.tkgm.gov.tr/x/tapu", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
    makeResult({ title: "Konut Fiyat Endeksi Açıklandı", url: "https://www.tcmb.gov.tr/x/endeks", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  assert.equal(built[0].topicFamily, "credit-interest");
  assert.equal(built[1].topicFamily, "regulation-property");
  assert.equal(built[2].topicFamily, "market-data");
});

test("topic family: a source domain provides a fallback when the title has no keyword match", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Genel Müdürümüzden Ziyaret Haberi", url: "https://www.tkgm.gov.tr/x/ziyaret", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(built.topicFamily, "regulation-property");
});

test("topic family is a hint only — never a second ContentIntent taxonomy", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu", url: "https://www.tcmb.gov.tr/x/faiz", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  // ContentIntent's own closed set — topicFamily is never one of these.
  const CONTENT_INTENTS = ["listing", "educational", "comparison", "market-stats", "announcement", "none"];
  assert.ok(!CONTENT_INTENTS.includes(built.topicFamily));
  assert.ok(CONTENT_INTENTS.includes(built.suggestedContentType));
});

// ============================================================
// Phase 3: deduplication upgrade — beyond exact URL
// ============================================================

test("deduplication: same normalized title from two different URLs still collapses to one opportunity", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
      url: "https://www.tcmb.gov.tr/x/duy2026-28",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      // Different URL (e.g. http vs https, or a trailing anchor), same
      // title modulo case/whitespace — must still collapse.
      title: "  faiz oranlarına ilişkin basın duyurusu (2026-28)  ",
      url: "http://www.tcmb.gov.tr/x/duy2026-28-alt",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  assert.equal(built.length, 1);
});

test("deduplication: distinct TCMB rate-decision events (differing only by their code number) are NOT collapsed", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
      url: "https://www.tcmb.gov.tr/x/duy2026-28",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-23)",
      url: "https://www.tcmb.gov.tr/x/duy2026-23",
      publishedAt: "2026-06-11T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  assert.equal(built.length, 2, "different rate-decision events must remain distinct opportunities");
});

// ============================================================
// Phase 3: diversified ranking
// ============================================================

test("diversified ranking: prefers one opportunity per topic family over five near-identical stories from one family", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    ...Array.from({ length: 5 }, (_, i) =>
      makeResult({
        title: `Faiz Oranlarına İlişkin Basın Duyurusu (2026-${20 + i})`,
        url: `https://www.tcmb.gov.tr/x/faiz-${i}`,
        publishedAt: "2026-08-20T00:00:00.000Z",
        tier: "official-authority",
      }),
    ),
    makeResult({
      title: "Tapu Sicili Tüzüğünde Değişiklik Yapılmasına Dair Yönetmelik",
      url: "https://www.resmigazete.gov.tr/x/tapu",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Konut Satış İstatistikleri Açıklandı",
      url: "https://www.tuik.gov.tr/x/satis",
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz", "tapu", "konut"], 5);

  const families = ranked.map((o) => o.topicFamily);
  assert.ok(new Set(families).size >= 3, `expected at least 3 distinct families in the shortlist, got: ${families.join(", ")}`);
  // No single family should be allowed to fill the entire shortlist when
  // genuinely different families are available.
  const creditInterestCount = families.filter((f) => f === "credit-interest").length;
  assert.ok(creditInterestCount < ranked.length);
});

test("diversified ranking: a stale/weak category does not beat a fresh, high-quality story merely for diversity", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    // Strong, fresh, official credit-interest story.
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/faiz-fresh",
      publishedAt: "2026-08-25T00:00:00.000Z", // breaking
      tier: "official-authority",
    }),
    // A second, ALSO strong credit-interest story.
    makeResult({
      title: "Faiz Kararına İlişkin İkinci Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/faiz-fresh-2",
      publishedAt: "2026-08-24T00:00:00.000Z", // breaking
      tier: "official-authority",
    }),
    // Weak, stale, commentary-only "local-regional" entry — must not be
    // forced into the shortlist merely to represent its family.
    makeResult({
      title: "Sarıyer hakkında eski bir yorum yazısı",
      url: "https://random-blog.example/eski-yorum",
      publishedAt: "2020-01-01T00:00:00.000Z", // very stale
      tier: "commentary",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz", "sarıyer"], 2);

  // Both slots should go to the two strong credit-interest stories, not
  // the weak local-regional filler.
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((o) => o.topicFamily === "credit-interest"));
  assert.ok(!ranked.some((o) => o.sources.some((s) => s.url.includes("random-blog.example"))));
});

test("diversified ranking respects the requested limit", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = Array.from({ length: 8 }, (_, i) =>
    makeResult({
      title: `Faiz Duyurusu ${i}`,
      url: `https://www.tcmb.gov.tr/x/faiz-${i}`,
      publishedAt: "2026-08-20T00:00:00.000Z",
      tier: "official-authority",
    }),
  );
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz"], 3);
  assert.equal(ranked.length, 3);
});
