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

const contentPackageModule = loadTypeScriptModule("src/lib/ai/content/contentPackage.ts");
const draftEdit = loadTypeScriptModule("src/lib/ai/content/draftEdit.ts");
const SUPABASE_URL = "https://proj.supabase.co";
const BASE_IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/generated-visuals/u/base.png`;

function samplePackage(contentMode) {
  return {
    topic: "t",
    source: { name: "Suat Kılıç — uzman değerlendirmesi", url: "atlas:expert-content", publishedAt: "" },
    hook: "Kanca",
    caption: "Eski caption.\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı",
    hashtags: ["#Zekeriyaköy"],
    format: "carousel",
    slides: ["hook", "what-happened", "why-it-matters", "what-to-do", "cta"].map((role, i) => ({
      index: i + 1,
      role,
      headline: `H${i + 1}`,
      body: `B${i + 1}`,
      facts: i === 3 ? ["m1", "m2"] : [],
      visualBrief: `v${i + 1}`,
    })),
    facts: [],
    ...(contentMode ? { contentMode } : {}),
  };
}

function editBody(overrides = {}) {
  return {
    postId: "post-1",
    caption: "Yeni caption.",
    hashtags: "#VillaSatışı Zekeriyaköy, #Gayrimenkul",
    slides: [1, 2, 3, 4, 5].map((n) => ({
      headline: HEADLINES[n - 1],
      body: `Yeni B${n}`,
      facts: n === 4 ? ["Madde 1", "Madde 2", "Madde 3"] : [],
      emphasis: n === 1 ? "değerini göstermez" : "",
      cta: n === 5 ? "Bana yazın." : "",
    })),
    ...overrides,
  };
}

function loadEditRoute({ status = "draft", contentMode = "expert", updateRows = [{ id: "post-1" }] } = {}) {
  const state = { updatePayload: null, updateFilters: [], premiumCalls: 0, newsCalls: 0, uploads: 0, premiumText: null };
  const row = {
    id: "post-1",
    status,
    base_image_url: BASE_IMAGE_URL,
    metadata: { platform: "instagram", dimensions: "1080x1350", contentPackage: samplePackage(contentMode), carouselImages: [] },
  };
  const deps = {
    "next/server": {},
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
        from: () => {
          const filters = [];
          const builder = {
            select: () => builder,
            eq: (column, value) => {
              filters.push([column, value]);
              return builder;
            },
            maybeSingle: async () => ({ data: row, error: null }),
            update: (payload) => {
              state.updatePayload = payload;
              state.updateFilters = filters;
              return {
                eq: (column, value) => {
                  filters.push([column, value]);
                  const chain = {
                    eq: (c, v) => {
                      filters.push([c, v]);
                      return chain;
                    },
                    select: async () => ({ data: updateRows, error: null }),
                  };
                  return chain;
                },
              };
            },
          };
          return builder;
        },
      }),
    },
    "@/lib/ai/content/contentPackage": contentPackageModule,
    "@/lib/ai/content/draftEdit": draftEdit,
    "@/lib/ai/content/carouselSlides": {
      appendHashtagsToCaption: (caption, tags) => `${caption}\n\n${tags.join(" ")}`,
      buildNewsCarouselSlideText: () => ({ news: true }),
      buildPremiumCarouselText: (pkg) => ({ premium: true, pkg }),
    },
    "@/lib/ai/image/templates/carousel": {
      renderCarousel: async () => {
        state.newsCalls += 1;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`s${n}`));
      },
    },
    "@/lib/ai/image/templates/premiumCarousel": {
      renderPremiumCarousel: async (_bytes, _dims, text) => {
        state.premiumCalls += 1;
        state.premiumText = text;
        return [1, 2, 3, 4, 5].map((n) => Buffer.from(`p${n}`));
      },
    },
    "@/lib/ai/creative/caption": { buildPublishableCaption: (value) => value },
    "@/lib/ai/content/facebookText": loadTypeScriptModule("src/lib/ai/content/facebookText.ts"),
    "@/lib/ai/context/businessProfile": { ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: [] } } },
    "@/lib/supabase/storage": {
      GENERATED_VISUALS_BUCKET: "generated-visuals",
      uploadGeneratedImage: async () => {
        state.uploads += 1;
        return { url: `${SUPABASE_URL}/storage/v1/object/public/generated-visuals/u/new-${state.uploads}.png` };
      },
    },
  };
  const route = loadTypeScriptModule("src/app/api/drafts/edit/route.ts", (name) => deps[name] ?? {}, {
    Response,
    Buffer,
    console,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL } },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }),
  });
  return { route, state };
}

const HEADLINES = [
  "Villanız doğru anlatılmadan değerini göstermez",
  "Teklif gelmiyorsa önce teşhis gerekir",
  "Villa alıcısı yaşam biçimini satın alır",
  "Strateji alıcının bakışını netleştirir",
  "Fiyattan önce konumlandırma gelir",
];

const post = (route, body) => route.POST({ json: async () => body });

test("draft edit: saving an expert draft updates the SAME row, keeps it a draft, re-renders 5 premium slides", async () => {
  const { route, state } = loadEditRoute();
  const response = await post(route, editBody());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "draft");
  assert.equal(state.premiumCalls, 1);
  assert.equal(state.newsCalls, 0);
  assert.equal(state.uploads, 5);
  assert.equal(body.images.length, 5);
  // Never writes status; the update is filtered to this row, this owner, and status = draft.
  assert.equal("status" in state.updatePayload, false);
  const filters = state.updateFilters.map(([c, v]) => `${c}=${v}`);
  assert.ok(filters.includes("id=post-1"));
  assert.ok(filters.includes("user_id=user-1"));
  assert.ok(filters.includes("status=draft"));
  // Edited copy persisted: caption + parsed hashtags in content, package updated.
  assert.match(state.updatePayload.content, /^Yeni caption\.\n\n#VillaSatışı #Zekeriyaköy #Gayrimenkul$/);
  const saved = state.updatePayload.metadata.contentPackage;
  assert.equal(saved.slides[0].headline, HEADLINES[0]);
  assert.equal(saved.slides[0].emphasis, "değerini göstermez");
  assert.equal(saved.slides[4].cta, "Bana yazın.");
  assert.equal(saved.slides[3].facts.length, 3);
  assert.equal(saved.slides[3].role, "what-to-do"); // roles/index never editable
  assert.equal(saved.slides[0].visualBrief, "v1");
  assert.equal(saved.contentMode, "expert");
  assert.equal(state.updatePayload.metadata.platform, "instagram"); // other metadata preserved
  assert.equal(state.updatePayload.final_image_url, body.images[0].imageUrl);
});

test("draft edit: an approved or posted post can never be edited", async () => {
  for (const status of ["approved", "posted"]) {
    const { route, state } = loadEditRoute({ status });
    const response = await post(route, editBody());
    assert.equal(response.status, 409);
    assert.equal(state.updatePayload, null);
    assert.equal(state.uploads, 0);
  }
});

test("draft edit: if the row stopped being a draft before the write (concurrent approval), nothing is reported as saved", async () => {
  const { route } = loadEditRoute({ updateRows: [] });
  const response = await post(route, editBody());
  assert.equal(response.status, 409);
});

test("draft edit: news drafts re-render through the frozen news renderer", async () => {
  const { route, state } = loadEditRoute({ contentMode: null });
  const response = await post(route, editBody());
  assert.equal(response.status, 200);
  assert.equal(state.newsCalls, 1);
  assert.equal(state.premiumCalls, 0);
});

test("draft edit: invalid input is rejected before anything renders (not 5 slides, empty headline, >4 items, no hashtags)", async () => {
  const bad = [
    editBody({ slides: editBody().slides.slice(0, 4) }),
    editBody({ slides: editBody().slides.map((s, i) => (i === 2 ? { ...s, headline: "  " } : s)) }),
    editBody({ slides: editBody().slides.map((s, i) => (i === 3 ? { ...s, facts: ["1", "2", "3", "4", "5"] } : s)) }),
    editBody({ hashtags: "   " }),
    editBody({ caption: "" }),
  ];
  for (const body of bad) {
    const { route, state } = loadEditRoute();
    const response = await post(route, body);
    assert.equal(response.status, 400);
    assert.equal(state.uploads, 0);
    assert.equal(state.updatePayload, null);
  }
});

test("draftEdit: a cleared emphasis/CTA is removed, not kept from the previous version", () => {
  const original = samplePackage("expert");
  original.slides[0].emphasis = "eski";
  original.slides[4].cta = "eski cta";
  const edit = draftEdit.parseDraftEdit(editBody({ slides: editBody().slides.map((s) => ({ ...s, emphasis: "", cta: "" })) }));
  const merged = draftEdit.applyDraftEdit(original, edit);
  assert.equal(merged.slides[0].emphasis, undefined);
  assert.equal(merged.slides[4].cta, undefined);
});

test("dashboard: 'Düzenle' is offered only for draft carousel posts with a stored ContentPackage, and calls the edit route", () => {
  const history = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/GenerationHistory.tsx"), "utf8");
  assert.match(history, /post\.status !== "draft"/);
  assert.match(history, /isContentPackage\(contentPackage\)/);
  const editor = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/DraftEditor.tsx"), "utf8");
  assert.match(editor, />\s*Düzenle\s*</);
  assert.match(editor, /fetch\("\/api\/drafts\/edit"/);
  assert.doesNotMatch(editor, /updatePostStatus|publishApprovedPost/);
});
