import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Owner web search (research/ownerWebSearch.ts). No network, no billed call:
// the Anthropic client is a stub returning recorded-shape responses.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader, URL, ...globals };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const diagLines = [];
const diagnostics = loadTypeScriptModule("src/lib/ai/research/retrieval/diagnostics.ts", () => ({}), {
  console: { log: (line) => diagLines.push(line) },
});
const places = loadTypeScriptModule("src/lib/ai/research/turkishPlaces.ts");
const ownerProposals = loadTypeScriptModule("src/lib/ai/content/ownerProposals.ts", (specifier) =>
  specifier === "../research/turkishPlaces" ? places : {},
);
const { ATLAS_DEFAULT_BUSINESS_PROFILE: profile } = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
const web = loadTypeScriptModule(
  "src/lib/ai/research/ownerWebSearch.ts",
  (specifier) =>
    ({
      "../content/ownerProposals": ownerProposals,
      "./turkishPlaces": places,
      "./retrieval/diagnostics": diagnostics,
    })[specifier] ?? {},
  { console: { error: () => {}, log: () => {} }, Date, Math, Number },
);

const NOW = new Date("2026-11-18T10:00:00.000Z");
const GG = "https://www.gayrimenkulgundemi.com/konut/ev-satarken-dogru-fiyat-nasil-belirlenir";
const SP = "https://www.sariyerposta.com/haber/zekeriyakoy-yolu-calismasi";

function block(theme, title, benefit, url, format = "Carousel") {
  return `[[PROPOSAL]]\nTHEME: ${theme}\nTITLE: ${title}\nBENEFIT: ${benefit}\nSOURCE_URL: ${url}\nFORMAT: ${format}\n[[/PROPOSAL]]`;
}

function stubClient(response, calls = []) {
  return () => ({
    messages: {
      create: async (params, options) => {
        calls.push({ params, options });
        if (response instanceof Error) throw response;
        return response;
      },
    },
  });
}

const RESULTS = {
  type: "web_search_tool_result",
  tool_use_id: "srvtoolu_1",
  content: [
    { type: "web_search_result", url: GG, title: "Ev satarken doğru fiyat nasıl belirlenir?", encrypted_content: "x", page_age: "November 10, 2026" },
    { type: "web_search_result", url: SP, title: "Zekeriyaköy yolunda çalışma başladı", encrypted_content: "x", page_age: "March 2, 2025" },
  ],
};

test("profile: the web search may only use the two sites Suat named", () => {
  assert.deepEqual([...profile.webSearchDomains], ["gayrimenkulgundemi.com", "sariyerposta.com"]);
});

test("request: web_search_20260209, allowed_domains from the profile, bounded searches/tokens, direct calls, Istanbul location", () => {
  const request = web.buildOwnerWebSearchRequest(profile, "claude-sonnet-5");
  assert.equal(request.model, "claude-sonnet-5");
  assert.equal(request.max_tokens, 6000);
  assert.equal(request.tools.length, 1);
  const [tool] = request.tools;
  assert.equal(tool.type, "web_search_20260209");
  assert.equal(tool.name, "web_search");
  assert.equal(tool.max_uses, 5);
  assert.deepEqual([...tool.allowed_domains], ["gayrimenkulgundemi.com", "sariyerposta.com"]);
  assert.deepEqual([...tool.allowed_callers], ["direct"]);
  assert.equal(tool.user_location.country, "TR");
  assert.match(request.system, /URL uydurma/);
  assert.match(request.system, /kopyalama/);
  assert.match(request.system, /Fiyat artışı, satış süresi, getiri/);
  for (const id of ["pricing", "sale-delay", "sale-prep", "villa-land", "regional"]) assert.match(request.system, new RegExp(`- ${id}:`));
});

test("disabled (default): no Anthropic call at all", async () => {
  const calls = [];
  const result = await web.runOwnerWebSearch({ profile, model: "claude-sonnet-5", getClient: stubClient({}, calls), env: {} });
  assert.equal(result.status, "disabled");
  assert.equal(result.proposals.length, 0);
  assert.equal(calls.length, 0);
});

test("enabled: one call, no SDK retries, a timeout; verified proposals only; cost logged without content", async () => {
  const calls = [];
  const text = [
    block("pricing", "Ev satarken fiyatı neye göre belirlemeli?", "Fiyatı emsal ve değerleme mantığıyla düşünmeye yardım eder.", GG),
    // Invented URL — never in the search results → dropped.
    block("sale-delay", "İlan neden bekler?", "Bekleyen ilanın nedenlerini görmeye yardım eder.", "https://www.gayrimenkulgundemi.com/uydurma"),
    // Off-allowlist domain → dropped.
    block("sale-prep", "Satışa hazırlık rehberi", "Satış öncesi hazırlık adımlarını hatırlatır.", "https://example.com/x"),
    // Price claim → dropped.
    block("villa-land", "Villalar %20 değer kazandı", "Satış için doğru zaman olduğunu gösterir.", SP),
    // Old page (page_age 2025) → dropped, never relabelled as evergreen.
    block("regional", "Zekeriyaköy'de yol çalışmaları ve mülk sahipleri", "Bölgedeki çalışmaların mülkü nasıl etkilediğini düşündürür.", SP, "Tek Görsel"),
  ].join("\n");
  const response = {
    content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "q" } }, RESULTS, { type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 30000, output_tokens: 2500, server_tool_use: { web_search_requests: 3 } },
  };
  diagLines.length = 0;
  const result = await web.runOwnerWebSearch({
    profile,
    model: "claude-sonnet-5",
    getClient: stubClient(response, calls),
    env: { OWNER_WEB_SEARCH_ENABLED: "true" },
    now: NOW,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.maxRetries, 0, "a retry would bill twice");
  assert.ok(calls[0].options.timeout > 0);
  assert.equal(result.status, "ok");
  assert.deepEqual([...result.proposals.map((p) => p.themeId)], ["pricing"], "the 2025 page is dropped, not shown as evergreen");

  const pricing = result.proposals[0];
  assert.equal(pricing.kind, "current", "page_age within 30 days");
  assert.equal(pricing.sourceRole, "inspiration");
  assert.equal(pricing.source.url, GG);
  assert.equal(pricing.source.name, "gayrimenkulgundemi.com");
  assert.equal(pricing.source.publishedAt, new Date("November 10, 2026").toISOString(), "date from the result's page_age, not the model");
  assert.match(pricing.instruction, /metni, rakamları, tarihleri ve iddiaları aktarma/);
  assert.equal(pricing.opportunity, undefined, "inspiration drives the expert flow, never a fact-based opportunity");


  // 30000*2 + 2500*10 per MTok + 3 searches * $0.01 = 0.06 + 0.025 + 0.03
  assert.equal(result.costUsd, 0.115);
  const log = diagLines.find((line) => line.includes("owner-web-search"));
  assert.ok(log);
  assert.doesNotMatch(log, /gayrimenkulgundemi|sariyerposta|Zekeriyaköy|fiyat/i, "log carries counts and cost only");
});

test("other cities' decisions and institutional promotion never become proposals", () => {
  const results = [
    { url: GG, title: "Konya İli Meram İlçesinde imar planı değişikliği", pageAge: "November 12, 2026" },
    { url: SP, title: "BAKAN KURUM SARIYER'DE TÖRENE KATILDI", pageAge: "November 12, 2026" },
  ];
  const raw = [
    { theme: "regional", title: "Meram'daki plan değişikliği mülk sahiplerine ne söylüyor?", benefit: "Plan değişikliklerinin mülkü nasıl etkilediğini anlatır.", sourceUrl: GG, format: "Carousel" },
    { theme: "pricing", title: "Törenden mülk sahiplerine notlar", benefit: "Bölgedeki yatırımların mülk sahibine anlamını anlatır.", sourceUrl: SP, format: "Carousel" },
  ];
  assert.equal(web.toWebProposals(raw, results, profile, NOW).length, 0);
});

test("one proposal per theme and per URL; unknown themes and undated pages dropped", () => {
  const results = [{ url: GG, title: "t", pageAge: "November 15, 2026" }, { url: SP, title: "u", pageAge: "November 14, 2026" }];
  const raw = [
    { theme: "pricing", title: "Doğru fiyat için ilk adım", benefit: "Fiyatı neye göre düşüneceğini anlatır.", sourceUrl: GG, format: "" },
    { theme: "pricing", title: "Fiyat için ikinci öneri", benefit: "Aynı temada ikinci öneri olmaz.", sourceUrl: SP, format: "" },
    { theme: "sale-prep", title: "Aynı kaynaktan ikinci öneri", benefit: "Aynı URL ikinci kez kullanılmaz.", sourceUrl: GG, format: "" },
    { theme: "crm", title: "Bilinmeyen tema önerisi", benefit: "Tema listede yok, atılır.", sourceUrl: SP, format: "" },
  ];
  const proposals = web.toWebProposals(raw, results, profile, NOW);
  assert.deepEqual([...proposals.map((p) => p.themeId)], ["pricing"]);
  assert.equal(proposals[0].kind, "current");
  const undated = web.toWebProposals(raw.slice(0, 1), [{ url: GG, title: "t", pageAge: null }], profile, NOW);
  assert.equal(undated.length, 0, "an undated page is dropped, never relabelled as evergreen");
});

test("API failure or search errors: status error, no throw, no proposals", async () => {
  const failed = await web.runOwnerWebSearch({
    profile,
    model: "claude-sonnet-5",
    getClient: stubClient(Object.assign(new Error("boom"), { name: "APIError" })),
    env: { OWNER_WEB_SEARCH_ENABLED: "true" },
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.proposals.length, 0);

  const searchError = await web.runOwnerWebSearch({
    profile,
    model: "claude-sonnet-5",
    getClient: stubClient({
      content: [{ type: "web_search_tool_result", tool_use_id: "s", content: { type: "web_search_tool_result_error", error_code: "unavailable" } }, { type: "text", text: block("pricing", "Fiyat önerisi başlığı", "Fiyatı anlamaya yardım eder.", GG) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 100, server_tool_use: { web_search_requests: 0 } },
    }),
    env: { OWNER_WEB_SEARCH_ENABLED: "true" },
  });
  assert.equal(searchError.status, "ok");
  assert.equal(searchError.proposals.length, 0, "no verified result → nothing kept");
});

test("buildOwnerProposals: official Radar item first, then a web proposal, then the profile idea", () => {
  const webProposal = {
    themeId: "pricing",
    themeLabel: "Doğru fiyatlandırma",
    kind: "current",
    title: "Web önerisi",
    benefit: "b",
    format: "Carousel",
    source: { name: "gayrimenkulgundemi.com", url: GG },
    sourceRole: "inspiration",
    instruction: "talimat",
  };
  const merged = ownerProposals.buildOwnerProposals(profile, [], [webProposal], NOW);
  assert.equal(merged.find((p) => p.themeId === "pricing").title, "Web önerisi");
  assert.equal(merged.find((p) => p.themeId === "sale-prep").kind, "evergreen", "themes without a web proposal fall back to profile ideas");
  assert.equal(merged.length, 5);
});

test("estimateCostUsd: list prices incl. cache reads/writes and searches", () => {
  assert.equal(
    web.estimateCostUsd({ input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: 5 } }),
    2 + 1 + 0.2 + 0.05,
  );
});

test("/api/research/discover runs the web search in parallel with Radar and passes its proposals on", () => {
  const route = fs.readFileSync(path.join(projectRoot, "src/app/api/research/discover/route.ts"), "utf8");
  assert.match(route, /Promise\.all\(\[/);
  assert.match(route, /runOwnerWebSearch\(\{ profile: ATLAS_DEFAULT_BUSINESS_PROFILE, model: AI_MODEL, getClient: getAnthropicClient \}\)/);
  assert.match(route, /buildOwnerProposals\(ATLAS_DEFAULT_BUSINESS_PROFILE, opportunities, webSearch\.proposals, now\)/);
  assert.match(route, /collectOwnerFeedOpportunities\(ATLAS_DEFAULT_BUSINESS_PROFILE, searchWindow, now\)/);
});
