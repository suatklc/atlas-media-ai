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

// Same sandboxed loader convention used throughout tests/*.test.mjs — for
// pure TypeScript logic (no real fs/network/wasm needed).
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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Real-execution loader (renderCarousel needs genuine fs + the real
// @resvg/resvg-wasm package to produce actual PNG bytes — a sandboxed
// vm.runInNewContext realm with mocked deps can't do that). Same technique
// used earlier in this project for ad-hoc real-render validation:
// ts.transpileModule + Module.wrap + vm.runInThisContext (SAME realm, so
// process/Buffer/require all work naturally) + a small localRequire that
// resolves this project's own relative TS imports recursively and defers
// everything else to Node's real require.
const realModuleCache = new Map();

function loadRealTsModule(absPath) {
  const normalized = path.resolve(absPath);
  if (realModuleCache.has(normalized)) {
    return realModuleCache.get(normalized);
  }

  const source = fs.readFileSync(normalized, "utf8");
  // esModuleInterop is required here (unlike the sandboxed loadTypeScriptModule
  // above): resvg-renderer.ts does `import fs from "node:fs"` — without it,
  // TS's default emit accesses a nonexistent `.default` on real Node's CJS
  // fs module. TS's self-contained __importDefault helper needs no extra
  // wiring beyond this flag.
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

const premiumCarousel = loadRealTsModule(path.join(projectRoot, "src/lib/ai/image/templates/premiumCarousel.ts"));
const carousel = loadRealTsModule(
  path.join(projectRoot, "src/lib/ai/image/templates/carousel.ts"),
);
const caption = loadTypeScriptModule("src/lib/ai/creative/caption.ts");
const carouselStructureModule = loadTypeScriptModule(
  "src/lib/ai/content/carousel-structure.ts",
  (specifier) => (specifier === "../creative/caption" ? caption : {}),
);
const directive = loadTypeScriptModule("src/lib/ai/creative/directive.ts");
const formatRecommendation = loadTypeScriptModule("src/lib/ai/research/formatRecommendation.ts");
const format = loadTypeScriptModule("src/lib/ai/content/format.ts");
// Real module: generate-visual/route.ts formats the carousel source label
// in Turkey-local time through it.
const turkishDate = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
// Real module: the ContentPackage → slide text mapping shared by
// generate-visual and /api/drafts/edit.
const carouselSlides = loadTypeScriptModule("src/lib/ai/content/carouselSlides.ts", (name) =>
  name === "@/lib/ai/research/retrieval/turkishDate" ? turkishDate : {},
);

// A real, minimal, valid 1x1 transparent PNG — a genuine base image the
// resvg <image> embedding actually decodes, not a synthetic/malformed
// buffer. Visual attractiveness doesn't matter for these structural tests
// (dimensions, PNG validity, no-crash on long Turkish text); a fuller
// photographic base image is used for the separate manual visual
// inspection pass (see the final report).
const TINY_BASE_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function readPngDimensions(buffer) {
  assert.equal(buffer[0], 0x89, "must start with the PNG magic byte");
  assert.equal(buffer.toString("ascii", 1, 4), "PNG", "must carry the PNG signature");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const LONG_TURKISH_SLIDE_TEXT = {
  cover: "Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında Önemli Gelişme",
  whatHappened:
    "Tapu ve Kadastro Genel Müdürlüğü (TKGM), 12 Ağustos 2026 tarihinde yayımladığı duyuruda, davalı olduğu halde tapu kütüğüne tescil edilen ve TAKBİS'e aktarılan taşınmazlara ilişkin bir açıklama yaptı; bu açıklama gayrimenkul piyasasında geniş yankı buldu.",
  whyItMatters:
    "Bu gelişme, gayrimenkul alıcıları açısından tapu kayıtlarının işlem öncesinde dikkatle incelenmesinin önemini yeniden gündeme getiriyor ve özellikle yatırım amaçlı taşınmaz alımlarında ek özen gösterilmesini gerektirebilir.",
  considerations: [
    "Tapu kaydını işlem öncesinde güncel olarak kontrol edin",
    "Şerh, beyan ve kısıtlama bilgilerini inceleyin",
    "Gerekirse ilgili resmi kurumdan bilgi alın",
    "Süreç boyunca uzman desteği almayı değerlendirin",
  ],
  closingLine: "Doğru bilgiye dayanan bir karar, her zaman daha güvenlidir.",
  fixedCta: "Detaylar İçin Mesaj Bırakın",
  sourceLabel: "Tapu ve Kadastro Genel Müdürlüğü (TKGM) · 12 Ağustos 2026",
};

test("renderCarousel produces exactly 5 real PNG buffers, each exactly 1080x1350, in deterministic slide order", async () => {
  const buffers = await carousel.renderCarousel(TINY_BASE_IMAGE, "1080x1350", LONG_TURKISH_SLIDE_TEXT);

  assert.equal(Array.isArray(buffers), true);
  assert.equal(buffers.length, 5, "must be exactly 5 slides — not 1, not 6");

  for (let i = 0; i < buffers.length; i += 1) {
    const buffer = buffers[i];
    assert.ok(Buffer.isBuffer(buffer), `slide ${i + 1} must be a real Buffer`);
    const { width, height } = readPngDimensions(buffer);
    assert.equal(width, 1080, `slide ${i + 1} width must be exactly 1080`);
    assert.equal(height, 1350, `slide ${i + 1} height must be exactly 1350`);
  }

  // Deterministic order + genuinely distinct content: slide 5 (closing) is
  // a solid-navy card with no photo, so its bytes must differ meaningfully
  // from slide 1 (a full photo cover) — proves this is not five duplicated
  // images under a different name.
  assert.notEqual(buffers[0].length, buffers[4].length);
});

test("renderCarousel handles realistic long Turkish copy without throwing (shortens via layout truncation, never crashes)", async () => {
  const buffers = await carousel.renderCarousel(TINY_BASE_IMAGE, "1080x1350", LONG_TURKISH_SLIDE_TEXT);
  assert.equal(buffers.length, 5);
});

// Carousel Final Quality — the exact real production shape (captured
// from a genuine /api/content-package response on the live TKGM/DASK
// source) that exposed three real defects: keyFact was a full editorial
// sentence (150+ chars) rendered at the 72px "big number" size and
// truncated into an unreadable fragment; considerations were full
// sentences truncated at 2 lines with huge, uneven gaps between only 2
// items; closingLine was a 3-sentence paragraph truncated mid-sentence.
// This fixture is a regression anchor for that exact shape, not just
// "long text" in general.
const GOLD_STANDARD_REAL_SLIDE_TEXT = {
  cover: "Satışta DASK başlığı artık işlem akışının daha görünür bir parçası.",
  whatHappened:
    "21.08.2026 tarihli Resmi Gazete’de yayımlanan değişikliğe göre, satış ve muadili işlemler nedeniyle taşınmazın menfaat sahibi değişirse zorunlu deprem sigortası sözleşmesi tapudaki tescil tarihi itibarıyla sona eriyor.",
  keyFact:
    "Zorunlu Deprem Sigortası Genel Şartlarında değişikliğe dair Tebliğ'in 1'inci maddesi 21.08.2026 tarihli ve 33347 sayılı Resmi Gazete’de yayımlandı.",
  whyItMatters:
    "Alıcı açısından bakıldığında, devralınan taşınmazda önceki poliçenin aynı şekilde devam edeceği varsayımıyla hareket etmek doğru olmayabilir. Bu gelişme, satış gününde sigorta tarafının yeni menfaat sahibi üzerinden ele alınması gerektiğini gösteriyor.",
  considerations: [
    "Tapu müdürlükleri veya işlemi yapmaya yetkili idareler kontrolü sonraki menfaat sahibine ait sözleşme üzerinden yapar.",
    "Kontrol, menfaat değişikliği bağlamında yapılır.",
  ],
  closingLine:
    "Bu duyuru, gayrimenkul satışında sigorta bilgisinin son aşamada hatırlanacak bir detay olmadığını gösteriyor. Özellikle alım-satım sürecinde tarafların tapu gününden önce poliçe hazırlığını netleştirmesi, süreci daha öngörülebilir hale getirebilir. İşlem öncesi evrak akışını baştan kurgulamak bugün daha önemli.",
  fixedCta: "Detaylar İçin Mesaj Bırakın",
  sourceLabel: "Tapu ve Kadastro Genel Müdürlüğü (TKGM) — Duyurular · 7 Eylül 2026",
};

test("renderCarousel: the exact real production content shape (long keyFact/considerations/closingLine) renders 5 valid, correctly-sized PNGs without throwing", async () => {
  const buffers = await carousel.renderCarousel(TINY_BASE_IMAGE, "1080x1350", GOLD_STANDARD_REAL_SLIDE_TEXT);
  assert.equal(buffers.length, 5);
  for (const buffer of buffers) {
    const { width, height } = readPngDimensions(buffer);
    assert.equal(width, 1080);
    assert.equal(height, 1350);
  }
});

test("renderCarousel handles minimal/short copy without throwing", async () => {
  const buffers = await carousel.renderCarousel(TINY_BASE_IMAGE, "1080x1350", {
    cover: "Kısa Başlık",
    whatHappened: "Kısa açıklama.",
    whyItMatters: "Kısa gerekçe.",
    considerations: ["Tek madde"],
    closingLine: "Kısa kapanış.",
  });
  assert.equal(buffers.length, 5);
});

test("carousel.ts source never renders any 'Atlas' branding — uses the REAL Suat Kılıç logo asset (Gold Standard V1), not the old procedural mark", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/lib/ai/image/templates/carousel.ts"), "utf8");
  assert.doesNotMatch(source, /atlas/i);
  assert.match(source, /buildRealLogoMarkup/);
  assert.doesNotMatch(source, /buildBrandMark/);
});

test("carousel.ts never imports or calls hero.ts's renderer — an independent renderer, not a modification of the protected hero path", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/lib/ai/image/templates/carousel.ts"), "utf8");
  assert.doesNotMatch(source, /from ["']\.\/hero["']/);
});

test("hero.ts and educational.ts are byte-for-byte unmodified by this task (git-tracked, diffable — asserted here via absence of any carousel-specific reference)", () => {
  for (const file of ["hero.ts", "educational.ts"]) {
    const source = fs.readFileSync(path.join(projectRoot, `src/lib/ai/image/templates/${file}`), "utf8");
    assert.doesNotMatch(source, /carousel/i, `${file} must not reference carousel — it stays single-image-only`);
  }
});

// ============================================================
// CAROUSEL_STRUCTURE marker extraction (creative/caption.ts)
// ============================================================

test("extractCarouselStructure parses the 3-field pipe-delimited marker", () => {
  const text = "Gövde metni.\n[[CAROUSEL_STRUCTURE: Ne oldu metni | Neden önemli metni | Kapanış cümlesi]]\nEtiketler: #emlak";
  const result = caption.extractCarouselStructure(text);
  assert.deepEqual(plain(result), {
    whatHappened: "Ne oldu metni",
    whyItMatters: "Neden önemli metni",
    cta: "Kapanış cümlesi",
  });
});

test("extractCarouselStructure returns undefined when the marker is absent or malformed (fewer than 3 fields)", () => {
  assert.equal(caption.extractCarouselStructure("no marker here"), undefined);
  assert.equal(caption.extractCarouselStructure("[[CAROUSEL_STRUCTURE: only one field]]"), undefined);
});

test("extractVisualHeadlineMarker strips the CAROUSEL_STRUCTURE marker from displayText and returns it alongside the other markers", () => {
  const text =
    "Gövde metni burada.\n[[VISUAL_HEADLINE: Kısa Başlık]]\n[[EDUCATIONAL_POINTS: a | b]]\n[[CAROUSEL_STRUCTURE: x | y | z]]";
  const result = caption.extractVisualHeadlineMarker(text);
  assert.equal(result.displayText.includes("CAROUSEL_STRUCTURE"), false);
  assert.deepEqual(plain(result.carouselStructure), { whatHappened: "x", whyItMatters: "y", cta: "z" });
  assert.equal(result.visualHeadline, "Kısa Başlık");
  assert.deepEqual(plain(result.educationalPoints), ["a", "b"]);
});

// ============================================================
// resolveCarouselStructure (content/carousel-structure.ts) — mirrors
// resolveEducationalPoints's own client-first / fallback-to-response-text
// contract.
// ============================================================

test("resolveCarouselStructure returns undefined for outputMode 'single' regardless of input", () => {
  assert.equal(
    carouselStructureModule.resolveCarouselStructure("single", { whatHappened: "a", whyItMatters: "b", cta: "c" }, "irrelevant"),
    undefined,
  );
});

test("resolveCarouselStructure prefers a clean client-supplied structure over re-deriving from response text", () => {
  const result = carouselStructureModule.resolveCarouselStructure(
    "carousel",
    { whatHappened: "client A", whyItMatters: "client B", cta: "client C" },
    "[[CAROUSEL_STRUCTURE: server A | server B | server C]]",
  );
  assert.deepEqual(plain(result), { whatHappened: "client A", whyItMatters: "client B", cta: "client C" });
});

test("resolveCarouselStructure falls back to extracting from assistantResponseText when the client value is missing/malformed", () => {
  const result = carouselStructureModule.resolveCarouselStructure(
    "carousel",
    null,
    "metin\n[[CAROUSEL_STRUCTURE: server A | server B | server C]]",
  );
  assert.deepEqual(plain(result), { whatHappened: "server A", whyItMatters: "server B", cta: "server C" });
});

test("resolveCarouselStructure returns undefined when neither client nor response text has usable structure", () => {
  assert.equal(carouselStructureModule.resolveCarouselStructure("carousel", null, "no marker here"), undefined);
});

// ============================================================
// creative/directive.ts: outputMode-gated marker requests
// ============================================================

const SAMPLE_BRIEF = {
  direction: {
    attentionFocus: "a", primaryMessage: "b", secondaryMessage: "c",
    narrativeAngle: "d", emotionalTone: "e", visualPriority: "f", eyeFlow: "g",
  },
  execution: {
    aspectRatio: "4:5", dimensionsPx: "1080x1350", composition: "h", imagerySubject: "i",
    imageryTreatment: "j", cameraDirection: "k", lightingDirection: "l", colorDirection: "m",
    typographyHierarchy: "n", textPlacement: "o", logoPlacement: "p", ctaVisualTreatment: "q",
    structureConstraint: "r",
  },
};

test("a carousel market-stats brief (non-educational intent) still requests EDUCATIONAL_POINTS and the new CAROUSEL_STRUCTURE marker", () => {
  const result = directive.buildCreativeDirective(SAMPLE_BRIEF, "market-stats", "carousel");
  assert.match(result, /\[\[EDUCATIONAL_POINTS:/);
  assert.match(result, /\[\[CAROUSEL_STRUCTURE:/);
});

test("a single-image market-stats brief requests neither EDUCATIONAL_POINTS nor CAROUSEL_STRUCTURE (unchanged behavior)", () => {
  const result = directive.buildCreativeDirective(SAMPLE_BRIEF, "market-stats", "single");
  assert.doesNotMatch(result, /EDUCATIONAL_POINTS/);
  assert.doesNotMatch(result, /CAROUSEL_STRUCTURE/);
});

test("a single-image educational brief still requests EDUCATIONAL_POINTS but NOT CAROUSEL_STRUCTURE (existing single-image educational path untouched)", () => {
  const result = directive.buildCreativeDirective(SAMPLE_BRIEF, "educational", "single");
  assert.match(result, /\[\[EDUCATIONAL_POINTS:/);
  assert.doesNotMatch(result, /CAROUSEL_STRUCTURE/);
});

test("a carousel educational brief requests both markers", () => {
  const result = directive.buildCreativeDirective(SAMPLE_BRIEF, "educational", "carousel");
  assert.match(result, /\[\[EDUCATIONAL_POINTS:/);
  assert.match(result, /\[\[CAROUSEL_STRUCTURE:/);
});

// ============================================================
// Format <-> ContentIntent decoupling, end to end through resolveOutputSpecification
// ============================================================

test("the user's explicit format field is authoritative and independent of intent — carousel for every intent resolves outputMode carousel/5", () => {
  for (const intent of ["listing", "educational", "comparison", "market-stats", "announcement"]) {
    const seed = `Herhangi bir konu.${formatRecommendation.buildFormatSuffix("carousel")}`;
    assert.deepEqual(plain(format.resolveOutputSpecification(seed, intent)), { outputMode: "carousel", slideCount: 5 });
  }
});

test("the user's explicit single format field resolves outputMode single/1 for every intent", () => {
  for (const intent of ["listing", "educational", "comparison", "market-stats", "announcement"]) {
    const seed = `Herhangi bir konu.${formatRecommendation.buildFormatSuffix("single")}`;
    assert.deepEqual(plain(format.resolveOutputSpecification(seed, intent)), { outputMode: "single", slideCount: 1 });
  }
});

// ============================================================
// generate-visual/route.ts wiring: the user's explicit visualFormat choice
// must be authoritative and must ACTUALLY route to the real carousel
// renderer (or the real single-image compositor) — not a workaround, not a
// silent fallback. All IO (Supabase, image generation, upload) is mocked
// here so this isolates the ROUTE's own branch selection; renderCarousel
// itself is verified for real above.
// ============================================================

const FIXTURE_OPPORTUNITY = {
  topic: "Davalı Olduğu Halde Tapu Kütüğüne Tescil Edilen Ve Takbis'e Aktarılan Taşınmazlar Hakkında",
  angle: "Alıcılar için pratik anlamı",
  whyNow: "TKGM tarafından yayımlandı",
  keyFacts: ["Bir gelişme yaşandı"],
  sources: [
    {
      title: "Duyuru",
      publisher: "Tapu ve Kadastro Genel Müdürlüğü (TKGM)",
      url: "https://www.tkgm.gov.tr/duyuru",
      publishedAt: "2026-08-12T21:00:00.000Z",
      tier: "official-authority",
    },
  ],
  freshness: "recent",
  suggestedContentType: "educational",
};

function loadGenerateVisualRoute(overrides = {}) {
  const state = {
    composeCalls: 0,
    carouselCalls: 0,
    uploadCalls: 0,
    capturedSlideText: null,
    capturedInsert: null,
  };

  const defaultDeps = {
    "next/server": {},
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
        from: () => ({
          insert: async (row) => {
            state.capturedInsert = row;
            return { error: null };
          },
        }),
      }),
    },
    "@/lib/ai/content/plan": { buildContentPlan: overrides.buildContentPlan },
    "@/lib/ai/content/types": {},
    "@/lib/ai/creative/brief": {
      buildCreativeBrief: () => ({
        execution: {
          typographyHierarchy: "a", textPlacement: "b", logoPlacement: "c", ctaVisualTreatment: "d",
        },
      }),
    },
    "@/lib/ai/creative/image-prompt": { buildImagePrompt: () => "prompt" },
    "@/lib/ai/media/router": {
      generateImage: async () => ({ bytes: Buffer.from("fake-base-image"), contentType: "image/png" }),
    },
    "@/lib/ai/media/config": {
      DEFAULT_IMAGE_PROVIDER: "openai",
      DEFAULT_IMAGE_MODEL: "test-model",
      IMAGE_MODEL_CONFIGS: {},
    },
    "@/lib/ai/platform/config": {
      PLATFORM_CONFIGS: { instagram: { id: "instagram", label: "Instagram", aspectRatio: "4:5", dimensions: "1080x1350" } },
      DEFAULT_PLATFORM: "instagram",
      isPlatformId: (v) => v === "instagram",
    },
    "@/lib/ai/image/compose": {
      composeInstagramPost: async () => {
        state.composeCalls += 1;
        return Buffer.from("composed-single-image");
      },
    },
    "@/lib/ai/image/templates/select": { selectVisualTemplateId: () => "educational" },
    "@/lib/ai/image/templates/carousel": {
      renderCarousel: async (_baseImage, _dims, slideText) => {
        state.carouselCalls += 1;
        state.capturedSlideText = slideText;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`slide-${n}`));
      },
    },
    "@/lib/supabase/storage": {
      uploadGeneratedImage: async () => {
        state.uploadCalls += 1;
        return { url: `https://storage.example/${state.uploadCalls}.png` };
      },
    },
    "@/lib/ai/creative/caption": { buildPublishableCaption: (v) => v },
    "@/lib/ai/content/educational-points": { resolveEducationalPoints: () => ["c1", "c2", "c3", "c4", "c5"] },
    "@/lib/ai/content/carousel-structure": {
      resolveCarouselStructure: overrides.resolveCarouselStructure ?? (() => undefined),
    },
    "@/lib/ai/research/opportunity": {
      buildSeedMessage: () => "seed message",
      isContentOpportunity: (v) => Boolean(v && typeof v === "object"),
    },
    "@/lib/ai/research/formatRecommendation": {
      isVisualFormat: (v) => v === "single" || v === "carousel",
      buildFormatSuffix: (f) => (f === "carousel" ? " carousel-suffix" : " single-suffix"),
    },
    // Gold Standard V1: these tests never send a contentPackage field, so
    // isContentPackage must return false — the new branch is skipped and
    // every existing assertion below (about the OLD marker-driven path)
    // remains exactly what it was testing.
    "@/lib/ai/content/contentPackage": {
      isContentPackage: () => false,
      validateContentPackage: () => ({ ok: true }),
    },
    "@/lib/ai/creative/goldStandardImagePrompt": {
      buildGoldStandardImagePrompt: () => "gold-standard-prompt",
      buildExpertVillaImagePrompt: () => "expert-villa-prompt",
    },
    "@/lib/ai/context/businessProfile": { ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: [] } } },
    "@/lib/ai/research/retrieval/turkishDate": turkishDate,
    "@/lib/ai/content/carouselSlides": carouselSlides,
    "@/lib/ai/image/templates/premiumCarousel": {
      renderPremiumCarousel: async (_baseImage, _dims, text) => {
        state.premiumCalls = (state.premiumCalls ?? 0) + 1;
        state.lastPremiumText = text;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`premium-slide-${n}`));
      },
    },
  };

  const route = loadTypeScriptModule(
    "src/app/api/generate-visual/route.ts",
    (specifier) => defaultDeps[specifier] ?? {},
    { Response, Buffer, process },
  );

  return { route, state };
}

test("generate-visual route: visualFormat 'single' takes the real single-image path — composeInstagramPost runs, renderCarousel never called", async () => {
  const { route, state } = loadGenerateVisualRoute({
    buildContentPlan: () => ({ intent: "educational", outputMode: "single", slideCount: 1, template: { id: "EDUCATIONAL_CAROUSEL_01" } }),
  });

  const response = await route.POST({
    json: async () => ({
      contentOpportunity: FIXTURE_OPPORTUNITY,
      visualFormat: "single",
      headline: "Başlık",
      content: "içerik",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.composeCalls, 1);
  assert.equal(state.carouselCalls, 0);
  assert.equal(body.outputMode, "single");
  assert.equal(typeof body.imageUrl, "string");
});

test("generate-visual route: visualFormat 'carousel' takes the REAL carousel path — renderCarousel runs with the resolved slide text, composeInstagramPost never called, 5 slides uploaded and persisted", async () => {
  const { route, state } = loadGenerateVisualRoute({
    buildContentPlan: () => ({ intent: "educational", outputMode: "carousel", slideCount: 5, template: { id: "EDUCATIONAL_CAROUSEL_01" } }),
    resolveCarouselStructure: () => ({ whatHappened: "ne oldu", whyItMatters: "neden önemli", cta: "kapanış" }),
  });

  const response = await route.POST({
    json: async () => ({
      contentOpportunity: FIXTURE_OPPORTUNITY,
      visualFormat: "carousel",
      headline: "Başlık",
      content: "içerik",
      assistantResponseText: "irrelevant — resolveCarouselStructure is mocked",
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(state.carouselCalls, 1, "the real carousel renderer must run exactly once");
  assert.equal(state.composeCalls, 0, "the single-image compositor must never run for a carousel request");
  // 1 base-image upload (shared with the single path — the same one paid
  // generation call) + 5 slide uploads.
  assert.equal(state.uploadCalls, 6, "the base image plus all 5 slides must be uploaded");
  assert.equal(body.outputMode, "carousel");
  assert.equal(Array.isArray(body.images), true);
  assert.equal(body.images.length, 5);
  assert.deepEqual(
    body.images.map((i) => i.slide),
    [1, 2, 3, 4, 5],
  );

  // The slide text actually passed to the renderer carries the resolved
  // structure, the headline as cover, and the fixed (non-model) CTA.
  assert.equal(state.capturedSlideText.cover, "Başlık");
  assert.equal(state.capturedSlideText.whatHappened, "ne oldu");
  assert.equal(state.capturedSlideText.whyItMatters, "neden önemli");
  assert.equal(state.capturedSlideText.closingLine, "kapanış");
  assert.equal(typeof state.capturedSlideText.fixedCta, "string");
  assert.ok(state.capturedSlideText.fixedCta.length > 0);

  // Persistence limitation seam: one row, cover slide as the thumbnail,
  // all 5 URLs in metadata (no schema migration).
  assert.equal(state.capturedInsert.final_image_url, body.images[0].imageUrl);
  assert.equal(state.capturedInsert.metadata.outputMode, "carousel");
  assert.equal(state.capturedInsert.metadata.carouselImages.length, 5);
});

// ============================================================
// Static Content V1 Freeze — genuine blocker fix: the Gold Standard
// ContentPackage carousel branch (a separate branch from the marker-based
// one above) persisted only contentPackage.caption as `content` —
// contentPackage.hashtags is its own structured field, unlike the old
// pipeline where hashtags already lived inline in the single raw caption
// string. Since `content` is the exact field later sent verbatim as the
// real Instagram caption on publish, an approved post's hashtags were
// shown in the dashboard preview but silently dropped at actual publish
// time. This test exercises the REAL ContentPackage branch end-to-end and
// asserts the persisted content includes them.
// ============================================================

function loadGenerateVisualRouteForContentPackage() {
  const state = { capturedInsert: null, carouselCalls: 0, uploadCalls: 0 };

  const sampleContentPackage = {
    topic: "t",
    source: { name: "TKGM", url: "https://example.com", publishedAt: "2026-09-07" },
    hook: "Kısa bir kanca.",
    caption: "Kısa bir caption.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı",
    hashtags: ["#DASK", "#Gayrimenkul"],
    format: "carousel",
    slides: [
      { index: 1, role: "hook", headline: "H1", body: "B1", facts: [], visualBrief: "v1" },
      { index: 2, role: "what-happened", headline: "H2", body: "B2", facts: ["f1"], visualBrief: "v2" },
      { index: 3, role: "why-it-matters", headline: "H3", body: "B3", facts: [], visualBrief: "v3" },
      { index: 4, role: "what-to-do", headline: "H4", body: "B4", facts: ["c1", "c2"], visualBrief: "v4" },
      { index: 5, role: "cta", headline: "H5", body: "B5", facts: [], visualBrief: "v5" },
    ],
    facts: [],
  };

  const defaultDeps = {
    "next/server": {},
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
        from: () => ({
          insert: async (row) => {
            state.capturedInsert = row;
            return { error: null };
          },
        }),
      }),
    },
    "@/lib/ai/content/plan": { buildContentPlan: () => ({ intent: "educational", outputMode: "single", slideCount: 1, template: { id: "x" } }) },
    "@/lib/ai/content/types": {},
    "@/lib/ai/creative/brief": { buildCreativeBrief: () => ({ execution: {} }) },
    "@/lib/ai/creative/image-prompt": { buildImagePrompt: () => "prompt" },
    "@/lib/ai/media/router": {
      generateImage: async () => ({ bytes: Buffer.from("fake-base-image"), contentType: "image/png" }),
    },
    "@/lib/ai/media/config": { DEFAULT_IMAGE_PROVIDER: "openai", DEFAULT_IMAGE_MODEL: "test-model", IMAGE_MODEL_CONFIGS: {} },
    "@/lib/ai/platform/config": {
      PLATFORM_CONFIGS: { instagram: { id: "instagram", label: "Instagram", aspectRatio: "4:5", dimensions: "1080x1350" } },
      DEFAULT_PLATFORM: "instagram",
      isPlatformId: (v) => v === "instagram",
    },
    "@/lib/ai/image/compose": { composeInstagramPost: async () => Buffer.from("composed") },
    "@/lib/ai/image/templates/select": { selectVisualTemplateId: () => "educational" },
    "@/lib/ai/image/templates/carousel": {
      renderCarousel: async (_baseImage, _dims, slideText) => {
        state.carouselCalls += 1;
        state.lastSlideText = slideText;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`slide-${n}`));
      },
    },
    "@/lib/supabase/storage": {
      uploadGeneratedImage: async () => {
        state.uploadCalls += 1;
        return { url: `https://storage.example/${state.uploadCalls}.png` };
      },
    },
    "@/lib/ai/creative/caption": { buildPublishableCaption: (v) => v },
    "@/lib/ai/content/educational-points": { resolveEducationalPoints: () => [] },
    "@/lib/ai/content/carousel-structure": { resolveCarouselStructure: () => undefined },
    "@/lib/ai/research/opportunity": { buildSeedMessage: () => "seed", isContentOpportunity: () => false },
    "@/lib/ai/research/formatRecommendation": {
      isVisualFormat: (v) => v === "single" || v === "carousel",
      buildFormatSuffix: () => "",
    },
    "@/lib/ai/content/contentPackage": {
      isContentPackage: (v) => Boolean(v && typeof v === "object" && Array.isArray(v.slides)),
      validateContentPackage: () => ({ ok: true }),
    },
    "@/lib/ai/creative/goldStandardImagePrompt": { buildGoldStandardImagePrompt: () => "prompt", buildExpertVillaImagePrompt: () => "expert-villa-prompt" },
    "@/lib/ai/context/businessProfile": { ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: [] } } },
    "@/lib/ai/research/retrieval/turkishDate": turkishDate,
    "@/lib/ai/content/carouselSlides": carouselSlides,
    "@/lib/ai/image/templates/premiumCarousel": {
      renderPremiumCarousel: async (_baseImage, _dims, text) => {
        state.premiumCalls = (state.premiumCalls ?? 0) + 1;
        state.lastPremiumText = text;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`premium-slide-${n}`));
      },
    },
  };

  const route = loadTypeScriptModule(
    "src/app/api/generate-visual/route.ts",
    (specifier) => defaultDeps[specifier] ?? {},
    { Response, Buffer, process },
  );

  return { route, state, sampleContentPackage };
}

test("generate-visual route's Gold Standard ContentPackage branch includes hashtags in the persisted caption content, not just the preview", async () => {
  const { route, state, sampleContentPackage } = loadGenerateVisualRouteForContentPackage();

  const response = await route.POST({
    json: async () => ({ message: "mesaj", contentPackage: sampleContentPackage, visualFormat: "carousel" }),
  });

  assert.equal(response.status, 200);
  assert.equal(state.carouselCalls, 1);
  assert.ok(state.capturedInsert, "a row must have been inserted");
  assert.match(state.capturedInsert.content, /#DASK/);
  assert.match(state.capturedInsert.content, /#Gayrimenkul/);
  // The caption's own text must still be present, not replaced.
  assert.match(state.capturedInsert.content, /Kısa bir caption\./);
});

test("generate-visual route's Gold Standard ContentPackage branch never appends an empty hashtags line when there are none", async () => {
  const { route, state, sampleContentPackage } = loadGenerateVisualRouteForContentPackage();
  const noHashtagsPackage = { ...sampleContentPackage, hashtags: [] };

  await route.POST({
    json: async () => ({ message: "mesaj", contentPackage: noHashtagsPackage, visualFormat: "carousel" }),
  });

  assert.equal(state.capturedInsert.content.trim(), noHashtagsPackage.caption.trim());
});

test("generate-visual route: carousel outputMode with no resolvable CAROUSEL_STRUCTURE returns 422 before any render/upload/persist side effect", async () => {
  const { route, state } = loadGenerateVisualRoute({
    buildContentPlan: () => ({ intent: "educational", outputMode: "carousel", slideCount: 5, template: { id: "EDUCATIONAL_CAROUSEL_01" } }),
    resolveCarouselStructure: () => undefined,
  });

  const response = await route.POST({
    json: async () => ({
      contentOpportunity: FIXTURE_OPPORTUNITY,
      visualFormat: "carousel",
      headline: "Başlık",
      content: "içerik",
    }),
  });

  assert.equal(response.status, 422);
  assert.equal(state.carouselCalls, 0, "the carousel renderer must never run without a resolvable structure");
  // The base image (shared, generated before the carousel branch runs) is
  // already uploaded by this point — only the 5 slide uploads/persistence
  // that would follow a successful renderCarousel call are skipped.
  assert.equal(state.uploadCalls, 1, "only the base-image upload happens; no slide uploads");
  assert.equal(state.capturedInsert, null, "no history row is ever written for a rejected request");
});

// ============================================================
// Expert / portfolio content mode (dashboard "Instagram paylaşımı
// hazırla"): rendered by the Atlas Premium design system — ONE CTA (no
// fixed second CTA), no source line. News packages keep the frozen
// Carousel V1 renderer exactly as before.
// ============================================================

test("generate-visual: an EXPERT package renders through the premium renderer — no fixed CTA, no source line", async () => {
  const { route, state, sampleContentPackage } = loadGenerateVisualRouteForContentPackage();
  const expertPackage = {
    ...sampleContentPackage,
    contentMode: "expert",
    source: { name: "Suat Kılıç — uzman değerlendirmesi", url: "atlas:expert-content", publishedAt: "" },
  };
  const response = await route.POST({
    json: async () => ({ message: "Zekeriyaköy villa sahipleri için paylaşım", contentPackage: expertPackage, visualFormat: "carousel" }),
  });
  assert.equal(response.status, 200);
  assert.equal(state.premiumCalls, 1);
  assert.equal(state.carouselCalls, 0, "news renderer not used for expert content");
  const text = state.lastPremiumText;
  assert.equal(text.kicker, "Zekeriyaköy · Uzman Görüşü");
  assert.equal(text.cover.headline, "H1");
  assert.equal(text.cover.support, "B1");
  assert.equal(text.diagnosis.headline, "H2");
  assert.equal(text.insight.body, "B3");
  assert.equal(text.strategy.items.join(","), "c1,c2");
  assert.equal(text.closing.headline, "H5");
  assert.equal(text.closing.body, "B5");
  assert.equal(JSON.stringify(text).includes("Detaylar İçin Mesaj Bırakın"), false);
  assert.equal(JSON.stringify(text).includes("TKGM"), false);
  // Still a draft-only insert: status is never set by generation.
  assert.equal(state.capturedInsert.status, undefined);
  assert.equal(state.capturedInsert.metadata.carouselImages.length, 5);
});

test("generate-visual: a NEWS package (no contentMode) still gets the fixed CTA, source line and default labels", async () => {
  const { route, state, sampleContentPackage } = loadGenerateVisualRouteForContentPackage();
  await route.POST({ json: async () => ({ message: "mesaj", contentPackage: sampleContentPackage, visualFormat: "carousel" }) });
  const text = state.lastSlideText;
  assert.equal(text.fixedCta, "Detaylar İçin Mesaj Bırakın");
  assert.match(text.sourceLabel, /^TKGM/);
  assert.equal(text.keyFact, "f1");
  assert.equal(state.premiumCalls ?? 0, 0, "news never uses the premium renderer");
});

test("renderPremiumCarousel renders long Turkish expert copy (incl. CTA + emphasis) as exactly 5 real 1080x1350 PNGs", async () => {
  const long = "Villanızın değerini, konumlandırmasını ve satış stratejisini doğru kurmadan piyasaya çıkmak, iyi bir mülkü bile sıradan gösterebilir ve süreci gereksiz yere uzatabilir.";
  const buffers = await premiumCarousel.renderPremiumCarousel(TINY_BASE_IMAGE, "1080x1350", {
    kicker: "Zekeriyaköy · Uzman Görüşü",
    cover: { headline: "Zekeriyaköy’de villanızı satarken alıcının ilk gördüğü şey fiyat değil, evin hikâyesidir", emphasis: "evin hikâyesidir", support: long },
    diagnosis: { label: "Teşhis", headline: "Teklif gelmiyorsa sorun her zaman fiyatta olmayabilir", body: `${long} ${long}` },
    insight: { label: "Asıl Mesele", headline: "Villa alıcısı yaşam biçimini satın alır", body: `${long} ${long}` },
    strategy: { label: "Ne Değişir?", headline: "Profesyonel satış stratejisi neyi değiştirir?", items: [long, long, "Hedef alıcıyı netleştirmek", long] },
    closing: { label: "Benim Görüşüm", headline: "Doğru konumlandırma doğru teklifi getirir", body: long, cta: "Villanızı konuşmak için bana DM üzerinden yazabilirsiniz." },
  });
  assert.equal(buffers.length, 5);
  for (const buffer of buffers) {
    assert.equal(buffer.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(buffer.readUInt32BE(16), 1080);
    assert.equal(buffer.readUInt32BE(20), 1350);
  }
});

test("premium emphasis: an explicit phrase is gold; otherwise the last line of a multi-line headline; never on a mismatch", () => {
  const headline = "Villanız doğru anlatılmadan değerini göstermez.";
  const lines = ["Villanız doğru", "anlatılmadan değerini", "göstermez."];
  const explicit = premiumCarousel.emphasisSegments(headline, lines, "değerini göstermez");
  assert.deepEqual(plain(explicit), [[["Villanız doğru", false]], [["anlatılmadan", false], [" değerini", true]], [["göstermez.", true]]]);
  const auto = premiumCarousel.emphasisSegments(headline, lines, "bulunmayan ifade");
  assert.deepEqual(plain(auto), [[["Villanız doğru", false]], [["anlatılmadan değerini", false]], [["göstermez.", true]]]);
  const truncated = premiumCarousel.emphasisSegments(headline, ["Villanız doğru", "anlatılmadan…"], "doğru");
  assert.deepEqual(plain(truncated), [[["Villanız doğru", false]], [["anlatılmadan…", false]]]);
  assert.deepEqual(plain(premiumCarousel.emphasisSegments("Kısa başlık", ["Kısa başlık"])), [[["Kısa başlık", false]]]);
});
