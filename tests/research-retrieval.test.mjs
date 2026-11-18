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
let cachedCoverage;
function coverageModule() {
  if (!cachedCoverage) cachedCoverage = loadTypeScriptModule("src/lib/ai/research/retrieval/coverage.ts");
  return cachedCoverage;
}

let cachedRadarDiagnostics;
function radarDiagnosticsModule() {
  if (!cachedRadarDiagnostics) {
    cachedRadarDiagnostics = loadTypeScriptModule("src/lib/ai/research/retrieval/diagnostics.ts", () => ({}), {
      console: { log: () => {} },
    });
  }
  return cachedRadarDiagnostics;
}

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  // Temporary Radar diagnostics (retrieval/diagnostics.ts) resolve to the
  // real, silent module in every loader, so adapters under test keep their
  // exact behavior without each loader having to list it.
  // Same for the pure date-window helpers (retrieval/coverage.ts).
  const withDiagnostics = (specifier) =>
    (specifier === "diagnostics" || specifier.endsWith("/diagnostics"))
      ? radarDiagnosticsModule()
      : specifier === "./coverage" || specifier === "../coverage" || specifier.endsWith("retrieval/coverage")
        ? coverageModule()
        : dependencyLoader(specifier);
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader: withDiagnostics, ...globals };
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
// Real module — discover.ts renders whyNow in Turkey-local time through it.
const turkishDateForDiscover = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
const sourceQuality = loadTypeScriptModule("src/lib/ai/research/retrieval/sourceQuality.ts", () => ({}), { URL });
const turkishDate = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
// Source-Grounding Minimal Fix: real (not mocked) module — tkgm.ts's and
// csb.ts's own detail-page evidence extraction is exercised for real by
// their existing tests below, same convention as sourceQuality/turkishDate.
const evidenceExtraction = loadTypeScriptModule("src/lib/ai/research/retrieval/evidenceExtraction.ts");
const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
// discover.ts's classifyTopicFamily also uses the built-in URL constructor
// (for its domain-based fallback) — same reason, same fix.
const discover = loadTypeScriptModule(
  "src/lib/ai/research/discover.ts",
  (specifier) => {
    if (specifier === "../context/businessProfile") return businessProfile;
    if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => [] };
    if (specifier === "./retrieval/turkishDate") return turkishDateForDiscover;
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

test("whyNow states the source's own Turkish calendar day, never the UTC prefix of a Turkey-midnight publishedAt", () => {
  // Real live-observed case: TKGM card "29 Eylül 2026" -> 2026-09-28T21:00:00.000Z.
  const [opportunity] = discover.buildContentOpportunities(
    [makeResult({ title: "2024/4 Sayılı Genelge Değişikliği", url: "https://www.tkgm.gov.tr/d/1", publishedAt: "2026-09-28T21:00:00.000Z" })],
    new Date("2026-10-17T00:00:00.000Z"),
  );
  assert.match(opportunity.whyNow, /2026-09-29 tarihinde yayımlandı/);
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
      // The angle the editorial-value gate attaches (applyEditorialGate).
      editorialAngle: "Konut kredisi kullanacak alıcılar açısından: Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
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

// Real relevance.ts, loaded once and reused by resmiGazete.ts's and
// csb.ts's own tests below — both adapters import it for real.
const relevance = loadTypeScriptModule("src/lib/ai/research/retrieval/relevance.ts");

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

// Handoff 9: resmiGazete.ts uses standard fetch() first and falls back to
// secureFetch.ts's fetchWithSystemTrust (node:https + system CA) ONLY on a
// TLS/certificate error — live, fetch() answered in ~115 ms while the
// node:https path timed out every run.
function loadResmiGazete({ fetchImpl, secureImpl }) {
  const calls = { fetch: 0, secure: 0 };
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../types") return {};
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../secureFetch") {
        return {
          fetchWithSystemTrust: async (...args) => {
            calls.secure += 1;
            return secureImpl(...args);
          },
        };
      }
      return {};
    },
    {
      console: { error: () => {}, log: () => {}, warn: () => {} },
      fetch: async (...args) => {
        calls.fetch += 1;
        return fetchImpl(...args);
      },
      AbortController,
      setTimeout,
      clearTimeout,
      Buffer,
    },
  );
  return { resmiGazete, calls };
}

const htmlResponse = (status, body) => ({
  status,
  headers: { get: (name) => (name === "content-type" ? "text/html; charset=UTF-8" : null) },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});
const fixtureSecure = async () => ({ status: 200, contentType: "text/html; charset=UTF-8", text: RESMI_GAZETE_FIXTURE_HTML });

test("resmiGazete.ts: keeps a genuine tapu-related entry and rejects the real false-positive case ('yapılmasına' must not match 'yapı')", async () => {
  const { resmiGazete, calls } = loadResmiGazete({
    fetchImpl: async () => htmlResponse(200, RESMI_GAZETE_FIXTURE_HTML),
    secureImpl: fixtureSecure,
  });

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.equal(results.length, 1, "only the genuine tapu entry should survive the relevance filter");
  assert.match(results[0].title, /Tapu Sicili/);
  assert.equal(results[0].publisher, "T.C. Resmî Gazete");
  assert.equal(results[0].tier, "official-authority");
  assert.equal(results[0].publishedAt, new Date("2026-08-27T00:00:00+03:00").toISOString());
  assert.equal(calls.fetch, 1);
  assert.equal(calls.secure, 0, "standard fetch succeeded — no secureFetch fallback");
});

test("resmiGazete.ts: a TLS/certificate error from fetch() falls back to secureFetch (the original UNABLE_TO_VERIFY_LEAF_SIGNATURE case)", async () => {
  const { resmiGazete, calls } = loadResmiGazete({
    fetchImpl: async () => {
      const error = new TypeError("fetch failed");
      error.cause = { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", message: "unable to verify the first certificate" };
      throw error;
    },
    secureImpl: fixtureSecure,
  });

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.equal(calls.secure, 1);
  assert.equal(results.length, 1);
  assert.match(results[0].title, /Tapu Sicili/);
});

test("resmiGazete.ts: a non-TLS network failure is caught and returns an empty list, never throws — and never retries via secureFetch", async () => {
  const { resmiGazete, calls } = loadResmiGazete({
    fetchImpl: async () => {
      const error = new TypeError("fetch failed");
      error.cause = { code: "ECONNRESET", message: "socket hang up" };
      throw error;
    },
    secureImpl: fixtureSecure,
  });

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.deepEqual(Array.from(results), []);
  assert.equal(calls.secure, 0);
});

test("resmiGazete.ts: a non-2xx status is treated as a failure and returns an empty list, never throws", async () => {
  const { resmiGazete } = loadResmiGazete({ fetchImpl: async () => htmlResponse(503, ""), secureImpl: fixtureSecure });
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
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    { fetch: makeMockFetch(TKGM_FIXTURE_HTML), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, Promise, console: { error: () => {}, log: () => {}, warn: () => {} } },
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
  // Source-Grounding Minimal Fix: the detail-page fetch (same mock fetch,
  // real evidenceExtraction) genuinely populated evidenceText — not the
  // title alone, and not an empty/absent value.
  assert.ok(tapuEntry.evidenceText, "expected a detail-page evidenceText to be captured");
  assert.notEqual(tapuEntry.evidenceText, tapuEntry.title);
});

test("tkgm.ts: an unparsable date is left as explicit unknown, never guessed", async () => {
  const badDateHtml = `<a class="group block" href="/duyurular/tarihsiz-duyuru"><div class="flex flex-col gap-4"><h3>Tarihsiz Duyuru</h3><div><span>Duyuru</span><p>bilinmeyen tarih</p></div></div></a>`;
  const tkgm = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tkgm.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    { fetch: makeMockFetch(badDateHtml), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await tkgm.fetchTkgmAnnouncements();
  assert.ok(results.length > 0);
  assert.ok(results.every((r) => r.publishedAt === ""));
});

// Real tkgm.gov.tr markup as of 2026-10: card titles are now wrapped in
// inline rich-text markup (live-observed regression — raw <span>/<p> HTML
// reached opportunity titles and the dashboard).
const TKGM_WRAPPED_TITLE_HTML = `<a class="group block border-[#E4E4E7] rounded-[10px] border  p-4" href="/duyurular/20244-sayili-genelge-degisikligi-hakkinda-duyuru"><div class="flex flex-col gap-4"><h3 class="line-clamp-2 text-lg font-semibold"><span class="[&amp;_*]:![font-family:inherit] [&amp;_p]:inline [&amp;_p]:m-0"><p>2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru </p></span></h3><div class="flex items-center justify-between"><span class="rounded-full">Duyuru</span><p class="text-[15px] font-medium text-gray-500">29 Eylül 2026</p></div></div></a>`;

test("tkgm.ts: a rich-text-wrapped card title is reduced to plain text, never raw HTML", async () => {
  const tkgm = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tkgm.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    { fetch: makeMockFetch(TKGM_WRAPPED_TITLE_HTML), URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, Promise, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await tkgm.fetchTkgmAnnouncements();
  assert.ok(results.length > 0);
  for (const result of results) {
    assert.equal(result.title, "2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru");
    assert.doesNotMatch(result.snippet, /<|&amp;/);
  }
});

test("tkgm.ts: extractSubjectLine reads the official 'Konu :' subject from real TKGM PDF text, bounded by the next heading", () => {
  const tkgm = loadTypeScriptModule("src/lib/ai/research/retrieval/providers/tkgm.ts", (specifier) =>
    specifier === "../evidenceExtraction" ? evidenceExtraction : {},
  );
  assert.equal(
    tkgm.extractSubjectLine(
      "13.06.2024Sayı : E-36189470-125.01.01-12973768 Konu : Türk Vatandaşlığı Kanununun Uygulanmasına İlişkin Yönetmelik Hk İlgi GENELGE 2024/4 : a) 11/06/2024 tarihli",
    ),
    "Türk Vatandaşlığı Kanununun Uygulanmasına İlişkin Yönetmelik Hk",
  );
  assert.equal(
    tkgm.extractSubjectLine(
      "1 / 8 Sayı : E-76015859-010.06.02-11942959 01/03/2024 Konu:Yabancıların Taşınmaz Edinimlerinde ve Bazı İşlemlerde Kullanılacak Değerleme Raporlarına İlişkin Usul ve Esaslar GENELGE 2024/2 İlgi : a)",
    ),
    "Yabancıların Taşınmaz Edinimlerinde ve Bazı İşlemlerde Kullanılacak Değerleme Raporlarına İlişkin Usul ve Esaslar",
  );
  // No "Konu" line, or no terminating heading within the bound -> absent,
  // never a guessed subject.
  assert.equal(tkgm.extractSubjectLine("Duyuru metni için tıklayınız."), undefined);
  assert.equal(tkgm.extractSubjectLine(`Konu : ${"uzun metin ".repeat(40)}`), undefined);
});

// ============================================================
// Research Breadth Expansion v2: relevance.ts (shared word-boundary
// filter, extracted out of resmiGazete.ts now that csb.ts needs it too)
// ============================================================

test("relevance.ts: word-boundary matching rejects the real 'yapılmasına' false-positive for 'yapı', case-insensitively", () => {
  assert.equal(relevance.hasAnyWordBoundaryMatch("Değişiklik Yapılmasına Dair Yönetmelik", ["yapı"]), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Yeni Bir Yapı İnşa Edildi", ["yapı"]), true);
});

test("relevance.ts: suffixed Turkish forms match (live-dropped ÇŞİDB titles), without the known false positives", () => {
  const RE = relevance.REAL_ESTATE_RELEVANCE_KEYWORDS;
  const PM = relevance.PROPERTY_MARKET_RELEVANCE_KEYWORDS;
  // Real ÇŞİDB /haberler titles the old both-sides word boundary dropped.
  assert.equal(relevance.hasAnyWordBoundaryMatch("MALTEPE’DE VATANDAŞLAR SAĞLAM KONUTLARINA KAVUŞUYOR", RE), true);
  assert.equal(relevance.hasAnyWordBoundaryMatch("BAKAN KURUM: 500 BİN SOSYAL KONUTUN YAKLAŞIK 80 BİNİ BİTME AŞAMASINA GELDİ", RE), true);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Olağanüstü Hal Kapsamında Yerleşme ve Yapılaşmaya İlişkin Karar", RE), true);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Kentsel dönüşümde yeni dönem", RE), true, "suffix on the last word of a phrase");
  assert.equal(relevance.hasAnyWordBoundaryMatch("Kat mülkiyeti kanununda değişiklik", PM), true);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Kira artışlarında yeni dönem", PM), true);
  // Still rejected: the documented "yapı" false positive, and look-alike words.
  assert.equal(relevance.hasAnyWordBoundaryMatch("Değişiklik Yapılmasına Dair Yönetmelik", RE), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Kiraz ihracatında rekor", PM), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Mülki idare amirleri kararnamesi", PM), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("İmaret restorasyonu tamamlandı", RE), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Akaryakıt fiyatlarına zam", PM), false);
  // A keyword must still start a word.
  assert.equal(relevance.hasAnyWordBoundaryMatch("Sanayikonut kelimesi", RE), false);
});

test("relevance.ts: REAL_ESTATE_RELEVANCE_KEYWORDS covers the property/zoning vocabulary both mixed-content adapters rely on", () => {
  for (const term of ["tapu", "imar", "kadastro", "gayrimenkul", "kentsel dönüşüm"]) {
    assert.ok(relevance.REAL_ESTATE_RELEVANCE_KEYWORDS.includes(term), `missing keyword: ${term}`);
  }
});

// ============================================================
// Research Breadth Expansion v2: csb.ts (Ministry of Environment,
// Urbanization and Climate Change) — modeled directly on real
// www.csb.gov.tr/haberler markup (captured during live investigation for
// this task): the exact card structure, a genuine zoning-relevant item,
// and an unrelated ministry item (this source covers environment/climate
// far beyond real estate) that the relevance filter must reject.
// ============================================================

const CSB_FIXTURE_HTML = `
<section><div class="mContainer"><div class="row">
<div class="col-xxl-4 col-xl-4 col-lg-4 col-md-6 col-12">
  <div class="haberler-card-wrapper">
    <a href="https://csb.gov.tr/haberler/kentsel-donusum-projesi-baslatildi-306500" target="_self" class="haberler-card-image-wrapper">
      <img src="https://webdosya.csb.gov.tr/x.jpg" class="img-fluid" alt="KENTSEL DÖNÜŞÜM" style="height: 225px;" loading="lazy">
    </a>
    <div class="haberler-card-body-wrapper">
      <span class="date">28 Ağustos 2026</span>
    </div>
    <div class="haberler-card-footer-wrapper">
      <p class="truncate-text-2"><a href="https://csb.gov.tr/haberler/kentsel-donusum-projesi-baslatildi-306500"
          target="_self">YENİ KENTSEL DÖNÜŞÜM PROJESİ BAŞLATILDI</a>
      </p>
    </div>
  </div>
</div>
<div class="col-xxl-4 col-xl-4 col-lg-4 col-md-6 col-12">
  <div class="haberler-card-wrapper">
    <a href="https://csb.gov.tr/haberler/cop31-baskani-kurum-katildi-306498" target="_self" class="haberler-card-image-wrapper">
      <img src="https://webdosya.csb.gov.tr/y.jpg" class="img-fluid" alt="COP31" style="height: 225px;" loading="lazy">
    </a>
    <div class="haberler-card-body-wrapper">
      <span class="date">27 Ağustos 2026</span>
    </div>
    <div class="haberler-card-footer-wrapper">
      <p class="truncate-text-2"><a href="https://csb.gov.tr/haberler/cop31-baskani-kurum-katildi-306498"
          target="_self">COP31 BAŞKANI KURUM İKLİM ZİRVESİ’NE KATILDI</a>
      </p>
    </div>
  </div>
</div>
</div></div></section>`;

test("csb.ts: extracts real card entries and keeps only the genuine zoning/kentsel-dönüşüm item, rejecting unrelated ministry news", async () => {
  const csb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/csb.ts",
    (specifier) => {
      if (specifier === "../types") return {};
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    {
      fetch: makeMockFetch(CSB_FIXTURE_HTML),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await csb.fetchCsbAnnouncements();
  assert.equal(results.length, 1, "only the genuine kentsel dönüşüm entry should survive the relevance filter");
  assert.match(results[0].title, /KENTSEL DÖNÜŞÜM/);
  assert.equal(results[0].publisher, "T.C. Çevre, Şehircilik ve İklim Değişikliği Bakanlığı");
  assert.equal(results[0].tier, "official-authority");
  assert.equal(results[0].url, "https://csb.gov.tr/haberler/kentsel-donusum-projesi-baslatildi-306500");
  assert.equal(results[0].publishedAt, new Date("2026-08-28T00:00:00+03:00").toISOString());
  // Source-Grounding Minimal Fix: real detail-page evidence extraction.
  assert.ok(results[0].evidenceText, "expected a detail-page evidenceText to be captured");
  assert.notEqual(results[0].evidenceText, results[0].title);
});

test("csb.ts: a network failure is caught and returns an empty list, never throws — one source failing can never break discovery", async () => {
  const csb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/csb.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: async () => {
        throw new Error("simulated network failure");
      },
      URL,
      TextEncoder,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await csb.fetchCsbAnnouncements();
  assert.deepEqual(Array.from(results), []);
});

test("csb.ts: a page with no relevant items returns an empty list, not filler", async () => {
  const noRelevantHtml = `
    <div class="haberler-card-wrapper">
      <a href="https://csb.gov.tr/haberler/x" target="_self" class="haberler-card-image-wrapper"><img alt=""></a>
      <div class="haberler-card-body-wrapper"><span class="date">28 Ağustos 2026</span></div>
      <div class="haberler-card-footer-wrapper"><p class="truncate-text-2"><a href="https://csb.gov.tr/haberler/x" target="_self">MOĞOLİSTAN ZİYARETİ</a></p></div>
    </div>`;
  const csb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/csb.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMockFetch(noRelevantHtml),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await csb.fetchCsbAnnouncements();
  assert.deepEqual(Array.from(results), []);
});

// ============================================================
// Current Content Radar V1 (Layer 2): providers/economyNews.ts — AA
// Economy + Dünya RSS. Modeled on real RSS 2.0 structure (CDATA-wrapped
// title, RFC 822 pubDate) — the same shape both live feeds were confirmed
// to return during this task's own investigation.
// ============================================================

const AA_ECONOMY_FIXTURE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>AA Ekonomi</title>
<item>
  <title><![CDATA[Kira sözleşmelerinin e-Devlet üzerinden hazırlanmasının zorunlu olması öngörülüyor]]></title>
  <link>https://www.aa.com.tr/tr/ekonomi/kira-sozlesmeleri-1</link>
  <pubDate>Sun, 30 Aug 2026 13:01:54 +0300</pubDate>
</item>
<item>
  <title><![CDATA[Ayçiçeği üreticisinin yüzü rekolte artışı beklentisiyle gülüyor]]></title>
  <link>https://www.aa.com.tr/tr/ekonomi/aycicegi-1</link>
  <pubDate>Sun, 30 Aug 2026 11:01:59 +0300</pubDate>
</item>
</channel></rss>`;

const DUNYA_FIXTURE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Dünya Gazetesi</title>
<item>
  <title><![CDATA[Kira sözleşmelerinde yeni dönem]]></title>
  <link>https://www.dunya.com/ekonomi/kira-sozlesmelerinde-yeni-donem</link>
  <pubDate>Sun, 30 Aug 2026 13:07:00 +0300</pubDate>
</item>
<item>
  <title><![CDATA[Galatasaray Rafael Leao'yu kadrosuna kattı]]></title>
  <link>https://www.dunya.com/spor/galatasaray-leao</link>
  <pubDate>Sun, 30 Aug 2026 13:21:00 +0300</pubDate>
</item>
</channel></rss>`;

function makeMultiUrlMockFetch(responsesByUrl) {
  return async (url) => {
    const key = String(url);
    const entry = responsesByUrl[key];
    if (!entry) throw new Error(`no mock configured for ${key}`);
    if (entry.error) throw entry.error;
    return {
      ok: entry.ok ?? true,
      status: entry.status ?? 200,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? (entry.contentType ?? "application/rss+xml; charset=UTF-8") : null) },
      arrayBuffer: async () => new TextEncoder().encode(entry.body).buffer,
    };
  };
}

const AA_URL = "https://www.aa.com.tr/tr/rss/default?cat=ekonomi";
const DUNYA_URL = "https://www.dunya.com/rss";

test("economyNews.ts: extracts relevant items from both feeds, dropping unrelated ones (rent/kira qualifies, sunflower harvest and football do not)", async () => {
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../types") return {};
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch({
        [AA_URL]: { body: AA_ECONOMY_FIXTURE_RSS },
        [DUNYA_URL]: { body: DUNYA_FIXTURE_RSS },
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.equal(results.length, 2, "only the two genuinely rent/property-relevant items should survive across both feeds");
  assert.ok(results.every((r) => /kira/i.test(r.title)));
  assert.ok(results.some((r) => r.publisher === "Anadolu Ajansı (AA)"));
  assert.ok(results.some((r) => r.publisher === "Dünya Gazetesi"));
  assert.ok(results.every((r) => r.tier === "financial-news"));
  const aaResult = results.find((r) => r.publisher === "Anadolu Ajansı (AA)");
  assert.equal(aaResult.publishedAt, new Date("2026-08-30T13:01:54+03:00").toISOString());
});

test("economyNews.ts: a bare interest-rate/inflation story with no housing angle is correctly excluded (generic economy content is not Layer 2 material)", async () => {
  const genericEconomyRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[TCMB faiz kararını açıkladı]]></title>
  <link>https://www.aa.com.tr/tr/ekonomi/tcmb-faiz-karari</link>
  <pubDate>Sun, 30 Aug 2026 14:00:00 +0300</pubDate>
</item>
<item>
  <title><![CDATA[Enflasyon verileri açıklandı]]></title>
  <link>https://www.aa.com.tr/tr/ekonomi/enflasyon</link>
  <pubDate>Sun, 30 Aug 2026 14:10:00 +0300</pubDate>
</item>
</channel></rss>`;
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch({
        [AA_URL]: { body: genericEconomyRss },
        [DUNYA_URL]: { body: "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>" },
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.deepEqual(Array.from(results), [], "bare faiz/enflasyon with no housing-specific phrase must not qualify Layer 2");
});

test("economyNews.ts: one feed failing never breaks the other — the AA outage still leaves Dünya's real entry", async () => {
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch({
        [AA_URL]: { error: new Error("simulated network failure") },
        [DUNYA_URL]: { body: DUNYA_FIXTURE_RSS },
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.equal(results.length, 1);
  assert.equal(results[0].publisher, "Dünya Gazetesi");
});

test("economyNews.ts: both feeds failing returns an empty list, never throws", async () => {
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: async () => {
        throw new Error("simulated total outage");
      },
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.deepEqual(Array.from(results), []);
});

// ============================================================
// Current Content Radar V1 micro-fix (Defect 2): RSS-derived titles must
// safely decode standard HTML/XML entities, including zero-padded
// numeric character references — the real production defect: Dünya's
// feed encoded an apostrophe as "&#039;" (not the bare "&#39;" the old
// decoder only recognized), leaving "Şimşek&#039;ten" undecoded in the
// UI.
// ============================================================

test("economyNews.ts: a zero-padded numeric entity (&#039;) decodes to a real apostrophe — the exact live production defect", async () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[Kira sözleşmelerinde yeni dönem: Bakan Şimşek&#039;ten e-Devlet çağrısı]]></title>
  <link>https://www.dunya.com/ekonomi/kira-sozlesmelerinde-yeni-donem</link>
  <pubDate>Sun, 30 Aug 2026 13:07:00 +0300</pubDate>
</item>
</channel></rss>`;
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch({
        [AA_URL]: { body: "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>" },
        [DUNYA_URL]: { body: rss },
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Kira sözleşmelerinde yeni dönem: Bakan Şimşek'ten e-Devlet çağrısı");
});

test("economyNews.ts: standard named entities (&amp; &quot;) and an unpadded numeric entity (&#39;) all decode correctly", async () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title><![CDATA[Konut &amp; Kira Piyasasında &quot;Yeni Dönem&quot; ve Emlak&#39;ın Rolü]]></title>
  <link>https://www.dunya.com/ekonomi/entity-test</link>
  <pubDate>Sun, 30 Aug 2026 13:07:00 +0300</pubDate>
</item>
</channel></rss>`;
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch({
        [AA_URL]: { body: "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel></channel></rss>" },
        [DUNYA_URL]: { body: rss },
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Konut & Kira Piyasasında \"Yeni Dönem\" ve Emlak'ın Rolü");
});

// ============================================================
// Current Content Radar V1: retrieval/router.ts registers all 5
// adapters, and one throwing/hanging adapter can never break the others
// or the overall discovery request.
// ============================================================

test("retrieval/router.ts registers all 5 live adapters (tcmb, tkgm, resmiGazete, csb, economyNews)", () => {
  const routerSource = fs.readFileSync(
    path.join(projectRoot, "src/lib/ai/research/retrieval/router.ts"),
    "utf8",
  );
  assert.match(routerSource, /fetchTcmbAnnouncements/);
  assert.match(routerSource, /fetchTkgmAnnouncements/);
  assert.match(routerSource, /fetchResmiGazeteAnnouncements/);
  assert.match(routerSource, /fetchCsbAnnouncements/);
  assert.match(routerSource, /fetchEconomyNewsAnnouncements/);
});

test("retrieveCurrentInformation: one adapter throwing never breaks the others — the combined result still includes every working adapter's entries", async () => {
  const router = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/router.ts",
    (specifier) => {
      if (specifier === "./providers/tcmb") {
        return { fetchTcmbAnnouncements: async () => [makeResult({ title: "TCMB Faiz Duyurusu", url: "https://www.tcmb.gov.tr/x/a" })] };
      }
      if (specifier === "./providers/tkgm") {
        return {
          fetchTkgmAnnouncements: async () => {
            throw new Error("simulated TKGM outage");
          },
        };
      }
      if (specifier === "./providers/resmiGazete") {
        return {
          fetchResmiGazeteAnnouncements: async () => {
            throw new Error("simulated Resmî Gazete timeout");
          },
        };
      }
      if (specifier === "./providers/csb") {
        return { fetchCsbAnnouncements: async () => [makeResult({ title: "İmar Planı Onaylandı", url: "https://csb.gov.tr/x/b" })] };
      }
      if (specifier === "./providers/economyNews") {
        return { fetchEconomyNewsAnnouncements: async () => [makeResult({ title: "Kira Sözleşmelerinde Yeni Dönem", url: "https://www.dunya.com/x/c" })] };
      }
      return {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await router.retrieveCurrentInformation({ keywords: ["faiz", "imar", "kira"] });
  assert.equal(results.length, 3, "all three working adapters' entries must survive two other adapters throwing");
  assert.ok(results.some((r) => r.title === "TCMB Faiz Duyurusu"));
  assert.ok(results.some((r) => r.title === "İmar Planı Onaylandı"));
  assert.ok(results.some((r) => r.title === "Kira Sözleşmelerinde Yeni Dönem"));
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

// ============================================================
// Phase 4: recurring-series/event-family suppression — the exact
// live-observed case: TCMB's own "Faiz Oranlarına İlişkin Basın
// Duyurusu (YYYY-NN)" title recurs across genuinely distinct events
// (Phase 3's title/URL dedup correctly keeps them as separate
// opportunities), but a current-content SHORTLIST should not let one
// prolific recurring series occupy more than one slot.
// ============================================================

test("recurring series: the real 'Faiz Oranlarına İlişkin Basın Duyurusu (...)' series occupies at most one shortlist slot", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)", url: "https://www.tcmb.gov.tr/x/duy2026-28", publishedAt: "2026-07-23T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-23)", url: "https://www.tcmb.gov.tr/x/duy2026-23", publishedAt: "2026-06-11T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2025-63)", url: "https://www.tcmb.gov.tr/x/duy2025-63", publishedAt: "2025-12-11T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2025-55)", url: "https://www.tcmb.gov.tr/x/duy2025-55", publishedAt: "2025-10-23T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında", url: "https://www.tkgm.gov.tr/x/tapu-uyusmazlik", publishedAt: "2026-08-12T00:00:00.000Z", tier: "official-authority" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz", "tapu"], 5);

  const faizEntries = ranked.filter((o) => o.topic.startsWith("Faiz Oranlarına İlişkin Basın Duyurusu"));
  assert.equal(faizEntries.length, 1, "the recurring series must occupy at most one shortlist slot");
  // The newest instance of the series must be the one kept.
  assert.equal(faizEntries[0].topic, "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)");
  // The genuinely different TKGM opportunity must still get its own slot.
  assert.ok(ranked.some((o) => o.topic.startsWith("Davalı Olduğu Halde")));
});

test("recurring series: quality > count — fewer than the requested limit is returned rather than padding with the same series", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  // Every candidate belongs to the SAME recurring series — only one can
  // ever occupy a shortlist slot, so a limit of 5 must return 1, not 5.
  const results = Array.from({ length: 5 }, (_, i) =>
    makeResult({
      title: `Faiz Oranlarına İlişkin Basın Duyurusu (2026-${20 + i})`,
      url: `https://www.tcmb.gov.tr/x/duy2026-${20 + i}`,
      publishedAt: `2026-0${7 - i}-15T00:00:00.000Z`,
      tier: "official-authority",
    }),
  );
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz"], 5);
  assert.equal(ranked.length, 1, "quality > count: must not pad the shortlist with repeats of the same series");
});

// ============================================================
// Current Content Radar V1: semantic near-duplicate detection — a second
// SOURCE (Layer 2, providers/economyNews.ts) can report a differently-
// worded story about the SAME underlying development a Layer 1 official
// adapter already found. deriveSeriesKey's exact-trailing-parenthetical
// scheme does not catch this (the titles aren't near-identical strings);
// this is the Jaccard-token-overlap layer that does.
// ============================================================

test("semantic near-duplicate: the same TCMB rate decision reported by both TCMB directly and AA (differently worded) collapses to one shortlist slot", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Merkez Bankası Politika Faizini Yüzde 37'de Sabit Tuttu",
      url: "https://www.tcmb.gov.tr/x/faiz-karari-2026-30",
      publishedAt: "2026-08-25T10:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Merkez Bankası Politika Faizini Yüzde 37 Seviyesinde Sabit Bıraktı",
      url: "https://www.aa.com.tr/tr/ekonomi/merkez-bankasi-faiz-1",
      publishedAt: "2026-08-25T11:30:00.000Z",
      tier: "financial-news",
    }),
    makeResult({
      title: "Kira Sözleşmelerinde Yeni Dönem Başlıyor",
      url: "https://www.dunya.com/x/kira-yeni-donem",
      publishedAt: "2026-08-25T12:00:00.000Z",
      tier: "financial-news",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz", "kira"], 5);

  const faizEntries = ranked.filter((o) => /faiz/i.test(o.topic));
  assert.equal(faizEntries.length, 1, "the same rate decision reported by two sources must collapse to one opportunity");
  // Higher-tier (official-authority) source wins the shared slot over the
  // same-scoring-tie financial-news report of the identical development.
  assert.equal(faizEntries[0].sources[0].tier, "official-authority");
  // The genuinely distinct rental story must still get its own slot.
  assert.ok(ranked.some((o) => /kira/i.test(o.topic)));
});

test("semantic near-duplicate: two genuinely different official announcements that merely share bureaucratic boilerplate ('İlişkin', 'Basın Duyurusu') are NOT collapsed", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Faiz Oranlarına İlişkin Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/duy-a",
      publishedAt: "2026-08-25T00:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Faiz Kararına İlişkin İkinci Basın Duyurusu",
      url: "https://www.tcmb.gov.tr/x/duy-b",
      publishedAt: "2026-08-25T00:00:00.000Z",
      tier: "official-authority",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz"], 5);
  assert.equal(ranked.length, 2, "genuinely distinct announcements must not be collapsed merely for sharing generic administrative vocabulary");
});

test("semantic near-duplicate: differently-worded but textually-similar titles published more than 4 days apart are never collapsed", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Merkez Bankası Politika Faizini Yüzde 37'de Sabit Tuttu",
      url: "https://www.tcmb.gov.tr/x/faiz-karari-2026-30",
      publishedAt: "2026-08-25T10:00:00.000Z",
      tier: "official-authority",
    }),
    makeResult({
      title: "Merkez Bankası Politika Faizini Yüzde 37 Seviyesinde Sabit Bıraktı",
      url: "https://www.aa.com.tr/tr/ekonomi/merkez-bankasi-faiz-eski-haber",
      publishedAt: "2026-08-10T10:00:00.000Z",
      tier: "financial-news",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz"], 5);
  assert.equal(ranked.length, 2, "textually-similar titles more than 4 days apart are treated as distinct — never assumed to be the same event, since being 15 days apart makes them plausibly two different rate decisions");
});

// ============================================================
// Current Content Radar V1 micro-fix: the real production case the
// distinctive-signature check exists for — Dünya's and AA's own genuine
// live titles about the SAME e-Devlet rental-contract story, worded too
// differently (~0.14-0.23 Jaccard even after stemming) for the ratio
// check alone to ever collapse them.
// ============================================================

test("distinctive-signature near-duplicate: the real production AA + Dünya e-Devlet rental-contract stories collapse to ONE opportunity", () => {
  const now = new Date("2026-08-30T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Kira sözleşmelerinde yeni dönem: Bakan Şimşek'ten e-Devlet çağrısı",
      url: "https://www.dunya.com/ekonomi/kira-sozlesmelerinde-yeni-donem",
      publishedAt: "2026-08-30T13:07:00.000Z",
      tier: "financial-news",
    }),
    makeResult({
      title: "Kira sözleşmelerinin e-Devlet üzerinden hazırlanmasının zorunlu olması öngörülüyor",
      url: "https://www.aa.com.tr/tr/ekonomi/kira-sozlesmeleri-1",
      publishedAt: "2026-08-30T13:01:54.000Z",
      tier: "financial-news",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["kira"], 5);
  assert.equal(ranked.length, 1, "the same e-Devlet rental-contract story reported by two outlets must collapse to one opportunity");
});

test("distinctive-signature near-duplicate: two genuinely different rental/housing stories sharing only generic domain words (kira/konut/gayrimenkul) are NOT collapsed", () => {
  const now = new Date("2026-08-30T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Öğrenci Kira Fiyatları Üniversite Şehirlerinde Yüzde 40 Arttı",
      url: "https://www.dunya.com/ekonomi/ogrenci-kira-fiyatlari",
      publishedAt: "2026-08-30T09:00:00.000Z",
      tier: "financial-news",
    }),
    makeResult({
      title: "Gayrimenkul Yatırımcıları Konut Projelerine Yöneldi",
      url: "https://www.aa.com.tr/tr/ekonomi/gayrimenkul-yatirimcilari",
      publishedAt: "2026-08-30T10:00:00.000Z",
      tier: "financial-news",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["kira", "gayrimenkul", "konut"], 5);
  assert.equal(ranked.length, 2, "two different stories must not collapse merely for sharing broad domain words — no distinctive-signature term is shared, and overall wording is otherwise unrelated");
});

test("distinctive-signature near-duplicate: even a shared distinctive term (e.g. 'sözleşme') does not collapse two stories more than 4 days apart", () => {
  const now = new Date("2026-08-30T00:00:00.000Z");
  const results = [
    makeResult({
      title: "Kira sözleşmelerinde yeni dönem: Bakan Şimşek'ten e-Devlet çağrısı",
      url: "https://www.dunya.com/ekonomi/kira-sozlesmelerinde-yeni-donem",
      publishedAt: "2026-08-30T13:07:00.000Z",
      tier: "financial-news",
    }),
    makeResult({
      title: "Kira sözleşmelerinin e-Devlet üzerinden hazırlanmasının zorunlu olması öngörülüyor",
      url: "https://www.aa.com.tr/tr/ekonomi/kira-sozlesmeleri-eski-haber",
      publishedAt: "2026-08-10T13:01:54.000Z",
      tier: "financial-news",
    }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["kira"], 5);
  assert.equal(ranked.length, 2, "the date-window guard must still gate the distinctive-signature check, not only the ratio-based one — 20 days apart is too far to assume the same event");
});

// ============================================================
// Research Breadth Expansion: new topic families (zoning-construction,
// rental-housing), broadened keyword vocabulary, and the diversity soft
// cap on the shortlist-fill pass.
// ============================================================

test("Turkish dotted-İ regression: a title that starts with the capitalized word (İmar, İstatistik) still classifies correctly — plain regex /i does not fold İ to i", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "İmar Planı Değişikliği Onaylandı", url: "https://www.tkgm.gov.tr/x/imar-cap", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
    makeResult({ title: "İstatistik Verileri Açıklandı", url: "https://www.tuik.gov.tr/x/istatistik-cap", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  assert.equal(built[0].topicFamily, "zoning-construction", "capitalized 'İmar' must still match the zoning-construction rule");
  assert.equal(built[1].topicFamily, "market-data", "capitalized 'İstatistik' must still match the market-data rule");
  // suggestContentType and buildRiskCaveat share the same bug class —
  // both must also see through the capitalized form.
  assert.equal(built[0].suggestedContentType, "educational");
  assert.ok(built[0].riskCaveat, "a capitalized 'İmar' title must still receive the regulatory caveat");
});

test("topic family: zoning/construction content (imar) is now its own family, separate from tapu/kadastro regulation-property", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "İmar Planı Değişikliği Onaylandı", url: "https://www.tkgm.gov.tr/x/imar", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(built.topicFamily, "zoning-construction");
});

test("topic family: rental-market content (kira) has its own family instead of falling through to the generic catch-all", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Kira Artış Oranlarına İlişkin Açıklama", url: "https://www.tcmb.gov.tr/x/kira", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(built.topicFamily, "rental-housing");
});

test("topic family: a pure tapu/kadastro title is still regulation-property, unaffected by imar's split into its own family", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Tapu Harcı Güncellemesi", url: "https://www.tkgm.gov.tr/x/harc", tier: "official-authority", publishedAt: "2026-08-20T00:00:00.000Z" }),
  ];
  const [built] = discover.buildContentOpportunities(results, now);
  assert.equal(built.topicFamily, "regulation-property");
});

test("buildRetrievalQuery covers the expanded category vocabulary without dropping any original term", () => {
  const query = discover.buildRetrievalQuery(businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE);
  for (const term of ["konut", "faiz", "kredi", "tapu", "imar", "fiyat", "piyasa", "gayrimenkul"]) {
    assert.ok(query.keywords.includes(term), `must keep original term: ${term}`);
  }
  for (const term of ["kira", "kadastro", "vergi", "enflasyon", "inşaat", "takbis"]) {
    assert.ok(query.keywords.includes(term), `must add new category term: ${term}`);
  }
});

test("category diversity: a rich multi-family pool spans at least 5 distinct families and no family exceeds the soft cap of 2", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-30)", url: "https://www.tcmb.gov.tr/x/faiz-30", publishedAt: "2026-08-25T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Kredi Faizlerinde Yeni Düzenleme", url: "https://www.tcmb.gov.tr/x/kredi-2", publishedAt: "2026-08-24T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "PPK Toplantı Özeti Yayımlandı", url: "https://www.tcmb.gov.tr/x/ppk-3", publishedAt: "2026-08-23T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Tapu İşlemlerinde Yeni Uygulama Başladı", url: "https://www.tkgm.gov.tr/x/tapu-1", publishedAt: "2026-08-21T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Kadastro Güncelleme Çalışmaları Tamamlandı", url: "https://www.tkgm.gov.tr/x/kadastro-1", publishedAt: "2026-08-20T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "İmar Planı Değişikliği Onaylandı", url: "https://www.tkgm.gov.tr/x/imar-1", publishedAt: "2026-08-19T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Kira Artış Oranlarına İlişkin Açıklama", url: "https://www.tcmb.gov.tr/x/kira-1", publishedAt: "2026-08-18T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Konut Satış İstatistikleri Açıklandı", url: "https://www.tuik.gov.tr/x/satis-1", publishedAt: "2026-08-17T00:00:00.000Z", tier: "official-authority" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(
    built,
    ["faiz", "kredi", "tapu", "kadastro", "imar", "kira", "konut"],
    6, // fewer than the 8-candidate pool, so the soft cap is genuinely exercised
  );

  assert.equal(ranked.length, 6);
  const families = ranked.map((o) => o.topicFamily);
  const uniqueFamilies = new Set(families);
  assert.ok(uniqueFamilies.size >= 5, `expected at least 5 distinct families, got: ${[...uniqueFamilies].join(", ")}`);
  for (const family of uniqueFamilies) {
    assert.ok(
      families.filter((f) => f === family).length <= 2,
      `family ${family} exceeded the soft cap of 2 despite 8 candidates being available for a limit of 6`,
    );
  }
});

test("category diversity never forces a weak/stale zoning entry into the shortlist merely to fill a new family slot", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu", url: "https://www.tcmb.gov.tr/x/faiz-strong", publishedAt: "2026-08-25T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "Kredi Faizlerinde Yeni Düzenleme", url: "https://www.tcmb.gov.tr/x/kredi-strong", publishedAt: "2026-08-24T00:00:00.000Z", tier: "official-authority" }),
    // Weak, stale, commentary-only zoning-construction entry — must not be
    // forced in merely to represent its (new) family.
    makeResult({ title: "İmar hakkında eski bir yorum yazısı", url: "https://random-blog.example/eski-imar-yorumu", publishedAt: "2020-01-01T00:00:00.000Z", tier: "commentary" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz", "kredi", "imar"], 2);

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((o) => o.topicFamily === "credit-interest"));
  assert.ok(!ranked.some((o) => o.sources.some((s) => s.url.includes("random-blog.example"))));
});

test("recurring series: distinct, non-recurring titles are never merged by the series key", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");
  const results = [
    makeResult({ title: "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)", url: "https://www.tcmb.gov.tr/x/a", publishedAt: "2026-08-01T00:00:00.000Z", tier: "official-authority" }),
    makeResult({ title: "FAST Sistemi İşlem Tutar Limitinin Artırılması Hakkında Basın Duyurusu (2026-36)", url: "https://www.tcmb.gov.tr/x/b", publishedAt: "2026-08-24T00:00:00.000Z", tier: "official-authority" }),
  ];
  const built = discover.buildContentOpportunities(results, now);
  const ranked = discover.rankContentOpportunities(built, ["faiz"], 5);
  assert.equal(ranked.length, 2, "two genuinely different recurring-title series must both be kept");
});

// Source Intelligence (Radar V2) — real regression: TKGM published two
// announcements for one 29.09.2026 approval. The shortlist still shows
// ONE opportunity, but it now carries BOTH official sources (each with its
// own identity/evidence) instead of silently dropping the second.
test("rankContentOpportunities: a suppressed same-event item's source is kept on the picked opportunity, authority first, ranking unchanged", () => {
  const now = new Date("2026-10-17T00:00:00.000Z");
  const results = [
    makeResult({ title: "2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru", url: "https://www.tkgm.gov.tr/duyurular/20244", publishedAt: "2026-09-28T21:00:00.000Z", tier: "official-authority", evidenceText: "A kanıtı" }),
    makeResult({ title: "2024/2 Sayılı Genelge Güncellemesi Hakkında Duyuru", url: "https://www.tkgm.gov.tr/duyurular/20242", publishedAt: "2026-09-28T21:00:00.000Z", tier: "official-authority", evidenceText: "B kanıtı" }),
    makeResult({ title: "Konut kredisi faiz oranlarında yeni dönem", url: "https://www.aa.com.tr/x", publishedAt: "2026-10-10T00:00:00.000Z", tier: "financial-news" }),
  ];
  const ranked = discover.rankContentOpportunities(discover.buildContentOpportunities(results, now), ["genelge", "konut", "kredi"], 5);
  const genelge = ranked.filter((o) => /Genelge/.test(o.topic));
  assert.equal(genelge.length, 1, "same-event items still collapse to one opportunity");
  assert.equal(genelge[0].sources.length, 2);
  assert.deepEqual(genelge[0].sources.map((s) => s.evidenceText).sort().join("|"), "A kanıtı|B kanıtı");
  const other = ranked.find((o) => /Konut/.test(o.topic));
  assert.equal(other.sources.length, 1, "unrelated opportunities are untouched");
});


// ============================================================
// Radar reliability (2026-11-17). Production returned 0 opportunities:
// TKGM PDFs unreadable from fra1 while the source reported "ok", Resmî
// Gazete dates silently empty (entity-encoded heading), and most sources
// scanned only hours/one day of a promised 30-day window. These pin date
// windows, pagination/archive bounds, relevance, partial failures and the
// separate access vs coverage reporting.
// ============================================================

const NOW = new Date("2026-11-17T12:00:00.000Z"); // 15:00 Turkey time
const WINDOW_3D = { notBefore: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000) };
const SILENT = { error: () => {}, log: () => {}, warn: () => {} };

// windows-1254 bytes for the Turkish letters used in fixtures (archive pages
// are served in that encoding, not UTF-8).
const CP1254 = { "ı": 0xfd, "İ": 0xdd, "ş": 0xfe, "Ş": 0xde, "ğ": 0xf0, "Ğ": 0xd0, "ç": 0xe7, "Ç": 0xc7, "ö": 0xf6, "Ö": 0xd6, "ü": 0xfc, "Ü": 0xdc, "–": 0x96 };
function encode1254(text) {
  return Uint8Array.from([...text].map((ch) => CP1254[ch] ?? ch.charCodeAt(0))).buffer;
}

test("coverage.ts: a source is complete only when EVERY list reaches the window; since = the most restrictive list", () => {
  const coverage = coverageModule();
  const window = { notBefore: new Date("2026-10-18T00:00:00.000Z") };
  const longFeed = ["2026-11-17T08:00:00.000Z", "2026-10-01T00:00:00.000Z"];
  const shortFeed = ["2026-11-17T13:00:00.000Z", "2026-11-17T09:00:00.000Z"];
  assert.equal(coverage.reachesWindow("2026-10-01T00:00:00.000Z", window), true);
  assert.equal(coverage.reachesWindow("2026-11-17T09:00:00.000Z", window), false);
  assert.equal(coverage.reachesWindow(null, window), false, "nothing dated never counts as covered");
  assert.equal(coverage.reachesWindow(null, undefined), true, "without a window there is nothing to reach");

  const both = coverage.coverageOfLists([longFeed, shortFeed], window);
  assert.equal(both.complete, false, "one short feed is a real gap even if another goes back further");
  assert.equal(both.since, "2026-11-17T09:00:00.000Z");
  assert.equal(coverage.coverageOfLists([longFeed], window).complete, true);
  assert.equal(coverage.coverageOfLists([], window).complete, false, "no list read = not covered");
  assert.equal(coverage.coverageOfLists([[undefined, ""]], window).since, null);
});

function loadResmiGazeteWithArchive(fetchImpl) {
  const requested = [];
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../secureFetch") return { fetchWithSystemTrust: async () => { throw new Error("not expected"); } };
      return {};
    },
    {
      console: SILENT,
      fetch: async (url, init) => {
        requested.push(String(url));
        return fetchImpl(String(url), init);
      },
      AbortController,
      setTimeout,
      clearTimeout,
      Buffer,
      TextDecoder,
      URL,
    },
  );
  return { resmiGazete, requested };
}

// Live homepage markup (2026-11-17): the heading is entity-encoded.
const RG_HOMEPAGE_ENCODED = `<html><body>
<span id="spanGazeteTarih">17 Kas&#x131;m 2026 Tarihli ve 33433 Say&#x131;l&#x131; Resm&#xEE; Gazete</span>
<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/11/20261117-1.htm">–– Tapu Sicili Tüzüğünde Değişiklik Yapılmasına Dair Yönetmelik</a></div>
<div class="fihrist-item mb-1"><a href="https://www.resmigazete.gov.tr/eskiler/2026/11/20261117-2.htm">–– Üniversite Lisansüstü Eğitim Yönetmeliği</a></div>
</body></html>`;

const rgArchivePage = (stamp, entries) =>
  `<html><head><meta name="GENERATOR" content="Microsoft FrontPage 6.0"></head><body>` +
  entries.map(([n, title]) => `<p><a href="${stamp}-${n}.htm">––&nbsp; ${title}</a></p>`).join("") +
  `<p><a href="http://www.resmigazete.gov.tr/main.aspx?home=x&main=http://www.resmigazete.gov.tr/ilanlar/eskiilanlar/x-2.htm">a - Yargı İlânları</a></p></body></html>`;

test("resmiGazete.ts: an entity-encoded issue heading still yields the issue date (regression: every entry was undated)", () => {
  const { resmiGazete } = loadResmiGazeteWithArchive(async () => htmlResponse(200, ""));
  assert.equal(resmiGazete.extractIssueDate(RG_HOMEPAGE_ENCODED), new Date("2026-11-17T00:00:00+03:00").toISOString());
  assert.equal(
    resmiGazete.issueDateFromUrl("https://www.resmigazete.gov.tr/eskiler/2026/11/20261117-3.pdf"),
    new Date("2026-11-17T00:00:00+03:00").toISOString(),
  );
  assert.equal(resmiGazete.issueDateFromUrl("https://www.resmigazete.gov.tr/eskiler/2026/10/20261117-3.pdf"), null, "folder/date mismatch is not trusted");
});

test("resmiGazete.ts: archive pages (windows-1254) yield only the issue's own entries, absolute URLs, decoded Turkish titles", () => {
  const { resmiGazete } = loadResmiGazeteWithArchive(async () => htmlResponse(200, ""));
  const html = new TextDecoder("windows-1254").decode(
    encode1254(rgArchivePage("20261116", [[1, "İmar Kanunu Uygulama Yönetmeliğinde Değişiklik"], [2, "Atılım Üniversitesi Ana Yönetmeliği"]])),
  );
  const items = resmiGazete.extractArchiveItems(html, { year: "2026", month: "11", day: "16" });
  assert.equal(items.length, 2, "the announcement-section index link is not an entry");
  assert.equal(items[0].title, "İmar Kanunu Uygulama Yönetmeliğinde Değişiklik");
  assert.equal(items[0].url, "https://www.resmigazete.gov.tr/eskiler/2026/11/20261116-1.htm");
});

test("resmiGazete.ts: with a window it reads exactly one archive page per past day, dates entries by issue, keeps only relevant ones", async () => {
  const { resmiGazete, requested } = loadResmiGazeteWithArchive(async (url) => {
    if (url === "https://www.resmigazete.gov.tr/") return htmlResponse(200, RG_HOMEPAGE_ENCODED);
    const stamp = url.match(/(\d{8})\.htm$/)[1];
    const body = rgArchivePage(stamp, [[1, `Kentsel Dönüşüm Alanı İlanı ${stamp}`], [2, "Sağlık Bakanlığı Atama Yönetmeliği"]]);
    return { status: 200, ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => encode1254(body) };
  });
  const coverages = [];
  const failures = [];
  const results = await resmiGazete.fetchResmiGazeteAnnouncements(
    { fail: (kind) => failures.push(kind), coverage: (c) => coverages.push(c) },
    WINDOW_3D,
    NOW,
  );

  assert.equal(requested.length, 1 + 3, "homepage + exactly 3 archive days, no more");
  assert.deepEqual(
    requested.slice(1).sort(),
    ["20261114", "20261115", "20261116"].map((d) => `https://www.resmigazete.gov.tr/eskiler/2026/11/${d}.htm`),
  );
  assert.equal(failures.length, 0);
  assert.equal(results.length, 4, "today's tapu entry + one kentsel dönüşüm entry per archive day; unrelated ones dropped");
  const day15 = results.find((r) => r.title.endsWith("20261115"));
  assert.equal(day15.publishedAt, new Date("2026-11-15T00:00:00+03:00").toISOString(), "an archive entry keeps its own (old) issue date");
  const today = results.find((r) => r.title.startsWith("Tapu Sicili"));
  assert.equal(today.publishedAt, new Date("2026-11-17T00:00:00+03:00").toISOString());
  assert.equal(coverages.length, 1);
  assert.equal(coverages[0].complete, true);
  assert.equal(coverages[0].since, new Date("2026-11-14T00:00:00+03:00").toISOString());
});

test("resmiGazete.ts: one unreadable archive day is reported, other days still return, coverage stops at the gap", async () => {
  const { resmiGazete } = loadResmiGazeteWithArchive(async (url) => {
    if (url === "https://www.resmigazete.gov.tr/") return htmlResponse(200, RG_HOMEPAGE_ENCODED);
    if (url.endsWith("20261115.htm")) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const stamp = url.match(/(\d{8})\.htm$/)[1];
    return { status: 200, ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => encode1254(rgArchivePage(stamp, [[1, `Kentsel Dönüşüm ${stamp}`]])) };
  });
  const coverages = [];
  const failures = [];
  const results = await resmiGazete.fetchResmiGazeteAnnouncements(
    { fail: (kind) => failures.push(kind), coverage: (c) => coverages.push(c) },
    WINDOW_3D,
    NOW,
  );
  assert.deepEqual(failures, ["archive: AbortError×1"]);
  assert.ok(results.some((r) => r.title.endsWith("20261114")), "days after the gap are still returned");
  assert.ok(results.some((r) => r.title.endsWith("20261116")));
  assert.equal(coverages[0].complete, false);
  assert.equal(coverages[0].since, new Date("2026-11-16T00:00:00+03:00").toISOString(), "fully covered only back to the gap");
});

test("resmiGazete.ts: the archive is bounded (at most MAX_ARCHIVE_DAYS requests) and unused without a window", async () => {
  const { resmiGazete, requested } = loadResmiGazeteWithArchive(async (url) =>
    url === "https://www.resmigazete.gov.tr/"
      ? htmlResponse(200, RG_HOMEPAGE_ENCODED)
      : { status: 200, ok: true, headers: { get: () => "text/html" }, arrayBuffer: async () => encode1254("<html></html>") },
  );
  assert.equal(resmiGazete.archiveDaysFor(NOW, { notBefore: new Date(NOW.getTime() - 90 * 864e5) }), resmiGazete.MAX_ARCHIVE_DAYS);
  await resmiGazete.fetchResmiGazeteAnnouncements(undefined, undefined, NOW);
  assert.deepEqual(requested, ["https://www.resmigazete.gov.tr/"], "no window = today's issue only (previous behavior)");
});

function csbPage(cards) {
  return `<section>${cards
    .map(
      ([date, title, slug]) =>
        `<div class="haberler-card-wrapper"><a href="https://www.csb.gov.tr/x/${slug}"><img/></a><span class="date">${date}</span><a href="https://www.csb.gov.tr/haberler/${slug}" target="_self">${title}</a></div>`,
    )
    .join("")}</section>`;
}

function loadCsb(pages) {
  const requested = [];
  const csb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/csb.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    {
      fetch: async (url) => {
        requested.push(String(url));
        const listing = String(url).match(/\/haberler(?:\/(\d+))?$/);
        if (!listing) return htmlResponse(200, "<p>detay</p>");
        const page = Number(listing[1] ?? 1);
        const body = pages(page);
        if (body instanceof Error) throw body;
        return { ...htmlResponse(200, body), ok: true };
      },
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: SILENT,
    },
  );
  return { csb, requested: () => requested.filter((u) => /\/haberler(\/\d+)?$/.test(u)) };
}

test("csb.ts: pages until a page reaches the window start, then stops; relevance still filters", async () => {
  const { csb, requested } = loadCsb((page) =>
    page === 1
      ? csbPage([["17 Kasım 2026", "COP31 İKLİM ZİRVESİ", "a"], ["16 Kasım 2026", "KENTSEL DÖNÜŞÜMDE YENİ ETAP", "b"]])
      : page === 2
        ? csbPage([["15 Kasım 2026", "ORMAN YANGINI TATBİKATI", "c"], ["12 Kasım 2026", "İMAR PLANI ASKIYA ÇIKTI", "d"]])
        : csbPage([["10 Kasım 2026", "SOSYAL KONUT KURASI", "e"]]),
  );
  const coverages = [];
  const results = await csb.fetchCsbAnnouncements({ fail: () => {}, coverage: (c) => coverages.push(c) }, WINDOW_3D);
  assert.deepEqual(requested(), ["https://www.csb.gov.tr/haberler", "https://www.csb.gov.tr/haberler/2"], "page 2 already reaches 14 Nov → no page 3");
  assert.deepEqual([...results.map((r) => r.title)].sort(), ["KENTSEL DÖNÜŞÜMDE YENİ ETAP", "İMAR PLANI ASKIYA ÇIKTI"].sort());
  assert.equal(coverages[0].complete, true);
});

test("csb.ts: a window the page cap cannot reach is reported incomplete (never treated as 'nothing there')", async () => {
  const { csb, requested } = loadCsb(() => csbPage([["17 Kasım 2026", "COP31 İKLİM ZİRVESİ", "a"]]));
  const coverages = [];
  await csb.fetchCsbAnnouncements({ fail: () => {}, coverage: (c) => coverages.push(c) }, WINDOW_3D);
  assert.equal(requested().length, csb.MAX_PAGES, "bounded by MAX_PAGES");
  assert.equal(coverages[0].complete, false);
  assert.equal(coverages[0].since, new Date("2026-11-17T00:00:00+03:00").toISOString());
});

test("csb.ts: a failing later page keeps the earlier pages' results and reports the failure", async () => {
  const { csb } = loadCsb((page) =>
    page === 1 ? csbPage([["17 Kasım 2026", "KENTSEL DÖNÜŞÜMDE YENİ ETAP", "b"]]) : Object.assign(new Error("aborted"), { name: "AbortError" }),
  );
  const failures = [];
  const coverages = [];
  const results = await csb.fetchCsbAnnouncements({ fail: (k) => failures.push(k), coverage: (c) => coverages.push(c) }, WINDOW_3D);
  assert.equal(results.length, 1);
  assert.deepEqual(failures, ["page 2: AbortError"]);
  assert.equal(coverages[0].complete, false);
});

test("csb.ts: without a window only page 1 is read (previous behavior)", async () => {
  const { csb, requested } = loadCsb(() => csbPage([["17 Kasım 2026", "KENTSEL DÖNÜŞÜMDE YENİ ETAP", "b"]]));
  await csb.fetchCsbAnnouncements();
  assert.deepEqual(requested(), ["https://www.csb.gov.tr/haberler"]);
});

test("economyNews.ts: an RSS feed that spans only hours is reported as a coverage gap against a 30-day window", async () => {
  const rss = (dates) =>
    `<rss><channel>${dates.map((d, i) => `<item><title>Haber ${i}</title><link>https://www.aa.com.tr/x/${i}</link><pubDate>${d}</pubDate></item>`).join("")}</channel></rss>`;
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    {
      fetch: async (url) => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/rss+xml" },
        arrayBuffer: async () =>
          new TextEncoder().encode(
            String(url).includes("aa.com.tr")
              ? rss(["Tue, 17 Nov 2026 16:49:00 +0300", "Tue, 17 Nov 2026 08:02:00 +0300"])
              : rss(["Tue, 17 Nov 2026 18:37:00 +0300", "Tue, 17 Nov 2026 13:24:00 +0300"]),
          ).buffer,
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: SILENT,
    },
  );
  const coverages = [];
  await economyNews.fetchEconomyNewsAnnouncements({ fail: () => {}, coverage: (c) => coverages.push(c) }, { notBefore: new Date("2026-10-18T00:00:00Z") });
  assert.equal(coverages[0].complete, false);
  assert.equal(coverages[0].since, new Date("2026-11-17T13:24:00+03:00").toISOString(), "the shorter feed bounds what was fully read");
});

function loadRouterWith(adapters) {
  return loadTypeScriptModule(
    "src/lib/ai/research/retrieval/router.ts",
    (specifier) => {
      const map = {
        "./providers/tcmb": { fetchTcmbAnnouncements: adapters.tcmb },
        "./providers/tkgm": { fetchTkgmAnnouncements: adapters.tkgm },
        "./providers/resmiGazete": { fetchResmiGazeteAnnouncements: adapters.rg },
        "./providers/csb": { fetchCsbAnnouncements: adapters.csb },
        "./providers/economyNews": { fetchEconomyNewsAnnouncements: adapters.news },
      };
      return map[specifier] ?? {};
    },
    { console: SILENT },
  );
}

test("retrieveCurrentInformation: one source failing never hides the others; access status and coverage are reported per source", async () => {
  const window = { notBefore: new Date("2026-10-18T00:00:00Z") };
  const seenWindows = [];
  const router = loadRouterWith({
    tcmb: async (report, w) => {
      seenWindows.push(w);
      report.coverage({ since: "2026-07-01T00:00:00.000Z", complete: true });
      return [makeResult({ title: "TCMB Faiz Duyurusu", url: "https://www.tcmb.gov.tr/x/a" })];
    },
    tkgm: async (report) => {
      report.fail("evidence: AbortError×6");
      report.coverage({ since: "2026-09-28T00:00:00.000Z", complete: true });
      return [makeResult({ title: "Tapu Duyurusu", url: "https://www.tkgm.gov.tr/duyurular/x" })];
    },
    rg: async () => {
      throw new Error("simulated outage");
    },
    // Read 29 of 30 days, nothing relevant: partial, NOT error.
    csb: async (report) => {
      report.fail("page 3: AbortError");
      report.coverage({ since: "2026-11-10T00:00:00.000Z", complete: false });
      return [];
    },
    // Nothing read at all.
    news: async (report) => {
      report.fail("AA: AbortError");
      return [];
    },
  });

  const reports = {};
  const results = await router.retrieveCurrentInformation(
    { keywords: ["faiz", "tapu"] },
    { window, onAdapterReport: (source, report) => (reports[source] = report) },
  );
  assert.equal(results.length, 2, "the working sources' entries still come back");
  assert.equal(seenWindows[0], window, "the window is passed to adapters");
  assert.equal(reports.tcmb.status, "ok");
  assert.equal(reports.tkgm.status, "partial");
  assert.equal(reports["resmi-gazete"].status, "error");
  assert.equal(reports.csb.status, "partial", "0 relevant items after reading pages is not an access error");
  assert.equal(reports["aa-dunya"].status, "error");
  assert.equal(reports.csb.coverage.complete, false);
});

test("describeSourceReport: access problems and coverage gaps are separate lists; an unreachable source gets no coverage line", () => {
  const { describeSourceReport } = loadTypeScriptModule("src/lib/ai/research/sourceIssues.ts", (specifier) =>
    specifier === "./retrieval/turkishDate" ? turkishDate : {},
  );
  const now = new Date("2026-11-17T16:00:00.000Z");
  const summary = describeSourceReport(
    {
      tcmb: { status: "ok", coverage: { since: "2026-07-01T00:00:00.000Z", complete: true } },
      tkgm: { status: "partial", coverage: { since: "2026-09-28T00:00:00.000Z", complete: true } },
      "resmi-gazete": { status: "error" },
      csb: { status: "ok", coverage: { since: "2026-11-09T21:00:00.000Z", complete: false } },
      "aa-dunya": { status: "ok", coverage: { since: "2026-11-17T10:00:00.000Z", complete: false } },
    },
    now,
  );
  assert.deepEqual([...summary.accessIssues], ["TKGM (bazı duyuru içerikleri okunamadı)", "Resmî Gazete (ulaşılamadı)"]);
  assert.deepEqual([...summary.coverageGaps], [
    "Çevre, Şehircilik ve İklim Değişikliği Bakanlığı: yalnız 10 Kasım 2026 sonrası tarandı",
    "AA / Dünya haber akışları: yalnız son 6 saat tarandı",
  ]);
});

test("/api/research/discover: returns accessIssues and coverageGaps separately and is time-bounded", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/research/discover/route.ts"), "utf8");
  assert.match(routeSource, /export const maxDuration = 60;/);
  assert.match(routeSource, /onSourceReport:/);
  assert.match(routeSource, /Response\.json\(\{ opportunities, proposals, accessIssues, coverageGaps \}\)/);
});

test("dashboard copy never claims 'nothing in the last 30 days' — only what was scanned", () => {
  const ui = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/CurrentOpportunities.tsx"), "utf8");
  assert.doesNotMatch(ui, /Son 30 günde[^.]*çıkmadı/);
  assert.match(ui, /Taranan kaynaklarda paylaşmaya uygun güncel bir gayrimenkul gelişmesi bulunamadı\./);
  assert.match(ui, /Okunamayan kaynaklar:/);
  assert.match(ui, /Kapsamı eksik kaynaklar:/);
});

test("tkgm.ts: a linked PDF that cannot be fetched is reported as a failure (source becomes partial, not a silent ok)", async () => {
  const listing = `<a class="group block" href="/duyurular/duyuru-degisikligi"><div class="flex flex-col gap-4"><h3>Duyuru Değişikliği</h3><div><span>Duyuru</span><p>19 Ekim 2026</p></div></div></a>`;
  const detail = `<html><body><main><p>Duyuru metni için ekteki dosyaya bakınız.</p><a href="https://cms-api.tkgm.gov.tr/media-library/abc123.pdf">Dosya</a></main></body></html>`;
  const fetch = async (url) => {
    if (String(url).includes("/media-library/")) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    const html = String(url).endsWith("/duyurular") || String(url).endsWith("/haberler") ? listing : detail;
    return { ok: true, status: 200, headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html; charset=UTF-8" : null) }, arrayBuffer: async () => new TextEncoder().encode(html).buffer };
  };
  const tkgm = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tkgm.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    { fetch, URL, TextEncoder, Buffer, AbortController, setTimeout, clearTimeout, Promise, console: SILENT },
  );
  const failures = [];
  const coverages = [];
  const results = await tkgm.fetchTkgmAnnouncements(
    { fail: (kind) => failures.push(kind), coverage: (c) => coverages.push(c) },
    { notBefore: new Date("2026-10-18T00:00:00Z") },
  );
  assert.ok(results.length > 0, "listing items are still returned");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^evidence: AbortError×\d+$/);
  assert.equal(coverages[0].complete, false, "a first page that does not reach the window start is a coverage gap");
});
