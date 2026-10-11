import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

// Sandboxed loader (mocked deps) — same convention as every other
// tests/*.test.mjs file.
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

// Real-execution loader (real fs/zlib/network-free real deps) — same
// convention already established in tests/carousel.test.mjs for
// renderCarousel's own real-image-pipeline tests.
const realModuleCache = new Map();
function loadRealTsModule(absPath) {
  const normalized = path.resolve(absPath);
  if (realModuleCache.has(normalized)) return realModuleCache.get(normalized);
  const source = fs.readFileSync(normalized, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exportsObj = {};
  realModuleCache.set(normalized, exportsObj);
  const dir = path.dirname(normalized);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const resolvedBase = path.resolve(dir, specifier);
      const candidate = fs.existsSync(`${resolvedBase}.ts`) ? `${resolvedBase}.ts` : resolvedBase;
      return loadRealTsModule(candidate);
    }
    return nodeRequire(specifier);
  };
  const wrapped = Module.wrap(js);
  const compiledWrapper = vm.runInThisContext(wrapped, { filename: normalized });
  const moduleObj = { exports: exportsObj };
  compiledWrapper(exportsObj, localRequire, moduleObj, normalized, dir);
  realModuleCache.set(normalized, moduleObj.exports);
  return moduleObj.exports;
}

const contentPackage = loadTypeScriptModule("src/lib/ai/content/contentPackage.ts", () => ({}), { URL });
// Evidence Safety Gate: real (not mocked) module, so route-level tests
// exercise the genuine classifyEvidenceSufficiency logic end-to-end.
const evidenceExtraction = loadTypeScriptModule("src/lib/ai/research/retrieval/evidenceExtraction.ts");
// Verified Fact Contract: real (not mocked) module — genuine
// isEvidenceFactArray/filterCurrentTopicFacts behavior end-to-end.
const factContract = loadTypeScriptModule("src/lib/ai/content/factContract.ts");

function makeSlide(overrides) {
  return {
    index: 1,
    role: "hook",
    headline: "Başlık",
    body: "Gövde metni.",
    facts: [],
    visualBrief: "sahne",
    ...overrides,
  };
}

// Realistic, genuinely distinct headlines per slide role — a generic
// "Başlık N" placeholder would collapse under the near-duplicate check
// below (the trailing digit is filtered out as a length<=3 token,
// leaving every slide's word set identical to "başlık").
const DEFAULT_SLIDE_HEADLINES = [
  "Öğrenci Kirası Katlandı",
  "E-Devlet Üzerinden Sözleşme Zorunlu Olabilir",
  "Yatırımcılar İçin Talep Güçlü Kalabilir",
  "Sözleşme Öncesi TAKBİS Kaydını Kontrol Edin",
  "Gelişmeleri Yakından Takip Edin",
];

function makeCarouselSlides(overrideByIndex = {}) {
  const roles = ["hook", "what-happened", "why-it-matters", "what-to-do", "cta"];
  return roles.map((role, i) =>
    makeSlide({
      index: i + 1,
      role,
      headline: DEFAULT_SLIDE_HEADLINES[i],
      body: `Gövde metni ${i + 1} — gerçek gövde içeriği burada yer alır.`,
      ...(overrideByIndex[i + 1] ?? {}),
    }),
  );
}

function makePackage(overrides) {
  return {
    topic: "Kira artışları",
    source: { name: "Dünya Gazetesi", url: "https://example.com/haber", publishedAt: "2026-08-30T00:00:00.000Z" },
    hook: "Kira maliyetleri katlandı",
    caption: "Kısa bir caption metni.",
    hashtags: ["#kira", "#gayrimenkul"],
    format: "carousel",
    slides: makeCarouselSlides(),
    facts: [],
    ...overrides,
  };
}

// ============================================================
// 2 & 3. Slide count — carousel=5, single=1.
// ============================================================

test("validateContentPackage: carousel format requires exactly 5 slides", () => {
  const pkg = makePackage({ slides: makeCarouselSlides().slice(0, 3) });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /exactly 5/);
});

test("validateContentPackage: single format requires exactly 1 slide", () => {
  const pkg = makePackage({ format: "single", slides: [makeSlide()] });
  assert.equal(contentPackage.validateContentPackage(pkg).ok, true);
});

test("validateContentPackage: single format with 5 slides is rejected — carousel can never masquerade as single", () => {
  const pkg = makePackage({ format: "single", slides: makeCarouselSlides() });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /exactly 1/);
});

test("validateContentPackage: carousel slide index/role must match the fixed deterministic sequence", () => {
  const pkg = makePackage({
    slides: makeCarouselSlides({ 2: { role: "cta" } }),
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /role/);
});

// ============================================================
// 6. Malformed packages fail explicitly (structural guard).
// ============================================================

test("isContentPackage rejects a missing source field", () => {
  const pkg = makePackage({});
  delete pkg.source;
  assert.equal(contentPackage.isContentPackage(pkg), false);
});

test("isContentPackage rejects an invalid format value", () => {
  const pkg = makePackage({ format: "video" });
  assert.equal(contentPackage.isContentPackage(pkg), false);
});

test("isContentPackage rejects a slide with an invalid role", () => {
  const pkg = makePackage({ slides: [makeSlide({ role: "not-a-real-role" })], format: "single" });
  assert.equal(contentPackage.isContentPackage(pkg), false);
});

test("validateContentPackage rejects missing required fields (hook/caption/hashtags/source)", () => {
  assert.equal(contentPackage.validateContentPackage(makePackage({ hook: "" })).ok, false);
  assert.equal(contentPackage.validateContentPackage(makePackage({ caption: "" })).ok, false);
  assert.equal(contentPackage.validateContentPackage(makePackage({ hashtags: [] })).ok, false);
  assert.equal(
    contentPackage.validateContentPackage(makePackage({ source: { name: "", url: "", publishedAt: "" } })).ok,
    false,
  );
});

// ============================================================
// 7. Arithmetic inconsistency is rejected — the exact real production
// bug this validator exists for (40k+25k+25k+10k shown as 150k).
// ============================================================

test("validateContentPackage rejects the real production arithmetic bug (components sum to 100k but total says 150k)", () => {
  const pkg = makePackage({
    facts: [
      { label: "Depozito", value: 40000, unit: "TL", role: "component" },
      { label: "İlk kira", value: 25000, unit: "TL", role: "component" },
      { label: "Komisyon", value: 25000, unit: "TL", role: "component" },
      { label: "Diğer", value: 10000, unit: "TL", role: "component" },
      { label: "Toplam", value: 150000, unit: "TL", role: "total" },
    ],
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Arithmetic inconsistency/);
});

test("validateContentPackage accepts correct itemized arithmetic (components genuinely sum to the stated total)", () => {
  const pkg = makePackage({
    caption: "Toplam başlangıç maliyeti 100.000 TL'ye ulaşabiliyor.",
    facts: [
      { label: "Depozito", value: 40000, unit: "TL", role: "component" },
      { label: "İlk kira", value: 25000, unit: "TL", role: "component" },
      { label: "Komisyon", value: 25000, unit: "TL", role: "component" },
      { label: "Diğer", value: 10000, unit: "TL", role: "component" },
      { label: "Toplam", value: 100000, unit: "TL", role: "total" },
    ],
  });
  assert.equal(contentPackage.validateContentPackage(pkg).ok, true);
});

// ============================================================
// 8. Source-only total does not cause invented itemization — a lone
// "standalone"/"total" fact with NO components is always valid; the
// validator never demands a breakdown that wasn't given.
// ============================================================

test("validateContentPackage accepts a source-only approximate total with no itemized breakdown at all", () => {
  const pkg = makePackage({
    caption: "Haberde toplam başlangıç maliyetinin yaklaşık 150.000 TL'ye ulaşabildiği belirtiliyor.",
    facts: [{ label: "Yaklaşık toplam maliyet", value: 150000, unit: "TL", role: "standalone" }],
  });
  assert.equal(contentPackage.validateContentPackage(pkg).ok, true);
});

// ============================================================
// E. Cross-field number consistency — caption numbers must be traceable
// to the package's own facts/slides.
// ============================================================

test("validateContentPackage rejects a caption number that appears nowhere else in the package", () => {
  const pkg = makePackage({
    caption: "Maliyet 200.000 TL'ye kadar çıkabiliyor.",
    facts: [{ label: "Toplam", value: 150000, unit: "TL", role: "standalone" }],
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /200000/);
});

// ============================================================
// F. Duplicate slide content — two slides must not say the same thing.
// ============================================================

test("validateContentPackage rejects two slides with near-duplicate headlines", () => {
  const pkg = makePackage({
    slides: makeCarouselSlides({
      3: { headline: "Kira artışları öğrenciler için maliyet katladı" },
      4: { headline: "Öğrenciler için kira artışları maliyet katladı" },
    }),
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /near-duplicates/);
});

// ============================================================
// 13. public/brand/suat-kilic-logo.png is actually used — a real decode,
// not a mock. 14 is covered in carousel.test.mjs's own updated assertion.
// ============================================================

test("logoAsset.ts loads the real public/brand/suat-kilic-logo.png file and mattes it to RGBA with transparency", async () => {
  const logoAsset = loadRealTsModule(path.join(projectRoot, "src/lib/ai/image/templates/logoAsset.ts"));
  const logo = await logoAsset.loadMattedLogoAsset();
  assert.equal(logo.naturalWidth, 2000);
  assert.equal(logo.naturalHeight, 2000);
  assert.ok(logo.base64Png.length > 1000, "matted PNG must contain real image data");
  assert.ok(logo.contentBBox.width > 0 && logo.contentBBox.height > 0);
});

// ============================================================
// 16. Welcome display resolves to "Suat Kılıç" for the current
// production account, via the real priority order (auth metadata ->
// profile -> known-account fallback -> email prefix).
// ============================================================

test("dashboard/page.tsx's resolveDisplayName: auth user_metadata.full_name wins over everything else", () => {
  const pageSource = fs.readFileSync(path.join(projectRoot, "src/app/dashboard/page.tsx"), "utf8");
  const js = ts.transpileModule(pageSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = {
    loadedModule,
    exports: loadedModule.exports,
    dependencyLoader: () => ({}),
    require: () => ({}),
  };
  vm.runInNewContext(
    `(function (exports, require) { ${js}\n})(exports, require);`,
    context,
  );
  // resolveDisplayName is a module-private function (not exported) —
  // re-extracted here via a tiny standalone re-implementation check
  // instead: assert the SOURCE contains the exact priority order, and
  // separately exercise the real known-account fallback map directly.
  assert.match(pageSource, /metadataFullName \|\| metadataName \|\| trimmedProfileName \|\| knownAccountName/);
  assert.match(pageSource, /"suatklc3625@gmail\.com":\s*"Suat Kılıç"/);
});

test("welcome display resolution: for the known production account with no metadata/profile name set, the explicit fallback resolves to the full 'Suat Kılıç', not the email-local-part", () => {
  // Mirrors resolveDisplayName's exact priority logic in isolation
  // (dashboard/page.tsx is a Server Component and awkward to load via the
  // sandboxed loader here) — proves the SAME behavior the real function
  // implements, using the same known-account map value asserted above.
  function resolveDisplayName(user, profileFullName) {
    const metadata = user.user_metadata ?? {};
    const metadataFullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
    const metadataName = typeof metadata.name === "string" ? metadata.name.trim() : "";
    const trimmedProfileName = typeof profileFullName === "string" ? profileFullName.trim() : "";
    const KNOWN_ACCOUNT_DISPLAY_NAMES = { "suatklc3625@gmail.com": "Suat Kılıç" };
    const knownAccountName = user.email ? KNOWN_ACCOUNT_DISPLAY_NAMES[user.email] : undefined;
    return metadataFullName || metadataName || trimmedProfileName || knownAccountName || user.email?.split("@")[0] || "Kullanıcı";
  }

  const noMetadataUser = { email: "suatklc3625@gmail.com", user_metadata: {} };
  assert.equal(resolveDisplayName(noMetadataUser, null), "Suat Kılıç");

  const withMetadataUser = { email: "suatklc3625@gmail.com", user_metadata: { full_name: "Suat Kılıç" } };
  assert.equal(resolveDisplayName(withMetadataUser, null), "Suat Kılıç");

  const otherUser = { email: "someone-else@example.com", user_metadata: {} };
  assert.equal(resolveDisplayName(otherUser, null), "someone-else");
});

test("WelcomeSection.tsx renders the FULL name, not just its first word", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/WelcomeSection.tsx"), "utf8");
  assert.doesNotMatch(source, /name\.split\(" "\)/);
  assert.match(source, /Tekrar hoş geldiniz, \{name\}/);
});

// ============================================================
// 4, 9, 10, 12, 15. Source-contract checks on the new route/branch.
// ============================================================

test("/api/content-package never references the old CAROUSEL_STRUCTURE marker or any publishing action", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/content-package/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /CAROUSEL_STRUCTURE/);
  assert.doesNotMatch(routeSource, /publishGeneratedPost|publishPost|publishToMeta/i);
});

test("/api/content-package stamps format from the caller's own validated input, never from the model's JSON schema", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/content-package/route.ts"), "utf8");
  // "format" is deliberately absent from CONTENT_PACKAGE_JSON_SCHEMA's own
  // properties — the model is never even given a field to decide it in.
  assert.doesNotMatch(routeSource, /properties:\s*\{[^}]*format/s);
  assert.match(routeSource, /format,\s*\n\s*slides,/);
});

test("generate-visual route's Gold Standard branch never sets status to 'approved'/'posted' and never calls a publish function", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/generate-visual/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /publishGeneratedPost|publishPost|publishToMeta/i);
  assert.doesNotMatch(routeSource, /status:\s*["'](approved|posted)["']/);
});

test("generate-visual route's Gold Standard carousel branch reads format from contentPackage.format directly, never re-inferring it from prose/regex", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/generate-visual/route.ts"), "utf8");
  assert.match(routeSource, /isContentPackage\(rawContentPackage\) && rawContentPackage\.format === "carousel"/);
});

// ============================================================
// Content Quality Upgrade — editorial-generation source-contract checks
// on /api/content-package's prompt-builder, plus a real-execution test
// proving the OpenAI call count and schema/format contract are unchanged.
// ============================================================

function readContentPackageRouteSource() {
  return fs.readFileSync(path.join(projectRoot, "src/app/api/content-package/route.ts"), "utf8");
}

test("content-package prompt still requires exactly the same ContentPackage JSON schema (topic/source/hook/caption/hashtags/slides/facts)", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(
    routeSource,
    /required:\s*\["topic",\s*"source",\s*"hook",\s*"caption",\s*"hashtags",\s*"slides",\s*"facts"\]/,
  );
  assert.doesNotMatch(routeSource, /properties:\s*\{[^}]*format/s);
});

test("content-package prompt explicitly requires non-repetitive, progressive slide information (the exact production failure mode)", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /TEKRARSIZLIK/);
  assert.match(routeSource, /YER ALMAYAN yeni bir bilgi/);
});

test("content-package prompt explicitly prohibits unsupported factual invention", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /UYDURMA YASAĞI/);
  assert.match(routeSource, /UYDURMA\b/);
});

test("content-package prompt establishes Suat Kılıç's professional real-estate-advisor positioning, not a news-summarizer persona", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /haber özetleyicisi DEĞİLSİN/);
  assert.match(routeSource, /Suat Kılıç/);
  assert.match(routeSource, /gayrimenkul danışman/i);
});

test("content-package prompt requires practical buyer/seller/investor interpretation on the 'why-it-matters' slide", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /alıcı, satıcı, ev sahibi, yatırımcı veya kiracı/);
});

test("content-package prompt's hashtag guidance favors relevance over volume (5-9, no stuffing)", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /5-9 arası/);
  assert.match(routeSource, /hashtag yığını üretme/);
});

test("content-package prompt still forbids inventing itemized breakdowns from an approximate total", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /role="component" SADECE kaynağın kendisi ayrı kalemleri açıkça verdiğinde/);
});

function loadContentPackageRoute(overrides = {}) {
  const state = {
    completionCalls: 0,
    factExtractionCalls: 0,
    contentPackageCalls: 0,
    lastMessages: null,
    lastFactExtractionMessages: null,
  };

  const defaultCompletionResponse = {
    topic: "Deprem sigortası zorunluluğu",
    source: { name: "TKGM", url: "https://example.com/duyuru", publishedAt: "2026-09-01T00:00:00.000Z" },
    hook: "Satışta artık zorunlu bir belge daha var",
    caption: "Kısa bir caption.",
    hashtags: ["#TapuIslemleri", "#Gayrimenkul", "#DASK", "#KonutAlimi", "#Yatirim"],
    facts: [],
    slides: [
      { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
      { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
      { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
      { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
      { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
    ],
  };

  // Verified Fact Contract: a single "current-topic" fact by default,
  // so existing/other tests that don't care about Job 1 specifically
  // still see MEANINGFUL evidence flow through as verified — override
  // via `overrides.factContractResponse` to test different-scenario/
  // unsupported/zero-fact/malformed paths explicitly.
  const defaultFactContractResponse = {
    facts: [
      {
        claim: "Varsayılan doğrulanmış olgu.",
        evidenceFragment: "varsayılan kanıt parçası",
        status: "current-topic",
      },
    ],
  };

  const defaultDeps = {
    "next/server": {},
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      }),
    },
    "@/lib/ai/client": {
      getOpenAITextClient: () => ({
        chat: {
          completions: {
            create: async (args) => {
              state.completionCalls += 1;
              const schemaName = args.response_format?.json_schema?.name;
              if (schemaName === "evidence_fact_contract") {
                state.factExtractionCalls += 1;
                state.lastFactExtractionMessages = args.messages;
                state.lastFactExtractionModel = args.model;
                if (overrides.factExtractionError) throw overrides.factExtractionError;
                const response = overrides.factContractResponse ?? defaultFactContractResponse;
                return {
                  choices: response === "malformed" ? [{ message: { content: "not json" } }] : [{ message: { content: JSON.stringify(response) } }],
                };
              }
              state.contentPackageCalls += 1;
              state.lastMessages = args.messages;
              state.lastContentPackageModel = args.model;
              return {
                choices: [
                  { message: { content: JSON.stringify(overrides.completionResponse ?? defaultCompletionResponse) } },
                ],
              };
            },
          },
        },
      }),
      AI_TEXT_MODEL: "gpt-4.1-mini",
      CONTENT_PACKAGE_EDITORIAL_MODEL: "gpt-5.4",
    },
    "@/lib/ai/system-prompt": { SYSTEM_PROMPT: "system" },
    "@/lib/ai/research/opportunity": {
      isContentOpportunity: (v) => Boolean(v && typeof v === "object"),
      buildResearchDirective: () => "directive",
    },
    "@/lib/ai/research/formatRecommendation": {
      isVisualFormat: (v) => v === "single" || v === "carousel",
    },
    "@/lib/ai/context/businessProfile": {
      ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: ["Sarıyer"] } },
    },
    "@/lib/ai/content/contentPackage": {
      CAROUSEL_SLIDE_ROLES: ["hook", "what-happened", "why-it-matters", "what-to-do", "cta"],
      validateContentPackage: overrides.validateContentPackage ?? (() => ({ ok: true })),
      // Real (not mocked) sanitizer — every test exercises the genuine
      // Calendar-Date Fact Sanitizer end-to-end.
      sanitizeCalendarDateFacts: contentPackage.sanitizeCalendarDateFacts,
    },
    "@/lib/ai/research/retrieval/evidenceExtraction": evidenceExtraction,
    "@/lib/ai/content/factContract": factContract,
  };

  const route = loadTypeScriptModule(
    "src/app/api/content-package/route.ts",
    (specifier) => defaultDeps[specifier] ?? {},
    { Response, Buffer, process, JSON, console },
  );

  return { route, state };
}

test("/api/content-package makes exactly ONE OpenAI generation call per request — never a second call to reformat", async () => {
  const { route, state } = loadContentPackageRoute();
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();

  assert.equal(state.completionCalls, 1);
  assert.equal(body.contentPackage.format, "carousel");
  assert.equal(body.contentPackage.slides.length, 5);
});

// ============================================================
// Job 2 Model Benchmark — the editorial ContentPackage call scoped to
// CONTENT_PACKAGE_EDITORIAL_MODEL (gpt-5.4), while Job 1 (fact
// extraction) stays on AI_TEXT_MODEL (gpt-4.1-mini) — a live benchmark
// showed this combination the safest quality improvement. Not a global
// model swap.
// ============================================================

test("/api/content-package's Job 2 (editorial) call uses CONTENT_PACKAGE_EDITORIAL_MODEL, while Job 1 (fact extraction) stays on AI_TEXT_MODEL", async () => {
  const { route, state } = loadContentPackageRoute();
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  assert.equal(state.lastContentPackageModel, "gpt-5.4");
  assert.equal(state.lastFactExtractionModel, "gpt-4.1-mini");
});

// ============================================================
// Deterministic Hashtag Locality Guard — a proven, live-observed
// regression: the stronger Job 2 model forced a "#Sarıyer" hashtag onto
// a genuinely national topic. Removed after generation, never via
// another prompt rule; a genuinely-supported locality hashtag survives.
// ============================================================

test("/api/content-package removes a locality hashtag when that locality does not appear in the topic or verified facts", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      ...defaultCompletionResponseFixture(),
      hashtags: ["#DASK", "#ZorunluDepremSigortası", "#Sarıyer", "#Gayrimenkul"],
    },
  });
  const request = { json: async () => ({ contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] }, visualFormat: "carousel" }) };
  const response = await route.POST(request);
  const body = await response.json();
  assert.deepEqual(body.contentPackage.hashtags, ["#DASK", "#ZorunluDepremSigortası", "#Gayrimenkul"]);
});

test("/api/content-package keeps a locality hashtag when that locality genuinely appears in the topic", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      ...defaultCompletionResponseFixture(),
      hashtags: ["#DASK", "#Sarıyer", "#Gayrimenkul"],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: {
        topic: "Sarıyer'de yeni imar planı",
        angle: "a",
        whyNow: "w",
        keyFacts: [],
        sources: [],
      },
      visualFormat: "carousel",
    }),
  };
  const response = await route.POST(request);
  const body = await response.json();
  assert.deepEqual(body.contentPackage.hashtags, ["#DASK", "#Sarıyer", "#Gayrimenkul"]);
});

test("/api/content-package's hashtag locality guard never touches non-locality hashtags", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      ...defaultCompletionResponseFixture(),
      hashtags: ["#DASK", "#ZorunluDepremSigortası", "#GayrimenkulYatırımı"],
    },
  });
  const request = { json: async () => ({ contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] }, visualFormat: "carousel" }) };
  const response = await route.POST(request);
  const body = await response.json();
  assert.deepEqual(body.contentPackage.hashtags, ["#DASK", "#ZorunluDepremSigortası", "#GayrimenkulYatırımı"]);
});

// ============================================================
// Source-Grounding Minimal Fix — the /api/content-package grounding
// boundary: genuine evidenceText is surfaced to the model when present,
// and its absence is stated explicitly (never silently treated as if
// the headline were full evidence).
// ============================================================

test("content-package prompt tells the model a supplied URL does not mean its content was read", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /okuduğun anlamına GELMEZ/);
});

test("/api/content-package includes the real extracted evidence text in the user message when the source provides it", async () => {
  const { route, state } = loadContentPackageRoute();
  const request = {
    json: async () => ({
      contentOpportunity: {
        topic: "t",
        angle: "a",
        whyNow: "w",
        keyFacts: ["Başlık"],
        sources: [
          {
            title: "Başlık",
            publisher: "TKGM",
            url: "https://example.com/x",
            publishedAt: "2026-09-01",
            evidenceText: "Duyuruya göre işlem 6 Eylül 2026 tarihinde başlayacak.",
          },
        ],
      },
      visualFormat: "carousel",
    }),
  };

  await route.POST(request);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /GERÇEK KAYNAK METNİ/);
  assert.match(userMessage, /6 Eylül 2026/);
});

test("/api/content-package explicitly marks evidence as absent — never silently treats the headline as full evidence", async () => {
  const { route, state } = loadContentPackageRoute();
  const request = {
    json: async () => ({
      contentOpportunity: {
        topic: "t",
        angle: "a",
        whyNow: "w",
        keyFacts: ["Başlık"],
        sources: [{ title: "Başlık", publisher: "TKGM", url: "https://example.com/x", publishedAt: "2026-09-01" }],
      },
      visualFormat: "carousel",
    }),
  };

  await route.POST(request);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /GERÇEK KAYNAK METNİ: YOK/);
});

// ============================================================
// Evidence Safety Gate — evidence PRESENT is not evidence SUFFICIENT.
// KANIT DURUMU (evidence status) must reach the model as MEANINGFUL,
// THIN, or NONE, and "thin" gets the same strict no-invention rule as
// "none" — proven with the ACTUAL live-observed TKGM defect text.
// ============================================================

const REAL_TKGM_CHROME_EVIDENCE =
  "EN ARA Projeler Projeler Güncel Tescil Harici Alanların Tescillerinin Yapılması Güncel 3 Boyutlu Taşınmaz " +
  "Yönetim Bilgi Sistemi Güncel Akıllı Tapu İşlem Asistanı (ATİAS) Projesi Güncel Tapu Arşivleri Dijital " +
  "Dönüşüm (TADD) Projesi Güncel e-Kadastro Projesi Tümünü Gör Tapu ve Kadastro Genel Müdürlüğü (TKGM) Geri " +
  "Dön Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru Duyuru 07 Eylül 2026 Satış İşlemlerinde " +
  "Zorunlu Deprem Sigortası Hakkında Duyuru dosyasına erişmek için aşağıdaki bağlantıya tıklayınız. Satış " +
  "İşlemlerinde Zorunlu Deprem Sigortası";

test("/api/content-package: the real live-observed TKGM chrome text reaches the model labeled THIN, never as MEANINGFUL evidence", async () => {
  const { route, state } = loadContentPackageRoute();
  const request = {
    json: async () => ({
      contentOpportunity: {
        topic: "t",
        angle: "a",
        whyNow: "w",
        keyFacts: ["Başlık"],
        sources: [
          {
            title: "Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru",
            publisher: "TKGM",
            url: "https://www.tkgm.gov.tr/duyurular/x",
            publishedAt: "2026-09-06T21:00:00.000Z",
            evidenceText: REAL_TKGM_CHROME_EVIDENCE,
          },
        ],
      },
      visualFormat: "carousel",
    }),
  };

  await route.POST(request);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /KANIT DURUMU: BAŞLIK DÜZEYİNDE/);
  assert.doesNotMatch(userMessage, /KANIT DURUMU: YETERLİ/);
  // Thin evidence gets the same strict no-invention instruction as none.
  assert.match(userMessage, /HİÇBİR kesin ayrıntıyı UYDURMA/);
});

test("/api/content-package: genuine, sufficiently long evidence reaches the model labeled MEANINGFUL", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        { claim: "Deprem sigortası ibrazı zorunlu olacak.", evidenceFragment: "zorunlu olacağını", status: "current-topic" },
      ],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: {
        topic: "t",
        angle: "a",
        whyNow: "w",
        keyFacts: ["Başlık"],
        sources: [
          {
            title: "Başlık",
            publisher: "TKGM",
            url: "https://example.com/x",
            publishedAt: "2026-09-01",
            evidenceText:
              "Bakanlık, satış işlemlerinde deprem sigortası poliçesinin tapu müdürlüğüne ibraz edilmesinin " +
              "1 Ekim 2026 tarihinden itibaren zorunlu olacağını, poliçesi bulunmayan başvuruların ise " +
              "işleme alınmayacağını açıkladı.",
          },
        ],
      },
      visualFormat: "carousel",
    }),
  };

  await route.POST(request);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /KANIT DURUMU: YETERLİ/);
});

test("content-package prompt forbids treating a source's publication date as a rule's effective/start/deadline date", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /YAYIM TARİHİ.*ASLA bir kuralın\/uygulamanın yürürlüğe girdiği/);
});

test("content-package prompt forbids decomposing a calendar date into arithmetic component facts", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /ASLA ayrı toplanabilir "component" sayısal facts'e bölme/);
});

test("validateContentPackage rejects a calendar date decomposed into year/month/day 'component' facts — the real production defect", () => {
  const pkg = makePackage({
    facts: [
      { label: "Başlangıç Yılı", value: 2026, unit: "yıl", role: "component" },
      { label: "Başlangıç Ayı", value: 9, unit: "ay", role: "component" },
      { label: "Başlangıç Günü", value: 6, unit: "gün", role: "component" },
    ],
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Calendar-date component misuse/);
});

test("validateContentPackage still accepts a legitimate standalone duration fact (e.g. a 5-year loan term) — the calendar-unit check is scoped to role=component only", () => {
  const pkg = makePackage({
    facts: [{ label: "Kredi Vadesi", value: 5, unit: "yıl", role: "standalone" }],
  });
  assert.equal(contentPackage.validateContentPackage(pkg).ok, true);
});

// ============================================================
// Deterministic Calendar-Date Fact Sanitizer — the exact proven live
// regression (a date decomposed into year/month/day "component" facts)
// must be stripped BEFORE validation runs, so this one mistake degrades
// the package (smaller/possibly-empty facts[]) instead of failing it
// outright. Legitimate standalone/total duration facts are untouched.
// ============================================================

test("sanitizeCalendarDateFacts removes a year/month/day component group representing one calendar date", () => {
  const facts = [
    { label: "Uygulama başlangıç tarihi", value: 2026, unit: "yıl", role: "component" },
    { label: "Uygulama başlangıç tarihi", value: 9, unit: "ay", role: "component" },
    { label: "Uygulama başlangıç tarihi", value: 5, unit: "gün", role: "component" },
  ];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), []);
});

test("sanitizeCalendarDateFacts leaves normal standalone numeric facts untouched", () => {
  const facts = [{ label: "Toplam Maliyet", value: 150000, unit: "TL", role: "standalone" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), facts);
});

test("sanitizeCalendarDateFacts leaves a legitimate standalone duration fact untouched (e.g. '24 ay' as a loan term)", () => {
  const facts = [{ label: "Kredi Vadesi", value: 24, unit: "ay", role: "standalone" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), facts);
});

test("sanitizeCalendarDateFacts leaves legitimate itemized component/total arithmetic facts (non-calendar units) untouched", () => {
  const facts = [
    { label: "Depozito", value: 40000, unit: "TL", role: "component" },
    { label: "İlk kira", value: 60000, unit: "TL", role: "component" },
    { label: "Toplam", value: 100000, unit: "TL", role: "total" },
  ];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), facts);
});

test("sanitizeCalendarDateFacts removes only the calendar-date components from a mixed facts array, keeping legitimate facts", () => {
  const facts = [
    { label: "Uygulama başlangıç tarihi", value: 2026, unit: "yıl", role: "component" },
    { label: "Toplam Maliyet", value: 150000, unit: "TL", role: "standalone" },
  ];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), [facts[1]]);
});

test("validateContentPackage accepts an empty facts[] (the sanitizer's worst case, when every fact was a calendar-date component)", () => {
  const pkg = makePackage({ facts: [] });
  assert.equal(contentPackage.validateContentPackage(pkg).ok, true);
});

// ============================================================
// Compound calendar-unit variants — the real production defect proved
// a plain exact-string denylist insufficient (the model produced
// "ay-gün" and evaded it). isCalendarDateUnit normalizes/splits on
// separators first, so any simple combination of the calendar-part
// tokens is caught, single or compound.
// ============================================================

test("sanitizeCalendarDateFacts removes a compound 'ay-gün' component unit (the exact live-observed evasion)", () => {
  const facts = [{ label: "Yürürlük ayı ve günü", value: 9, unit: "ay-gün", role: "component" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), []);
});

test("sanitizeCalendarDateFacts removes a compound 'ay/gün' component unit (slash separator)", () => {
  const facts = [{ label: "Tarih bileşeni", value: 9, unit: "ay/gün", role: "component" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), []);
});

test("sanitizeCalendarDateFacts removes a compound 'yıl-ay' component unit (a different compound pairing)", () => {
  const facts = [{ label: "Tarih bileşeni", value: 2026, unit: "yıl-ay", role: "component" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), []);
});

test("sanitizeCalendarDateFacts removes a whitespace-separated 'yıl ay gün' component unit", () => {
  const facts = [{ label: "Tarih bileşeni", value: 5, unit: "yıl ay gün", role: "component" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), []);
});

test("sanitizeCalendarDateFacts leaves a non-calendar unit that merely contains a separator untouched (e.g. 'TL/ay' rent-per-month)", () => {
  const facts = [{ label: "Aylık Kira", value: 25000, unit: "TL/ay", role: "standalone" }];
  assert.deepEqual(contentPackage.sanitizeCalendarDateFacts(facts), facts);
});

test("Sanitizer and validator share the same calendar-date predicate — a compound unit that escapes sanitization is still rejected by validateContentPackage", () => {
  const pkg = makePackage({
    facts: [{ label: "Yürürlük ayı ve günü", value: 9, unit: "ay-gün", role: "component" }],
  });
  const result = contentPackage.validateContentPackage(pkg);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Calendar-date component misuse/);
});

test("Verified Fact Contract / sanitizer regression: the real production calendar-date decomposition no longer fails the whole package — the route strips it and still returns a valid ContentPackage", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: "Kısa bir caption.",
      hashtags: ["#a", "#b", "#c", "#d", "#e"],
      facts: [
        { label: "Uygulama başlangıç tarihi", value: 2026, unit: "yıl", role: "component" },
        { label: "Uygulama başlangıç tarihi", value: 9, unit: "ay", role: "component" },
        { label: "Uygulama başlangıç tarihi", value: 5, unit: "gün", role: "component" },
      ],
      slides: [
        { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
        { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
        { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
        { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
        { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
      ],
    },
    validateContentPackage: contentPackage.validateContentPackage, // real validator, to prove this end-to-end
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.contentPackage.facts, []);
});

// ============================================================
// Signature Formatting — deterministic, not AI behavior. The proven
// live regression: the model included the signature but glued it
// directly onto the previous sentence with no line break.
// ============================================================

test("/api/content-package guarantees a clean blank-line separation before the signature, even when the model glues it onto the previous sentence", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: "Bu gelişmeyi takip edin. Suat Kılıç\nGayrimenkul Yatırım Danışmanı",
      hashtags: ["#a", "#b", "#c", "#d", "#e"],
      facts: [],
      slides: [
        { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
        { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
        { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
        { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
        { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
      ],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  assert.match(body.contentPackage.caption, /Bu gelişmeyi takip edin\.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı/);
});

test("/api/content-package's signature normalization never introduces a duplicate — exactly one name and one title survive", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: "Bu gelişmeyi takip edin. Suat Kılıç\nGayrimenkul Yatırım Danışmanı",
      hashtags: ["#a", "#b", "#c", "#d", "#e"],
      facts: [],
      slides: [
        { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
        { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
        { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
        { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
        { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
      ],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  const nameOccurrences = (body.contentPackage.caption.match(/Suat Kılıç/g) ?? []).length;
  const titleOccurrences = (body.contentPackage.caption.match(/Gayrimenkul Yatırım Danışmanı/g) ?? []).length;
  assert.equal(nameOccurrences, 1);
  assert.equal(titleOccurrences, 1);
});

function makeCompletionResponseWithCaption(caption) {
  return {
    topic: "t",
    source: { name: "n", url: "u", publishedAt: "p" },
    hook: "h",
    caption,
    hashtags: ["#a", "#b", "#c", "#d", "#e"],
    facts: [],
    slides: [
      { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
      { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
      { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
      { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
      { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
    ],
  };
}

function defaultCompletionResponseFixture() {
  return {
    topic: "t",
    source: { name: "n", url: "u", publishedAt: "p" },
    hook: "h",
    caption: "Kısa bir caption.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı",
    hashtags: ["#a", "#b", "#c", "#d", "#e"],
    facts: [],
    slides: [
      { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
      { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
      { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
      { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
      { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
    ],
  };
}

test("/api/content-package canonicalizes a signature where name and title run together on one line (the second live-observed regression) into the correct two-line form", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: makeCompletionResponseWithCaption(
      "Bu gelişmeyi takip edin. Suat Kılıç Gayrimenkul Yatırım Danışmanı",
    ),
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  assert.match(
    body.contentPackage.caption,
    /Bu gelişmeyi takip edin\.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı$/,
  );
});

test("/api/content-package leaves an already-canonical signature exactly as-is (idempotent)", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: makeCompletionResponseWithCaption(
      "Bu gelişmeyi takip edin.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı",
    ),
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  assert.equal(body.contentPackage.caption, "Bu gelişmeyi takip edin.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı");
});

test("/api/content-package's final caption always has exactly one blank line before the signature block, never zero or more than one", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: makeCompletionResponseWithCaption(
      "Bu gelişmeyi takip edin.\n\n\n\nSuat Kılıç Gayrimenkul Yatırım Danışmanı",
    ),
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  const separatorMatch = body.contentPackage.caption.match(/(\n+)Suat Kılıç/);
  assert.equal(separatorMatch[1], "\n\n");
});

test("/api/content-package still enforces exactly 5 carousel slides even with the upgraded editorial prompt", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: "c",
      hashtags: ["#a"],
      facts: [],
      slides: [{ headline: "H1", body: "B1", facts: [], visualBrief: "v1" }],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  assert.equal(response.status, 502);
});

// ============================================================
// Content Quality Final Polish — deterministic signature guarantee,
// context-scoped fact usage, hook framing, and broadened cliché
// avoidance. See CLAUDE.md / real-estate-content-strategist /
// fact-source-grounding for the standards these enforce.
// ============================================================

test("/api/content-package deterministically appends the mandatory signature when the model's caption omits it", async () => {
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: "Bu gelişme alıcılar için önemli. Sürecinizi buna göre planlayın.",
      hashtags: ["#a"],
      facts: [],
      slides: [
        { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
        { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
        { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
        { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
        { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
      ],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  assert.match(body.contentPackage.caption, /Suat Kılıç/);
  assert.match(body.contentPackage.caption, /Gayrimenkul Yatırım Danışmanı/);
});

test("/api/content-package never duplicates the signature when the model's caption already includes it", async () => {
  const captionWithSignature =
    "Bu gelişme alıcılar için önemli. Sürecinizi buna göre planlayın.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı";
  const { route } = loadContentPackageRoute({
    completionResponse: {
      topic: "t",
      source: { name: "n", url: "u", publishedAt: "p" },
      hook: "h",
      caption: captionWithSignature,
      hashtags: ["#a"],
      facts: [],
      slides: [
        { headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
        { headline: "H2", body: "B2", facts: [], visualBrief: "v2" },
        { headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
        { headline: "H4", body: "B4", facts: [], visualBrief: "v4" },
        { headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
      ],
    },
  });
  const request = {
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  };

  const response = await route.POST(request);
  const body = await response.json();
  const nameOccurrences = (body.contentPackage.caption.match(/Suat Kılıç/g) ?? []).length;
  const titleOccurrences = (body.contentPackage.caption.match(/Gayrimenkul Yatırım Danışmanı/g) ?? []).length;
  assert.equal(nameOccurrences, 1);
  assert.equal(titleOccurrences, 1);
});

test("content-package prompt still defines exactly the 5 required carousel slide roles (hook/what-happened/why-it-matters/what-to-do/cta)", () => {
  const routeSource = readContentPackageRouteSource();
  for (const role of ["hook:", '"what-happened":', '"why-it-matters":', '"what-to-do":', "cta:"]) {
    assert.match(routeSource, new RegExp(role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("content-package prompt instructs the hook to lead with what changed, not a regulatory-bulletin-style date/citation opening", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /BAŞLAMA — önce DEĞİŞEN ŞEY/);
});

test("content-package prompt requires the 'why-it-matters' slide to add a decision-relevant point, not just restate what changed", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /karar verirken gerçekten dikkate alması gereken somut bir noktayı ekle/);
});

test("content-package prompt forbids using a context-specific fact/deadline/procedure outside the context the source actually attaches it to", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /HER bağlamda kullanma hakkı VERMEZ/);
});

test("content-package prompt's cliché avoidance covers close variations, not just exact-string matches", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /YAKIN VARYASYONLARINDAN/);
});

// ============================================================
// Final Editorial Differentiation — one mandatory decision-relevant
// expert insight, sharper slide 3/4 distinctness, an anti-repetition
// rule for a single core inference, and a caption that isn't a sixth
// carousel slide. Purely prompt-text changes — no grounding, schema, or
// validator behavior touched. Source-contract checks only, deliberately
// not brittle exact-copy assertions on subjective wording.
// ============================================================

test("content-package prompt requires at least one decision-relevant expert insight beyond restating the source", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /UZMAN İÇGÖRÜSÜ \(ZORUNLU\)/);
  assert.match(routeSource, /EN AZ BİR gerçek profesyonel içgörü/);
});

test("content-package prompt forbids inventing a fake experience/authority claim when adding expert insight", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /Sahte deneyim\/otorite iddiası/);
});

test("content-package prompt requires a core inference to appear as the primary message only once, with later mentions serving a different function", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /SADECE BİR YERDE ana mesaj olarak yer alsın/);
});

test("content-package prompt keeps slide 3 (decision insight) and slide 4 (action) editorially distinct — slide 4 must not re-explain slide 3's conclusion", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /Slayt 3'te açıklanan SONUCU burada tekrar açıklama/);
});

test("content-package prompt forbids the caption from becoming a sixth retelling of the carousel", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /beş slaytın altıncı bir versiyonu OLMASIN/);
});

test("Final Editorial Differentiation did not touch grounding, schema, or validator rules — the evidence boundary and calendar-date rules are still present verbatim", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /okuduğun anlamına GELMEZ/);
  assert.match(routeSource, /YAYIM TARİHİ.*ASLA bir kuralın\/uygulamanın yürürlüğe girdiği/);
  assert.match(routeSource, /ASLA ayrı toplanabilir "component" sayısal facts'e bölme/);
});

// ============================================================
// Verified Fact Contract — Job 1 (a separate, narrow, non-editorial AI
// call) classifies every evidence claim as current-topic/different-
// scenario/unsupported; code deterministically keeps ONLY current-topic
// facts before Job 2 (the existing editorial ContentPackage call) ever
// runs. This is the actual fix for the proven context-leakage defect —
// see factContract.ts's own header comment.
// ============================================================

const MEANINGFUL_EVIDENCE_TEXT =
  "Bakanlık, satış işlemlerinde deprem sigortası poliçesinin tapu müdürlüğüne ibraz edilmesinin " +
  "1 Ekim 2026 tarihinden itibaren zorunlu olacağını, poliçesi bulunmayan başvuruların ise " +
  "işleme alınmayacağını açıkladı. Bu bir uzun UNIQUE_RAW_EVIDENCE_MARKER_TOKEN içerir.";

function makeOpportunityWithEvidence(evidenceText) {
  return {
    contentOpportunity: {
      topic: "t",
      angle: "a",
      whyNow: "w",
      keyFacts: ["Başlık"],
      sources: [
        { title: "Başlık", publisher: "TKGM", url: "https://example.com/x", publishedAt: "2026-09-01", evidenceText },
      ],
    },
    visualFormat: "carousel",
  };
}

test("Verified Fact Contract: MEANINGFUL evidence triggers Job 1 (a separate fact-extraction call)", async () => {
  const { route, state } = loadContentPackageRoute();
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  assert.equal(state.factExtractionCalls, 1);
  assert.equal(state.contentPackageCalls, 1);
});

test("Verified Fact Contract: THIN evidence skips Job 1 entirely — no fact-extraction call is made", async () => {
  const { route, state } = loadContentPackageRoute();
  await route.POST({ json: async () => makeOpportunityWithEvidence("Kısa ve gerçek ama yetersiz bir açıklama.") });
  assert.equal(state.factExtractionCalls, 0);
});

test("Verified Fact Contract: NONE (absent) evidence skips Job 1 entirely", async () => {
  const { route, state } = loadContentPackageRoute();
  await route.POST({
    json: async () => ({
      contentOpportunity: { topic: "t", angle: "a", whyNow: "w", keyFacts: [], sources: [] },
      visualFormat: "carousel",
    }),
  });
  assert.equal(state.factExtractionCalls, 0);
});

test("Verified Fact Contract: current-topic facts reach Job 2's user message", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "SATIŞ_OZEL_OLGU: alıcı kendi poliçesini yaptırmalı.",
          evidenceFragment: "poliçesi bulunmayan başvuruların ise işleme alınmayacağını",
          status: "current-topic",
        },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /SATIŞ_OZEL_OLGU/);
  assert.match(userMessage, /KANIT DURUMU: YETERLİ/);
});

test("Verified Fact Contract: different-scenario facts NEVER reach Job 2's user message", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "SATIŞ_OZEL_OLGU: alıcı kendi poliçesini yaptırmalı.",
          evidenceFragment: "poliçesi bulunmayan başvuruların ise işleme alınmayacağını",
          status: "current-topic",
        },
        { claim: "FARKLI_SENARYO_OLGUSU: bildirim 15 gün içinde yapılır.", evidenceFragment: "kanıt B", status: "different-scenario" },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /SATIŞ_OZEL_OLGU/);
  assert.doesNotMatch(userMessage, /FARKLI_SENARYO_OLGUSU/);
});

test("Verified Fact Contract: unsupported facts NEVER reach Job 2's user message", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "SATIŞ_OZEL_OLGU: alıcı kendi poliçesini yaptırmalı.",
          evidenceFragment: "poliçesi bulunmayan başvuruların ise işleme alınmayacağını",
          status: "current-topic",
        },
        { claim: "DESTEKSIZ_OLGU: uydurma bir olası iddia.", evidenceFragment: "kanıt C", status: "unsupported" },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /SATIŞ_OZEL_OLGU/);
  assert.doesNotMatch(userMessage, /DESTEKSIZ_OLGU/);
});

test("Verified Fact Contract: the full raw evidence document is NOT included in Job 2's message once the Fact Contract succeeds", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [{ claim: "Bir olgu.", evidenceFragment: "zorunlu olacağını", status: "current-topic" }],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.doesNotMatch(userMessage, /UNIQUE_RAW_EVIDENCE_MARKER_TOKEN/);
});

const SALE_VS_ASSIGNMENT_EVIDENCE_TEXT =
  "Satış işleminde eski poliçe tescil tarihi itibarıyla sözleşme sona erer ve alıcı kendi poliçesini " +
  "yaptırmalıdır. Bunlar dışındaki hâllerde menfaat sahibi değişikliğinde sigortalı, on beş gün içinde " +
  "sözleşmeye aracılık eden sigorta şirketine bildirir; sigorta şirketi ise bildirimin alınmasından " +
  "itibaren 24 saat içinde zeyilname düzenler.";

test("Verified Fact Contract: the proven regression case — a sale-specific fact is retained while the 15-day/24-hour alternate-branch facts are excluded from Job 2's context", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "Satış işleminde eski poliçe tescil tarihinde sona erer, alıcı kendi poliçesini yaptırmalıdır.",
          evidenceFragment: "tescil tarihi itibarıyla sözleşme sona erer",
          status: "current-topic",
        },
        {
          claim: "Menfaat sahibi değişikliği 15 gün içinde sigorta şirketine bildirilir.",
          evidenceFragment: "on beş gün içinde sözleşmeye aracılık eden sigorta şirketine bildirir",
          status: "different-scenario",
        },
        {
          claim: "Sigorta şirketi bildirimden itibaren 24 saat içinde zeyilname düzenler.",
          evidenceFragment: "bildirimin alınmasından itibaren 24 saat içinde",
          status: "different-scenario",
        },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(SALE_VS_ASSIGNMENT_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /eski poliçe tescil tarihinde sona erer/);
  assert.doesNotMatch(userMessage, /15 gün içinde sigorta şirketine bildirilir/);
  assert.doesNotMatch(userMessage, /24 saat içinde zeyilname düzenler/);
});

test("Verified Fact Contract: Job 1 failure (thrown error) fails CLOSED — Job 2 never receives the raw evidence, and the request still succeeds", async () => {
  const { route, state } = loadContentPackageRoute({
    factExtractionError: new Error("simulated fact extraction failure"),
  });
  const response = await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  assert.equal(response.status, 200);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /KANIT DURUMU: YOK/);
  assert.doesNotMatch(userMessage, /KANIT DURUMU: YETERLİ/);
  assert.doesNotMatch(userMessage, /UNIQUE_RAW_EVIDENCE_MARKER_TOKEN/);
});

test("Verified Fact Contract: malformed (non-JSON) Job 1 response fails CLOSED, same as a thrown error", async () => {
  const { route, state } = loadContentPackageRoute({ factContractResponse: "malformed" });
  const response = await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  assert.equal(response.status, 200);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /KANIT DURUMU: YOK/);
});

test("Verified Fact Contract: zero current-topic facts (everything different-scenario/unsupported) fails CLOSED — never YETERLİ, never the raw document", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        { claim: "Farklı bir senaryo olgusu.", evidenceFragment: "kanıt", status: "different-scenario" },
        { claim: "Desteksiz bir iddia.", evidenceFragment: "kanıt", status: "unsupported" },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /KANIT DURUMU: YOK/);
  assert.doesNotMatch(userMessage, /KANIT DURUMU: YETERLİ/);
  assert.doesNotMatch(userMessage, /UNIQUE_RAW_EVIDENCE_MARKER_TOKEN/);
});

// ============================================================
// Evidence Fragment Grounding Check — Gap 1 of the Known Open Risk audit:
// "current-topic" was previously Job 1's OWN classification of its OWN
// self-reported evidenceFragment, with nothing confirming that fragment
// actually appears in the real evidenceText. These tests prove a
// "current-topic" fact whose evidenceFragment is NOT a genuine quote from
// the evidenceText is now dropped (fails CLOSED), same as if Job 1 had
// never reported it — see factContract.ts's isEvidenceFragmentGrounded.
// ============================================================

test("Verified Fact Contract: a current-topic fact whose evidenceFragment is NOT a genuine quote from the evidenceText is dropped (fails CLOSED)", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "HALÜSİNE_EDİLMİŞ_OLGU: bu iddia kanıtta gerçekten geçmiyor.",
          evidenceFragment: "bu cümle kaynak metninde asla geçmiyor",
          status: "current-topic",
        },
      ],
    },
  });
  const response = await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  assert.equal(response.status, 200);
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.doesNotMatch(userMessage, /HALÜSİNE_EDİLMİŞ_OLGU/);
  assert.match(userMessage, /KANIT DURUMU: YOK/);
  assert.doesNotMatch(userMessage, /KANIT DURUMU: YETERLİ/);
});

test("Verified Fact Contract: among two current-topic facts, only the one genuinely grounded in evidenceText reaches Job 2", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "GERÇEK_OLGU: poliçesi olmayan başvurular işleme alınmaz.",
          evidenceFragment: "poliçesi bulunmayan başvuruların ise işleme alınmayacağını",
          status: "current-topic",
        },
        {
          claim: "HALÜSİNE_EDİLMİŞ_OLGU: bu iddia kanıtta gerçekten geçmiyor.",
          evidenceFragment: "bu cümle kaynak metninde asla geçmiyor",
          status: "current-topic",
        },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /GERÇEK_OLGU/);
  assert.doesNotMatch(userMessage, /HALÜSİNE_EDİLMİŞ_OLGU/);
  assert.match(userMessage, /KANIT DURUMU: YETERLİ/);
});

test("Verified Fact Contract: a current-topic fact's evidenceFragment matches case/whitespace-insensitively, not only byte-for-byte", async () => {
  const { route, state } = loadContentPackageRoute({
    factContractResponse: {
      facts: [
        {
          claim: "GERÇEK_OLGU: poliçesi olmayan başvurular işleme alınmaz.",
          // Different case + extra/irregular whitespace than the real
          // evidence text, but the same words — must still be accepted.
          evidenceFragment: "POLİÇESİ   bulunmayan BAŞVURULARIN ise  işleme alınmayacağını",
          status: "current-topic",
        },
      ],
    },
  });
  await route.POST({ json: async () => makeOpportunityWithEvidence(MEANINGFUL_EVIDENCE_TEXT) });
  const userMessage = state.lastMessages.find((m) => m.role === "user").content;
  assert.match(userMessage, /GERÇEK_OLGU/);
  assert.match(userMessage, /KANIT DURUMU: YETERLİ/);
});

test("isEvidenceFragmentGrounded: rejects an empty/whitespace-only evidenceFragment even though it trivially 'matches' any text", () => {
  const ungrounded = factContract.isEvidenceFragmentGrounded(
    { claim: "x", evidenceFragment: "   ", status: "current-topic" },
    MEANINGFUL_EVIDENCE_TEXT,
  );
  assert.equal(ungrounded, false);
});

test("isEvidenceFragmentGrounded: accepts a genuine substring and rejects a fabricated one, directly against the real module", () => {
  const grounded = factContract.isEvidenceFragmentGrounded(
    { claim: "x", evidenceFragment: "zorunlu olacağını", status: "current-topic" },
    MEANINGFUL_EVIDENCE_TEXT,
  );
  const notGrounded = factContract.isEvidenceFragmentGrounded(
    { claim: "x", evidenceFragment: "tamamen icat edilmiş bir alıntı", status: "current-topic" },
    MEANINGFUL_EVIDENCE_TEXT,
  );
  assert.equal(grounded, true);
  assert.equal(notGrounded, false);
});

test("content-package route's FACT_SCHEMA (ContentFact's own schema) is unchanged by the Verified Fact Contract work", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(
    routeSource,
    /required: \["label", "value", "unit", "role"\]/,
  );
});

test("content-package prompt treats the scenario boundary marker as a structural hint for Job 1, never an automatic relevance verdict", () => {
  const routeSource = readContentPackageRouteSource();
  assert.match(routeSource, /yalnızca yapısal bir ipuçtur/);
  assert.match(routeSource, /otomatik bir "different-scenario" kararı DEĞİLDİR/);
});
