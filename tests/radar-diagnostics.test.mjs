import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same sandboxed loader convention used throughout tests/*.test.mjs.
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

function capturingDiagnostics() {
  const lines = [];
  const diagnosticsModule = loadTypeScriptModule("src/lib/ai/research/retrieval/diagnostics.ts", () => ({}), {
    console: { log: (line) => lines.push(line) },
  });
  const events = () => lines.map((line) => {
    const [, event, json] = line.match(/^\[radar-diag\] (\S+) (.*)$/);
    return { event, data: JSON.parse(json) };
  });
  return { diagnostics: diagnosticsModule, events };
}

const item = (title) => ({ title, url: `https://example.gov.tr/${encodeURIComponent(title)}`, publisher: "X", publishedAt: "", tier: "official-authority", snippet: title, retrievedAt: "" });

function loadRouter(adapters) {
  const { diagnostics, events } = capturingDiagnostics();
  const router = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/router.ts",
    (specifier) => {
      if (specifier === "./diagnostics") return diagnostics;
      const map = {
        "./providers/tcmb": { fetchTcmbAnnouncements: adapters.tcmb },
        "./providers/tkgm": { fetchTkgmAnnouncements: adapters.tkgm },
        "./providers/resmiGazete": { fetchResmiGazeteAnnouncements: adapters.resmiGazete },
        "./providers/csb": { fetchCsbAnnouncements: adapters.csb },
        "./providers/economyNews": { fetchEconomyNewsAnnouncements: adapters.economyNews },
      };
      return map[specifier] ?? {};
    },
    { console: { error: () => {}, log: () => {}, warn: () => {} } },
  );
  return { router, events };
}

test("router: an adapter that swallowed its failure and returned [] is logged as status 'error' (not 'ok'), with the safe error kind", async () => {
  const { router, events } = loadRouter({
    tcmb: async () => [item("Konut Fiyat Endeksi")],
    tkgm: async (report) => {
      report.fail("/duyurular: AbortError");
      return [item("Tapu duyurusu")];
    },
    resmiGazete: async () => [],
    csb: async (report) => {
      report.fail("AbortError");
      return [];
    },
    economyNews: async () => [],
  });
  const results = await router.retrieveCurrentInformation({ keywords: [] }, { maxResults: 50 });
  assert.equal(results.length, 2, "returned items are unchanged by the diagnostics");

  const adapterLines = Object.fromEntries(events().filter((e) => e.event === "adapter").map((e) => [e.data.source, e.data]));
  assert.equal(adapterLines.csb.status, "error");
  assert.equal(JSON.stringify(adapterLines.csb.errors), JSON.stringify(["AbortError"]));
  assert.equal(adapterLines.tkgm.status, "partial", "one page failed, the other still returned items");
  assert.equal(adapterLines.tcmb.status, "ok");
  assert.equal(adapterLines["resmi-gazete"].status, "ok", "an honest empty result (no failure reported) stays ok");
  assert.equal(adapterLines.tcmb.errors, undefined);

  const started = events().filter((e) => e.event === "adapter-start").map((e) => e.data.source).sort();
  assert.equal(started.join(","), "aa-dunya,csb,resmi-gazete,tcmb,tkgm", "every adapter logs that it was called");
});

test("router: an adapter that throws is still isolated and logged as error", async () => {
  const { router, events } = loadRouter({
    tcmb: async () => [item("Konut")],
    tkgm: async () => {
      throw new Error("simulated outage");
    },
    resmiGazete: async () => [],
    csb: async () => [],
    economyNews: async () => [],
  });
  const results = await router.retrieveCurrentInformation({ keywords: [] }, { maxResults: 50 });
  assert.equal(results.length, 1);
  const tkgm = events().find((e) => e.event === "adapter" && e.data.source === "tkgm").data;
  assert.equal(tkgm.status, "error");
  assert.match(tkgm.error, /simulated outage/);
});

test("csb.ts: a listing AbortError is reported to the router and the adapter still returns [] (never throws)", async () => {
  const { diagnostics } = capturingDiagnostics();
  const reported = [];
  const csb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/csb.ts",
    (specifier) => (specifier === "../diagnostics" ? diagnostics : {}),
    {
      console: { error: () => {}, log: () => {}, warn: () => {} },
      fetch: async () => {
        const error = new Error("This operation was aborted");
        error.name = "AbortError";
        throw error;
      },
      AbortController,
      setTimeout,
      clearTimeout,
    },
  );
  const results = await csb.fetchCsbAnnouncements({ fail: (kind) => reported.push(kind) });
  assert.deepEqual(Array.from(results), []);
  assert.deepEqual(reported, ["AbortError"]);
  assert.deepEqual(Array.from(await csb.fetchCsbAnnouncements()), [], "callers that pass no reporter are unaffected");
});

function discoverQueryKeywords() {
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  const discover = loadTypeScriptModule("src/lib/ai/research/discover.ts", (specifier) =>
    specifier === "../context/businessProfile" ? businessProfile : specifier.endsWith("diagnostics") ? capturingDiagnostics().diagnostics : {},
  );
  return discover.buildRetrievalQuery(businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE).keywords;
}

const rgItem = (title) => ({ ...item(title), url: "https://www.resmigazete.gov.tr/eskiler/2026/10/x.htm", publisher: "T.C. Resmî Gazete" });
const onlyResmiGazete = (items) => ({ tcmb: async () => [], tkgm: async () => [], resmiGazete: async () => items, csb: async () => [], economyNews: async () => [] });

test("router + discover query: the real Resmî Gazete 'Yapı Denetimi' tebliğ (2026-10-30) passes; unrelated gazette titles still do not", async () => {
  const yapiDenetim = "Yapı Sahipleri ile Yapı Denetimi Hizmet Sözleşmesi İmzalayacak Yapı Denetim Kuruluşlarının Belirlenmesine İlişkin Tebliğ";
  const { router } = loadRouter(onlyResmiGazete([
    rgItem(yapiDenetim),
    rgItem("Bazı Kamu Kurum ve Kuruluşlarına Ait Yönetim Kurulu Üyeliklerine Atama Kararı"),
    rgItem("Türk Gıda Kodeksi Etiketleme Tebliğinde Değişiklik Yapılmasına Dair Tebliğ"),
    rgItem("Milletlerarası Andlaşma"),
  ]));
  const titles = (await router.retrieveCurrentInformation({ keywords: discoverQueryKeywords() }, { maxResults: 50 })).map((r) => r.title);
  assert.equal(titles.join(" | "), yapiDenetim);
});

test("router: keywordFilterExempt lets a matching item through with zero keyword hits; without it the item is dropped", async () => {
  const { router, events } = loadRouter({ ...onlyResmiGazete([]), tkgm: async () => [{ ...item("Duyuru Değişikliği"), url: "https://www.tkgm.gov.tr/duyurular/x", publisher: "TKGM" }] });
  const exempt = (r) => r.url.includes("tkgm.gov.tr");
  assert.equal((await router.retrieveCurrentInformation({ keywords: ["tapu"], keywordFilterExempt: exempt }, { maxResults: 50 })).length, 1);
  const filterLine = events().filter((e) => e.event === "router-keyword-filter").at(-1).data;
  assert.equal(filterLine.exempt.TKGM, 1);
  assert.equal((await router.retrieveCurrentInformation({ keywords: ["tapu"] }, { maxResults: 50 })).length, 0);
});

test("discover route: no preferredRegion (not applied to Node.js functions on Vercel) and logs request start/end", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/app/api/research/discover/route.ts"), "utf8");
  assert.ok(!source.includes("preferredRegion"));
  assert.ok(source.includes('radarDiag("discover-request", { phase: "start"'));
  assert.ok(source.includes('radarDiag("discover-request", { phase: "end"'));
  assert.ok(source.includes('radarDiag("discover-request", { phase: "error"'));
});
