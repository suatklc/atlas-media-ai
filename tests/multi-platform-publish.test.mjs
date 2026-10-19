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

const PAGE_TOKEN = "SECRET_PAGE_TOKEN";
const SLIDES = [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`);
const slideMeta = (order = [1, 2, 3, 4, 5]) => order.map((slide) => ({ slide, imageUrl: SLIDES[slide - 1] }));

// ===== publishSelectedPlatforms.ts (the one explicit publish action) =====

function loadOrchestrator({ status = "approved", metadata = {}, instagram, facebook }) {
  const calls = { instagram: 0, facebook: 0 };
  const facebookPublishState = loadTypeScriptModule("src/lib/publishing/publishFacebookPost.ts", () => ({}), { Date });
  const mod = loadTypeScriptModule(
    "src/lib/publishing/publishSelectedPlatforms.ts",
    (s) =>
      ({
        "./publishGeneratedPost": {
          publishGeneratedPost: async () => (calls.instagram++, instagram ?? { success: true }),
        },
        "./publishFacebookPost": {
          readFacebookPublishState: facebookPublishState.readFacebookPublishState,
          publishGeneratedPostToFacebook: async () => (calls.facebook++, facebook ?? { success: true, postId: "111_9" }),
        },
      })[s] ?? {},
    {},
  );
  const chain = { select: () => chain, eq: () => chain, single: async () => ({ data: { id: "p", status, metadata }, error: null }) };
  const supabase = { from: () => chain };
  return { mod, calls, supabase };
}

test("platform selection: only instagram/facebook, at least one, unknown values rejected", () => {
  const { mod } = loadOrchestrator({});
  assert.equal(mod.parseSelectedPlatforms([]), null);
  assert.equal(mod.parseSelectedPlatforms(["linkedin"]), null);
  assert.equal(mod.parseSelectedPlatforms(["facebook", "tiktok"]), null);
  assert.equal(mod.parseSelectedPlatforms(["facebook"]).join(","), "facebook");
  assert.equal(mod.parseSelectedPlatforms(["facebook", "instagram", "facebook"]).join(","), "instagram,facebook");
});

test("1. nothing publishes from a DRAFT — neither platform is even attempted", async () => {
  const { mod, calls, supabase } = loadOrchestrator({ status: "draft" });
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["instagram", "facebook"]);
  assert.match(result.error, /onaylanmadı/);
  assert.equal(calls.instagram + calls.facebook, 0);
});

test("2. Facebook is never published unless selected", async () => {
  const { mod, calls, supabase } = loadOrchestrator({});
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["instagram"]);
  assert.equal(calls.facebook, 0);
  assert.equal(result.results.map((r) => r.platform).join(","), "instagram");
});

test("3. Instagram is never published unless selected", async () => {
  const { mod, calls, supabase } = loadOrchestrator({});
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["facebook"]);
  assert.equal(calls.instagram, 0);
  assert.equal(result.results.map((r) => r.platform).join(","), "facebook");
});

test("7/8. per-platform outcomes — never a global success: Instagram published + Facebook failed are reported separately", async () => {
  const { mod, supabase } = loadOrchestrator({ facebook: { success: false, error: "Meta üzerinden yayınlama başarısız oldu." } });
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["instagram", "facebook"]);
  assert.equal(result.error, null);
  assert.equal(JSON.stringify(result.results.map((r) => [r.platform, r.status])), JSON.stringify([["instagram", "published"], ["facebook", "failed"]]));
});

test("9. a Facebook retry after a Facebook failure never re-publishes Instagram (status posted = already published)", async () => {
  const { mod, calls, supabase } = loadOrchestrator({ status: "posted", metadata: { publishResults: { facebook: { state: "failed", at: "x" } } } });
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["instagram", "facebook"]);
  assert.equal(calls.instagram, 0, "Instagram never called again");
  assert.equal(calls.facebook, 1);
  assert.equal(result.results[0].status, "already-published");
});

test("10. an Instagram failure never triggers an extra Facebook attempt; with only Instagram selected Facebook is untouched", async () => {
  const both = loadOrchestrator({ instagram: { success: false, error: "Meta üzerinden yayınlama başarısız oldu." } });
  const r1 = await both.mod.publishToSelectedPlatforms(both.supabase, "u", "p", ["instagram", "facebook"]);
  assert.equal(both.calls.instagram, 1);
  assert.equal(both.calls.facebook, 1, "Facebook runs exactly once, only because it was selected");
  assert.equal(r1.results[0].status, "failed");

  const igOnly = loadOrchestrator({ instagram: { success: false, error: "x" } });
  await igOnly.mod.publishToSelectedPlatforms(igOnly.supabase, "u", "p", ["instagram"]);
  assert.equal(igOnly.calls.facebook, 0);
});

test("idempotency: an already published Facebook post is reported, never re-published", async () => {
  const { mod, calls, supabase } = loadOrchestrator({ metadata: { publishResults: { facebook: { state: "published", at: "x", postId: "111_1" } } } });
  const result = await mod.publishToSelectedPlatforms(supabase, "u", "p", ["facebook"]);
  assert.equal(calls.facebook, 0);
  assert.equal(result.results[0].status, "already-published");
});

// ===== publishFacebookPost.ts: 5 slides, order, credential =====

const facebookText = loadTypeScriptModule("src/lib/ai/content/facebookText.ts");
const PKG = { caption: "Metin.\n\n#A #B", hashtags: ["#Zekeriyaköy", "#A"] };

function loadFacebook({ accounts, credential = PAGE_TOKEN, publishResult = { success: true, platform: "facebook", externalPostId: "111_9" } }) {
  const calls = { publish: [], logs: [] };
  const mod = loadTypeScriptModule(
    "src/lib/publishing/publishFacebookPost.ts",
    (s) =>
      ({
        "./router": { publishPost: async (request) => (calls.publish.push(request), publishResult) },
        "./connections/query": { listConnectedMetaAccounts: async () => accounts },
        "./connections/credentials": { getConnectedAccountCredential: async () => credential },
        "../ai/content/facebookText": facebookText,
        "../ai/context/businessProfile": { ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: [] } } },
      })[s] ?? {},
    { console: { error: (...args) => calls.logs.push(args) }, Date },
  );
  return { mod, calls };
}

function fakeDb(post) {
  const t = { row: post, updates: [] };
  const client = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: t.row, error: null }),
        update: (patch) => {
          t.updates.push(patch);
          t.row = { ...t.row, ...patch };
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
      return chain;
    },
  };
  return { client, t };
}

const PAGE = { id: "fb-1", platform: "facebook", externalAccountId: "111", hasCredential: true, selected: true, multiPhotoCheck: { ok: true, count: 5, checkedAt: "" } };
const post = (carouselImages, status = "approved") => ({
  id: "p",
  content: "c",
  final_image_url: SLIDES[0],
  status,
  metadata: { outputMode: "carousel", carouselImages, contentPackage: PKG },
});

test("5/6. Facebook requires exactly slides 1..5 — missing, duplicate, extra, insecure or single-image is refused before any Meta call", async () => {
  const { mod } = loadFacebook({ accounts: [PAGE] });
  assert.equal(mod.requireFacebookSlides(post(slideMeta()).metadata).join(" "), SLIDES.join(" "));
  const bad = [
    slideMeta([1, 2, 3, 4]),
    slideMeta([1, 2, 4, 5, 6].map((n) => Math.min(n, 5))),
    [...slideMeta(), { slide: 6, imageUrl: SLIDES[0] }],
    slideMeta().map((s, i) => (i === 2 ? { ...s, imageUrl: "http://insecure/3.png" } : s)),
  ];
  for (const images of bad) assert.equal(mod.requireFacebookSlides(post(images).metadata), null);
  assert.equal(mod.requireFacebookSlides({ outputMode: "single" }), null);

  for (const images of bad) {
    const fb = loadFacebook({ accounts: [PAGE] });
    const { client } = fakeDb(post(images));
    const result = await fb.mod.publishGeneratedPostToFacebook(client, "u", "p");
    assert.equal(result.success, false);
    assert.match(result.error, /5 carousel görselinin tamamı/);
    assert.equal(fb.calls.publish.length, 0, "no cover-only or reduced post");
  }
});

test("6. slide order is always 1→5, even when stored out of order", async () => {
  const fb = loadFacebook({ accounts: [PAGE] });
  const { client } = fakeDb(post(slideMeta([4, 2, 5, 1, 3])));
  const result = await fb.mod.publishGeneratedPostToFacebook(client, "u", "p");
  assert.equal(result.success, true);
  assert.equal(fb.calls.publish[0].carouselImageUrls.join(" "), SLIDES.join(" "));
});

test("4. Facebook requires a connected, selected Page with a stored credential", async () => {
  for (const setup of [{ accounts: [] }, { accounts: [{ ...PAGE, selected: false }] }, { accounts: [{ ...PAGE, hasCredential: false }] }, { accounts: [PAGE], credential: null }]) {
    const fb = loadFacebook(setup);
    const { client } = fakeDb(post(slideMeta()));
    const result = await fb.mod.publishGeneratedPostToFacebook(client, "u", "p");
    assert.equal(result.success, false);
    assert.equal(fb.calls.publish.length, 0);
  }
});

test("8. a Facebook failure is stored as failed, never published, and never touches generated_posts.status", async () => {
  const fb = loadFacebook({ accounts: [PAGE], publishResult: { success: false, platform: "facebook", error: "Meta üzerinden yayınlama başarısız oldu." } });
  const db = fakeDb(post(slideMeta()));
  const result = await fb.mod.publishGeneratedPostToFacebook(db.client, "u", "p");
  assert.equal(result.success, false);
  assert.equal(db.t.row.metadata.publishResults.facebook.state, "failed");
  assert.ok(db.t.updates.every((patch) => !("status" in patch)));
});

test("14. no token ever appears in a returned error/outcome or a log line", async () => {
  const fb = loadFacebook({ accounts: [PAGE], publishResult: { success: false, platform: "facebook", error: "Meta üzerinden yayınlama başarısız oldu." } });
  const db = fakeDb(post(slideMeta()));
  const result = await fb.mod.publishGeneratedPostToFacebook(db.client, "u", "p");
  assert.ok(!JSON.stringify(result).includes(PAGE_TOKEN));
  assert.ok(!JSON.stringify(fb.calls.logs).includes(PAGE_TOKEN));
  assert.ok(!JSON.stringify(db.t.row.metadata).includes(PAGE_TOKEN), "the token is never written into post metadata");
});

// ===== UI wiring =====

test("dashboard: the publish panel is shown only for approved/posted posts and gates Facebook on connection + 5 slides + passed check", () => {
  const history = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/GenerationHistory.tsx"), "utf8");
  assert.ok(history.includes('if (post.status !== "approved" && post.status !== "posted") return null;'));
  assert.ok(history.includes("requireFacebookSlides(post.metadata)"));
  assert.ok(history.includes("check?.ok && check.count >= 5"));
  assert.ok(history.includes('"Instagram hesabı bağlı değil."'));
  assert.ok(history.includes('"Facebook Sayfası bağlı değil."'));
});

test("Bağlı Hesaplar: a Facebook Page is rendered once (Facebook block), not again in the general list", () => {
  const ui = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/SocialAccounts.tsx"), "utf8");
  assert.ok(ui.includes('accounts.filter((account) => account.platform !== "facebook").map('));
});
