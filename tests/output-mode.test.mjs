import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader, ...globals };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const intent = loadTypeScriptModule("src/lib/ai/content/intent.ts");
const goal = loadTypeScriptModule("src/lib/ai/content/goal.ts");
const audience = loadTypeScriptModule("src/lib/ai/content/audience.ts");
const format = loadTypeScriptModule("src/lib/ai/content/format.ts");
const templates = loadTypeScriptModule("src/lib/ai/content/templates.ts");
const plan = loadTypeScriptModule("src/lib/ai/content/plan.ts", (specifier) => ({
  "./intent": intent,
  "./goal": goal,
  "./audience": audience,
  "./format": format,
  "./templates": templates,
})[specifier] ?? {});
const lookups = loadTypeScriptModule("src/lib/ai/creative/lookups.ts");
const brief = loadTypeScriptModule("src/lib/ai/creative/brief.ts", (specifier) =>
  specifier === "./lookups" ? lookups : {},
);
const contentDirective = loadTypeScriptModule("src/lib/ai/content/directive.ts");
const creativeDirective = loadTypeScriptModule("src/lib/ai/creative/directive.ts");

const LIVE_PROMPT = `Gayrimenkul yatırımı yaparken dikkat edilmesi gereken 5 konu hakkında eğitici bir Instagram gönderisi hazırla.

İçerik yatırımcıya hitap etsin.
Başlık kısa ve profesyonel olsun.
Abartılı satış dili kullanma.
Türkçe yaz.
Instagram'a uygun hashtagler ekle.

Tek görsel üret.`;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("all explicit single phrases resolve to single/1", () => {
  for (const phrase of ["tek görsel", "tek görsel üret", "tek post", "tek gönderi", "tek kare", "tek slayt", "1 slayt", "1 slide"]) {
    assert.deepEqual(plain(format.resolveOutputSpecification(phrase, "educational")), {
      outputMode: "single",
      slideCount: 1,
    });
  }
});

test("all explicit carousel phrases resolve to documented defaults", () => {
  for (const phrase of ["carousel", "karusel", "kaydırmalı gönderi", "çoklu görsel", "çok görselli gönderi"]) {
    assert.deepEqual(plain(format.resolveOutputSpecification(phrase, "educational")), {
      outputMode: "carousel",
      slideCount: 6,
    });
    assert.deepEqual(plain(format.resolveOutputSpecification(phrase, "listing")), {
      outputMode: "carousel",
      slideCount: 5,
    });
  }
});

test("valid associated slide counts win and preserve bounds", () => {
  for (const [phrase, outputMode, slideCount] of [
    ["1 slayt", "single", 1],
    ["2 slayt", "carousel", 2],
    ["5 slaytlık carousel", "carousel", 5],
    ["5 slide carousel", "carousel", 5],
    ["5 görsellik karusel", "carousel", 5],
    ["10 slides", "carousel", 10],
  ]) {
    assert.deepEqual(plain(format.resolveOutputSpecification(phrase, "listing")), { outputMode, slideCount });
  }
});

test("invalid counts are not clamped and mode defaults remain deterministic", () => {
  assert.deepEqual(plain(format.resolveOutputSpecification("0 slaytlık carousel", "educational")), {
    outputMode: "carousel",
    slideCount: 6,
  });
  assert.deepEqual(plain(format.resolveOutputSpecification("11 slaytlık carousel", "listing")), {
    outputMode: "carousel",
    slideCount: 5,
  });
  assert.deepEqual(plain(format.resolveOutputSpecification("11 slayt", "listing")), {
    outputMode: "single",
    slideCount: 1,
  });
});

test("topic, room, price, and year numbers never become slide counts", () => {
  for (const phrase of [
    "5 konu hakkında eğitici gönderi hazırla",
    "3 kritik hata hakkında eğitici içerik hazırla",
    "10 yatırım kuralı hakkında eğitici post yaz",
    "5 ipucu hakkında eğitici gönderi hazırla",
    "3+1 daire ilanı hazırla",
    "5 milyon TL konut ilanı hazırla",
    "2026 piyasa raporu hazırla",
  ]) {
    const built = plan.buildContentPlan(phrase);
    assert.notEqual(built.slideCount, 5, phrase.includes("5 ") && built.intent !== "educational" ? undefined : "topic count leaked");
    if (built.intent === "educational") assert.equal(built.slideCount, 6);
  }
});

test("Turkish casing and explicit-mode source order are deterministic", () => {
  assert.deepEqual(plain(format.resolveOutputSpecification("TEK GÖRSEL ÜRET", "educational")), {
    outputMode: "single",
    slideCount: 1,
  });
  assert.deepEqual(plain(format.resolveOutputSpecification("ÇOKLU GÖRSEL HAZIRLA", "listing")), {
    outputMode: "carousel",
    slideCount: 5,
  });
  assert.equal(format.resolveOutputSpecification("carousel hazırla, tek görsel üret", "educational").outputMode, "single");
  assert.equal(format.resolveOutputSpecification("tek görsel üret, carousel hazırla", "educational").outputMode, "carousel");
  assert.deepEqual(plain(format.resolveOutputSpecification("5 slaytlık carousel ama tek görsel", "educational")), {
    outputMode: "carousel",
    slideCount: 5,
  });
});

test("compatibility defaults remain unchanged", () => {
  assert.deepEqual(plain(format.resolveOutputSpecification("", "educational")), { outputMode: "carousel", slideCount: 6 });
  for (const contentIntent of ["listing", "comparison", "market-stats", "announcement", "none"]) {
    assert.deepEqual(plain(format.resolveOutputSpecification("", contentIntent)), { outputMode: "single", slideCount: 1 });
  }
});

test("live prompt is educational single/1 and planning is deterministic", () => {
  const first = plain(plan.buildContentPlan(LIVE_PROMPT));
  const second = plain(plan.buildContentPlan(LIVE_PROMPT));
  assert.deepEqual(first, second);
  assert.equal(first.intent, "educational");
  assert.equal(first.outputMode, "single");
  assert.equal(first.slideCount, 1);
});

test("intent remains independent from explicit output mode", () => {
  assert.equal(plan.buildContentPlan("Satılık daire için carousel hazırla").intent, "listing");
  assert.equal(plan.buildContentPlan("İki yatırım türünü karşılaştır, tek görsel üret").intent, "comparison");
  assert.equal(plan.buildContentPlan("Satılık daire için carousel hazırla").outputMode, "carousel");
  assert.equal(plan.buildContentPlan("İki yatırım türünü karşılaştır, tek görsel üret").outputMode, "single");
});

test("canonical mode and count control Content and Creative directives", () => {
  const livePlan = plan.buildContentPlan(LIVE_PROMPT);
  const liveBrief = brief.buildCreativeBrief(livePlan);
  const combined = `${contentDirective.buildContentDirective(livePlan)}\n${creativeDirective.buildCreativeDirective(liveBrief, livePlan.intent)}`;

  assert.match(combined, /tek görsel/iu);
  assert.doesNotMatch(combined, /(?:6|altı)\s+(?:slayt|bölüm)|her slaytta|tüm slaytlarda|slayt slayt|carousel\s*\(/iu);

  const carouselPlan = plan.buildContentPlan("Gayrimenkul hakkında 5 slaytlık carousel hazırla");
  const carouselBrief = brief.buildCreativeBrief(carouselPlan);
  const carouselCombined = `${contentDirective.buildContentDirective(carouselPlan)}\n${creativeDirective.buildCreativeDirective(carouselBrief, carouselPlan.intent)}`;
  assert.match(carouselCombined, /tam olarak 5 (?:slayt|bölüm\/slayt)/iu);
});

test("single Creative Brief removes legacy carousel wording", () => {
  const liveBrief = brief.buildCreativeBrief(plan.buildContentPlan(LIVE_PROMPT));
  const serialized = JSON.stringify(liveBrief);
  assert.doesNotMatch(serialized, /her slaytta|tüm slaytlarda|slayt slayt/iu);
  assert.equal(liveBrief.execution.structureConstraint, "tek görsel üret; ek slayt/bölüm ekleme");
});

test("carousel visual requests exit before every generation side effect", async () => {
  const calls = { brief: 0, image: 0, upload: 0, compose: 0, persist: 0 };
  const route = loadTypeScriptModule(
    "src/app/api/generate-visual/route.ts",
    (specifier) => ({
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
          from: () => { calls.persist += 1; return { insert: async () => ({ error: null }) }; },
        }),
      },
      "@/lib/ai/content/plan": { buildContentPlan: () => ({ intent: "educational", outputMode: "carousel", slideCount: 5 }) },
      "@/lib/ai/creative/brief": { buildCreativeBrief: () => { calls.brief += 1; return {}; } },
      "@/lib/ai/creative/image-prompt": { buildImagePrompt: () => "prompt" },
      "@/lib/ai/image/client": {
        generateImage: async () => { calls.image += 1; return {}; },
        nearestSupportedSize: () => "1024x1024",
      },
      "@/lib/ai/image/compose": { composeInstagramPost: async () => { calls.compose += 1; return Buffer.from(""); } },
      "@/lib/ai/image/templates/select": { selectVisualTemplateId: () => "educational" },
      "@/lib/supabase/storage": { uploadGeneratedImage: async () => { calls.upload += 1; return {}; } },
      "@/lib/ai/creative/caption": { buildPublishableCaption: (value) => value, extractEducationalPoints: () => undefined },
    })[specifier] ?? {},
    { Response, Buffer },
  );

  const response = await route.POST({ json: async () => ({ message: "5 slaytlık carousel hazırla" }) });
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.match(body.error, /carousel metni.*carousel görsel/iu);
  assert.deepEqual(calls, { brief: 0, image: 0, upload: 0, compose: 0, persist: 0 });
});

test("single visual requests continue through the existing generation boundary", async () => {
  const calls = { image: 0, upload: 0, compose: 0, persist: 0 };
  const route = loadTypeScriptModule(
    "src/app/api/generate-visual/route.ts",
    (specifier) => ({
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
          from: () => ({
            insert: async () => { calls.persist += 1; return { error: null }; },
          }),
        }),
      },
      "@/lib/ai/content/plan": {
        buildContentPlan: () => ({
          intent: "educational",
          outputMode: "single",
          slideCount: 1,
          template: { id: "EDUCATIONAL_CAROUSEL_01" },
        }),
      },
      "@/lib/ai/creative/brief": {
        buildCreativeBrief: () => ({
          execution: {
            aspectRatio: "1:1",
            dimensionsPx: "1080x1080",
            typographyHierarchy: "net",
            textPlacement: "orta",
            logoPlacement: "sağ alt",
            ctaVisualTreatment: "yok",
          },
        }),
      },
      "@/lib/ai/creative/image-prompt": { buildImagePrompt: () => "prompt" },
      "@/lib/ai/image/client": {
        generateImage: async () => { calls.image += 1; return { bytes: Buffer.from("base"), contentType: "image/png" }; },
        nearestSupportedSize: () => "1024x1024",
      },
      "@/lib/ai/image/compose": {
        composeInstagramPost: async () => { calls.compose += 1; return Buffer.from("final"); },
      },
      "@/lib/ai/image/templates/select": { selectVisualTemplateId: () => "educational" },
      "@/lib/supabase/storage": {
        uploadGeneratedImage: async () => {
          calls.upload += 1;
          return { url: `https://example.test/${calls.upload}.png` };
        },
      },
      "@/lib/ai/creative/caption": {
        buildPublishableCaption: (value) => value,
        extractEducationalPoints: () => undefined,
      },
    })[specifier] ?? {},
    { Response, Buffer },
  );

  const response = await route.POST({
    json: async () => ({ message: "Eğitici gönderi hazırla, tek görsel üret", content: "İçerik" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, { image: 1, upload: 2, compose: 1, persist: 1 });
});
