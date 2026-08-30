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

// Research Breadth Expansion v2: resmiGazete.ts now fetches via
// secureFetch.ts's fetchWithSystemTrust (node:https + a system-CA Agent)
// instead of global fetch() — these two tests mock that module directly
// instead of the global fetch, matching the real import.
test("resmiGazete.ts: keeps a genuine tapu-related entry and rejects the real false-positive case ('yapılmasına' must not match 'yapı')", async () => {
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../types") return {};
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../secureFetch") {
        return {
          fetchWithSystemTrust: async () => ({
            status: 200,
            contentType: "text/html; charset=UTF-8",
            text: RESMI_GAZETE_FIXTURE_HTML,
          }),
        };
      }
      return {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
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
      if (specifier === "../relevance") return relevance;
      if (specifier === "../secureFetch") {
        return {
          fetchWithSystemTrust: async () => {
            throw new Error("simulated TLS/network failure");
          },
        };
      }
      return {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await resmiGazete.fetchResmiGazeteAnnouncements();
  assert.deepEqual(Array.from(results), []);
});

test("resmiGazete.ts: a non-2xx status is treated as a failure and returns an empty list, never throws", async () => {
  const resmiGazete = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/resmiGazete.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../turkishDate") return turkishDate;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../secureFetch") {
        return {
          fetchWithSystemTrust: async () => ({ status: 503, contentType: "text/html", text: "" }),
        };
      }
      return {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
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
// Research Breadth Expansion v2: relevance.ts (shared word-boundary
// filter, extracted out of resmiGazete.ts now that csb.ts needs it too)
// ============================================================

test("relevance.ts: word-boundary matching rejects the real 'yapılmasına' false-positive for 'yapı', case-insensitively", () => {
  assert.equal(relevance.hasAnyWordBoundaryMatch("Değişiklik Yapılmasına Dair Yönetmelik", ["yapı"]), false);
  assert.equal(relevance.hasAnyWordBoundaryMatch("Yeni Bir Yapı İnşa Edildi", ["yapı"]), true);
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
// Research Breadth Expansion v2: retrieval/router.ts registers all 4
// adapters, and one throwing/hanging adapter can never break the others
// or the overall discovery request.
// ============================================================

test("retrieval/router.ts registers all 4 live adapters (tcmb, tkgm, resmiGazete, csb)", () => {
  const routerSource = fs.readFileSync(
    path.join(projectRoot, "src/lib/ai/research/retrieval/router.ts"),
    "utf8",
  );
  assert.match(routerSource, /fetchTcmbAnnouncements/);
  assert.match(routerSource, /fetchTkgmAnnouncements/);
  assert.match(routerSource, /fetchResmiGazeteAnnouncements/);
  assert.match(routerSource, /fetchCsbAnnouncements/);
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
      return {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
  );

  const results = await router.retrieveCurrentInformation({ keywords: ["faiz", "imar"] });
  assert.equal(results.length, 2, "both working adapters' entries must survive two other adapters throwing");
  assert.ok(results.some((r) => r.title === "TCMB Faiz Duyurusu"));
  assert.ok(results.some((r) => r.title === "İmar Planı Onaylandı"));
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
