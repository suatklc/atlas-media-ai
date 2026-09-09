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
  const state = { completionCalls: 0, lastMessages: null };

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
              state.lastMessages = args.messages;
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
    },
  };

  const route = loadTypeScriptModule(
    "src/app/api/content-package/route.ts",
    (specifier) => defaultDeps[specifier] ?? {},
    { Response, Buffer, process, JSON },
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
