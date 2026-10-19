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
const USER_TOKEN = "SECRET_USER_TOKEN";
const SLIDES = [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`);
const leaks = (value) => /SECRET_/.test(typeof value === "string" ? value : JSON.stringify(value));

function capturingConsole() {
  const calls = [];
  return { console: { error: (...args) => calls.push(args), log: () => {}, warn: () => {} }, calls };
}

function sequencedFetch(responses) {
  const calls = [];
  let index = 0;
  return {
    calls,
    fetch: async (url, options = {}) => {
      calls.push({ url: url.toString(), options });
      const resp = responses[index++];
      if (!resp) throw new Error("test setup: no mock response queued");
      return { ok: resp.ok ?? true, status: resp.status ?? (resp.ok === false ? 400 : 200), json: async () => resp.body };
    },
  };
}

function loadMetaGraph(fetchImpl, cc) {
  return loadTypeScriptModule(
    "src/lib/publishing/connections/meta-graph.ts",
    (s) => (s === "./meta-oauth" ? { META_GRAPH_API_VERSION: "v25.0" } : {}),
    { fetch: fetchImpl, URL, FormData, console: cc.console, setTimeout },
  );
}

function loadFacebookGraph(fetchImpl, cc = capturingConsole(), env = {}) {
  const metaGraph = loadMetaGraph(fetchImpl, cc);
  const facebookGraph = loadTypeScriptModule(
    "src/lib/publishing/connections/facebook-graph.ts",
    (s) => ({ "./meta-oauth": { META_GRAPH_API_VERSION: "v25.0" }, "./meta-graph": metaGraph })[s] ?? {},
    { fetch: fetchImpl, URL, URLSearchParams, console: cc.console, process: { env } },
  );
  return { module: facebookGraph, metaGraph, cc };
}

// ===== facebook-graph.ts =====

test("facebook-graph: the login URL uses Facebook Login for Business config_id 2981606105549106 — no scope parameter", () => {
  const { module } = loadFacebookGraph(async () => {
    throw new Error("no network");
  });
  assert.equal(module.FACEBOOK_LOGIN_CONFIG_ID, "2981606105549106");
  const url = new URL(
    module.buildFacebookAuthorizationUrl({ appId: "APP", redirectUri: "https://atlas-media-ai.vercel.app/api/facebook/callback", state: "st", configId: module.FACEBOOK_LOGIN_CONFIG_ID }),
  );
  assert.equal(url.origin + url.pathname, "https://www.facebook.com/v25.0/dialog/oauth");
  assert.equal(url.searchParams.get("config_id"), "2981606105549106");
  assert.equal(url.searchParams.get("client_id"), "APP");
  assert.equal(url.searchParams.get("redirect_uri"), "https://atlas-media-ai.vercel.app/api/facebook/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.has("scope"), false);
});

test("facebook-graph: code exchange + long-lived exchange hit graph.facebook.com oauth/access_token with the documented params", async () => {
  const { fetch, calls } = sequencedFetch([{ body: { access_token: "SECRET_SHORT" } }, { body: { access_token: USER_TOKEN, expires_in: 5184000 } }]);
  const { module } = loadFacebookGraph(fetch);
  const short = await module.exchangeFacebookCode({ appId: "APP", appSecret: "SECRET_APP", redirectUri: "https://x/cb", code: "CODE" });
  const long = await module.exchangeFacebookLongLivedUserToken({ appId: "APP", appSecret: "SECRET_APP", userToken: short });
  assert.equal(long, USER_TOKEN);
  const first = new URL(calls[0].url);
  assert.equal(first.origin + first.pathname, "https://graph.facebook.com/v25.0/oauth/access_token");
  assert.equal(first.searchParams.get("code"), "CODE");
  const second = new URL(calls[1].url);
  assert.equal(second.searchParams.get("grant_type"), "fb_exchange_token");
  assert.equal(second.searchParams.get("fb_exchange_token"), "SECRET_SHORT");
});

test("facebook-graph: Page discovery uses /me/accounts with a Bearer user token and keeps only CREATE_CONTENT pages usable", async () => {
  const { fetch, calls } = sequencedFetch([
    {
      body: {
        data: [
          { id: "111", name: "Suat Kılıç Gayrimenkul", access_token: PAGE_TOKEN, tasks: ["ANALYZE", "CREATE_CONTENT", "MANAGE"] },
          { id: "222", name: "Only Analyst", access_token: "SECRET_OTHER", tasks: ["ANALYZE"] },
          { id: "333", name: "No token" },
        ],
      },
    },
  ]);
  const { module } = loadFacebookGraph(fetch);
  const pages = await module.listManagedFacebookPages(USER_TOKEN);
  assert.equal(calls[0].url, "https://graph.facebook.com/v25.0/me/accounts?fields=id,name,access_token,tasks&limit=100");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${USER_TOKEN}`);
  assert.ok(!calls[0].url.includes("SECRET"));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].canCreateContent, true);
  assert.equal(pages[1].canCreateContent, false);
});

test("facebook-graph: publishFacebookPagePhotos uploads every image unpublished, then ONE published feed post attaching them in order", async () => {
  const { fetch, calls } = sequencedFetch([
    ...SLIDES.map((_, i) => ({ body: { id: `photo-${i + 1}` } })),
    { body: { id: "111_999" } },
  ]);
  const { module } = loadFacebookGraph(fetch);
  const postId = await module.publishFacebookPagePhotos({ pageId: "111", pageToken: PAGE_TOKEN, message: "Facebook metni", imageUrls: SLIDES });
  assert.equal(postId, "111_999");
  const uploads = calls.slice(0, 5);
  uploads.forEach((call, i) => {
    assert.equal(call.url, "https://graph.facebook.com/v25.0/111/photos");
    const body = new URLSearchParams(call.options.body.toString());
    assert.equal(body.get("published"), "false");
    assert.equal(body.get("url"), SLIDES[i]);
    assert.equal(call.options.headers.Authorization, `Bearer ${PAGE_TOKEN}`);
    assert.ok(!call.options.body.toString().includes("SECRET"), "token only in the header");
  });
  const feed = calls[5];
  assert.equal(feed.url, "https://graph.facebook.com/v25.0/111/feed");
  const body = new URLSearchParams(feed.options.body.toString());
  assert.equal(body.get("published"), "true");
  assert.equal(body.get("message"), "Facebook metni");
  for (let i = 0; i < 5; i += 1) assert.equal(body.get(`attached_media[${i}]`), JSON.stringify({ media_fbid: `photo-${i + 1}` }));
});

test("facebook-graph: getPostPhotoIds reads subattachment targets in order", async () => {
  const { fetch } = sequencedFetch([
    { body: { attachments: { data: [{ subattachments: { data: [{ target: { id: "p1" } }, { target: { id: "p2" } }, { target: { id: "p3" } }] } }] } } },
  ]);
  const { module } = loadFacebookGraph(fetch);
  assert.equal((await module.getPostPhotoIds({ postId: "111_1", pageToken: PAGE_TOKEN })).join(","), "p1,p2,p3");
});

test("facebook-graph: a Meta error logs stage/status/code/subcode/type/fbtrace_id — never a token", async () => {
  const cc = capturingConsole();
  const { fetch } = sequencedFetch([
    { ok: false, status: 400, body: { error: { message: "(#200) permission", type: "OAuthException", code: 200, error_subcode: 1234, fbtrace_id: "TRACE1" } } },
  ]);
  const { module, metaGraph } = loadFacebookGraph(fetch, cc);
  await assert.rejects(
    () => module.uploadUnpublishedPagePhoto({ pageId: "111", pageToken: PAGE_TOKEN, imageUrl: SLIDES[0] }),
    (error) => error instanceof metaGraph.MetaGraphApiError && error.details.fbtraceId === "TRACE1",
  );
  const line = cc.calls[0][0];
  for (const part of ["stage=facebook fotoğraf yükleme", "status=400", "code=200", "subcode=1234", "type=OAuthException", "fbtrace_id=TRACE1"]) {
    assert.ok(line.includes(part), part);
  }
  assert.ok(!leaks(cc.calls));
});

// ===== providers/meta.ts: Facebook branch =====

test("providers/meta: a Facebook request publishes all carousel images through the Page flow and returns the post id", async () => {
  let received = null;
  const provider = loadTypeScriptModule(
    "src/lib/publishing/providers/meta.ts",
    (s) =>
      ({
        "../connections/meta-graph": { MetaGraphApiError: class extends Error {} },
        "../connections/facebook-graph": {
          publishFacebookPagePhotos: async (input) => {
            received = input;
            return "111_999";
          },
        },
      })[s] ?? {},
    { console },
  );
  const result = await provider.publishToMeta({ platform: "facebook", caption: "fb", imageUrl: SLIDES[0], carouselImageUrls: SLIDES, externalAccountId: "111", accessToken: PAGE_TOKEN });
  assert.equal(result.success, true);
  assert.equal(result.externalPostId, "111_999");
  assert.equal(received.pageId, "111");
  assert.equal(received.imageUrls.join(" "), SLIDES.join(" "));
});

// ===== facebookText.ts =====

const facebookText = loadTypeScriptModule("src/lib/ai/content/facebookText.ts");
const PKG = {
  caption: "Zekeriyaköy’de bir villayı satmak #Villa ilanla bitmez.\n\nBen önce alıcıya bakarım.\n\n#Zekeriyaköy #VillaSatışı #Gayrimenkul\n\nSuat Kılıç\nGayrimenkul Yatırım Danışmanı",
  hashtags: ["#VillaSatışı", "#Gayrimenkul", "#Zekeriyaköy", "#MüstakilYaşam"],
};

test("facebookText: strips Instagram hashtags from the caption, keeps the signature, adds at most 2 tags (region first)", () => {
  const text = facebookText.buildFacebookText(PKG, "Zekeriyaköy");
  assert.ok(text.startsWith("Zekeriyaköy’de bir villayı satmak ilanla bitmez."));
  assert.ok(text.includes("Suat Kılıç\nGayrimenkul Yatırım Danışmanı"));
  const tags = text.match(/#[^\s#]+/g);
  assert.deepEqual([...tags], ["#Zekeriyaköy", "#VillaSatışı"]);
  assert.ok(!/\n{3,}/.test(text));
});

test("facebookText: Suat's stored Facebook text always wins; otherwise the package default; otherwise the caption", () => {
  assert.equal(facebookText.resolveFacebookText({ platformText: { facebook: " Özel metin " }, contentPackage: PKG }, "c"), "Özel metin");
  assert.ok(facebookText.resolveFacebookText({ platformText: { facebook: null }, contentPackage: PKG }, "c", "Zekeriyaköy").includes("#Zekeriyaköy"));
  assert.equal(facebookText.resolveFacebookText({}, "fallback caption"), "fallback caption");
});

test("draftEdit: facebookText is optional — absent = unchanged, empty = reset to default, text = stored", () => {
  const draftEdit = loadTypeScriptModule("src/lib/ai/content/draftEdit.ts");
  const base = {
    caption: "c",
    hashtags: "#a",
    slides: [1, 2, 3, 4, 5].map((n) => ({ headline: `H${n}`, body: `B${n}`, facts: [] })),
  };
  assert.equal("facebookText" in draftEdit.parseDraftEdit(base), false);
  assert.equal(draftEdit.parseDraftEdit({ ...base, facebookText: "  " }).facebookText, "");
  assert.equal(draftEdit.parseDraftEdit({ ...base, facebookText: "FB" }).facebookText, "FB");
  assert.equal(typeof draftEdit.parseDraftEdit({ ...base, facebookText: "x".repeat(5001) }), "string");
});

// ===== publishFacebookPost.ts =====

function fakeSupabase(post) {
  const t = { updates: [], postRow: post };
  const client = {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: table === "generated_posts" ? t.postRow : null, error: t.postRow ? null : { message: "x" } }),
        update: (patch) => {
          t.updates.push(patch);
          if (patch.metadata) t.postRow = { ...t.postRow, metadata: patch.metadata };
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
      return chain;
    },
  };
  return { client, t };
}

function loadFacebookPublisher({ accounts, publishResult = { success: true, platform: "facebook", externalPostId: "111_999" } }) {
  const calls = { publish: [], credential: [] };
  const publishGeneratedPost = loadTypeScriptModule(
    "src/lib/publishing/publishGeneratedPost.ts",
    () => ({}),
    {},
  );
  const mod = loadTypeScriptModule(
    "src/lib/publishing/publishFacebookPost.ts",
    (s) =>
      ({
        "./router": {
          publishPost: async (request) => {
            calls.publish.push(request);
            return publishResult;
          },
        },
        "./connections/query": { listConnectedMetaAccounts: async () => accounts },
        "./connections/credentials": {
          getConnectedAccountCredential: async (_s, id) => {
            calls.credential.push(id);
            return PAGE_TOKEN;
          },
        },
        "./publishGeneratedPost": publishGeneratedPost,
        "../ai/content/facebookText": facebookText,
        "../ai/context/businessProfile": { ATLAS_DEFAULT_BUSINESS_PROFILE: { geography: { primary: "Zekeriyaköy", nearby: [] } } },
      })[s] ?? {},
    { console: capturingConsole().console, Date },
  );
  return { mod, calls };
}

const IG_ACCOUNT = { id: "ig-1", platform: "instagram", externalAccountId: "1784", hasCredential: true };
const FB_PAGE = (check) => ({ id: "fb-1", platform: "facebook", externalAccountId: "111", externalAccountName: "Suat Kılıç", hasCredential: true, selected: true, multiPhotoCheck: check });
const carouselPost = (status, extra = {}) => ({
  id: "post-1",
  content: "Instagram caption #a",
  final_image_url: SLIDES[0],
  status,
  metadata: { platform: "instagram", outputMode: "carousel", carouselImages: SLIDES.map((imageUrl, i) => ({ slide: i + 1, imageUrl })), contentPackage: PKG, instagramMediaId: "ig-media", ...extra },
});

test("Facebook publish: a DRAFT is never published to Facebook (explicit approval required)", async () => {
  const { mod, calls } = loadFacebookPublisher({ accounts: [FB_PAGE({ ok: true, count: 5 })] });
  const { client } = fakeSupabase(carouselPost("draft"));
  const result = await mod.publishGeneratedPostToFacebook(client, "u", "post-1");
  assert.equal(result.success, false);
  assert.equal(calls.publish.length, 0);
});

test("Facebook publish: an approved (or Instagram-posted) carousel publishes all 5 images in order with the Facebook text and the PAGE token, tracked separately", async () => {
  const { mod, calls } = loadFacebookPublisher({ accounts: [IG_ACCOUNT, FB_PAGE({ ok: true, count: 5 })] });
  const { client, t } = fakeSupabase(carouselPost("posted"));
  const result = await mod.publishGeneratedPostToFacebook(client, "u", "post-1");
  assert.equal(result.success, true);
  const request = calls.publish[0];
  assert.equal(request.platform, "facebook");
  assert.equal(request.externalAccountId, "111");
  assert.equal(request.accessToken, PAGE_TOKEN);
  assert.deepEqual(calls.credential, ["fb-1"], "the Facebook Page credential, never Instagram's");
  assert.equal(request.carouselImageUrls.join(" "), SLIDES.join(" "));
  assert.ok(request.caption.includes("#Zekeriyaköy") && !request.caption.includes("#Gayrimenkul"), "Facebook text, not the Instagram caption");
  // Never touches generated_posts.status; Instagram metadata preserved.
  assert.ok(t.updates.every((patch) => !("status" in patch)));
  const finalState = t.postRow.metadata.publishResults.facebook;
  assert.equal(finalState.state, "published");
  assert.equal(finalState.postId, "111_999");
  assert.equal(t.postRow.metadata.instagramMediaId, "ig-media");
  assert.equal(t.updates[0].metadata.publishResults.facebook.state, "publishing", "lock written before the Meta call");
});

test("Facebook publish: an already-published post is never published again; a fresh 'publishing' lock blocks a double click", async () => {
  for (const state of [{ state: "published", at: new Date().toISOString(), postId: "111_1" }, { state: "publishing", at: new Date().toISOString() }]) {
    const { mod, calls } = loadFacebookPublisher({ accounts: [FB_PAGE({ ok: true, count: 5 })] });
    const { client } = fakeSupabase(carouselPost("approved", { publishResults: { facebook: state } }));
    const result = await mod.publishGeneratedPostToFacebook(client, "u", "post-1");
    assert.equal(result.success, false);
    assert.equal(calls.publish.length, 0);
  }
});

test("Facebook publish: a failure is recorded as 'failed' (never success) and is retryable; a stale lock does not block retry", async () => {
  const failing = loadFacebookPublisher({ accounts: [FB_PAGE({ ok: true, count: 5 })], publishResult: { success: false, platform: "facebook", error: "Meta üzerinden yayınlama başarısız oldu." } });
  const db = fakeSupabase(carouselPost("approved"));
  const first = await failing.mod.publishGeneratedPostToFacebook(db.client, "u", "post-1");
  assert.equal(first.success, false);
  assert.equal(db.t.postRow.metadata.publishResults.facebook.state, "failed");

  const retry = loadFacebookPublisher({ accounts: [FB_PAGE({ ok: true, count: 5 })] });
  const second = await retry.mod.publishGeneratedPostToFacebook(db.client, "u", "post-1");
  assert.equal(second.success, true);

  const stale = loadFacebookPublisher({ accounts: [FB_PAGE({ ok: true, count: 5 })] });
  const staleDb = fakeSupabase(carouselPost("approved", { publishResults: { facebook: { state: "publishing", at: new Date(Date.now() - 10 * 60 * 1000).toISOString() } } }));
  assert.equal((await stale.mod.publishGeneratedPostToFacebook(staleDb.client, "u", "post-1")).success, true);
});

test("Facebook publish: a 5-image post is blocked until the non-public multi-photo check passed for >= 5 photos — never reduced to fewer images", async () => {
  for (const check of [null, { ok: false, count: 0, checkedAt: "", error: "x" }, { ok: true, count: 4, checkedAt: "" }]) {
    const { mod, calls } = loadFacebookPublisher({ accounts: [FB_PAGE(check)] });
    const { client } = fakeSupabase(carouselPost("approved"));
    const result = await mod.publishGeneratedPostToFacebook(client, "u", "post-1");
    assert.equal(result.success, false);
    assert.match(result.error, /testi/);
    assert.equal(calls.publish.length, 0);
  }
});

test("Facebook publish: no selected Facebook Page = safe failure (an unselected Page is never used)", async () => {
  const { mod, calls } = loadFacebookPublisher({ accounts: [IG_ACCOUNT, { ...FB_PAGE({ ok: true, count: 5 }), selected: false }] });
  const { client } = fakeSupabase(carouselPost("approved"));
  const result = await mod.publishGeneratedPostToFacebook(client, "u", "post-1");
  assert.equal(result.success, false);
  assert.equal(calls.publish.length, 0);
});

// ===== facebookCapability.ts (non-public 5-image check) =====

function loadCapability({ graph, accounts = [FB_PAGE(null)], posts }) {
  const merged = [];
  const publishGeneratedPost = loadTypeScriptModule("src/lib/publishing/publishGeneratedPost.ts", () => ({}), {});
  const mod = loadTypeScriptModule(
    "src/lib/publishing/facebookCapability.ts",
    (s) =>
      ({
        "./connections/query": {
          listConnectedMetaAccounts: async () => accounts,
          mergeConnectedAccountMetadata: async (_s, _u, id, patch) => merged.push([id, patch]),
        },
        "./connections/credentials": { getConnectedAccountCredential: async () => PAGE_TOKEN },
        "./connections/meta-graph": { MetaGraphApiError: class extends Error {} },
        "./connections/facebook-graph": graph,
        "./publishGeneratedPost": publishGeneratedPost,
        "./publishFacebookPost": { selectedFacebookPage: (list) => list.find((a) => a.platform === "facebook" && a.selected && a.hasCredential) },
      })[s] ?? {},
    { console: capturingConsole().console, Date },
  );
  const supabase = {
    from: () => {
      const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: async () => ({ data: posts }) };
      return chain;
    },
  };
  return { mod, merged, supabase };
}

const realCarouselRow = { metadata: { outputMode: "carousel", carouselImages: SLIDES.map((imageUrl, i) => ({ slide: i + 1, imageUrl })) } };

test("Facebook check: uploads the 5 real Atlas slides unpublished, creates ONLY an unpublished post, verifies order, deletes it, stores ok", async () => {
  const log = [];
  let uploaded = 0;
  const graph = {
    uploadUnpublishedPagePhoto: async ({ imageUrl }) => (log.push(["upload", imageUrl]), `photo-${++uploaded}`),
    createPageFeedPost: async (input) => (log.push(["feed", input.published, input.photoIds.join(",")]), "111_test"),
    getPostPhotoIds: async () => ["photo-1", "photo-2", "photo-3", "photo-4", "photo-5"],
    deleteGraphObject: async ({ id }) => log.push(["delete", id]),
  };
  const { mod, merged, supabase } = loadCapability({ graph, posts: [{ metadata: {} }, realCarouselRow] });
  const result = await mod.runFacebookMultiPhotoCheck(supabase, "u");
  assert.equal(result.ok, true);
  assert.equal(result.count, 5);
  assert.deepEqual(log.filter((e) => e[0] === "upload").map((e) => e[1]), SLIDES);
  const feeds = log.filter((e) => e[0] === "feed");
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0][1], false, "the check can never create a published post");
  assert.equal(log.find((e) => e[0] === "delete")[1], "111_test", "the unpublished test post is deleted first");
  assert.equal(merged[0][1].multiPhotoCheck.ok, true);
});

test("Facebook check: fewer attachments or a Meta error is stored as a failed check (publishing stays blocked), test content still cleaned up", async () => {
  const deleted = [];
  const short = {
    uploadUnpublishedPagePhoto: async ({ imageUrl }) => `id-${imageUrl.slice(-5, -4)}`,
    createPageFeedPost: async () => "111_test",
    getPostPhotoIds: async () => ["id-1", "id-2", "id-3", "id-4"],
    deleteGraphObject: async ({ id }) => deleted.push(id),
  };
  const a = loadCapability({ graph: short, posts: [realCarouselRow] });
  const r1 = await a.mod.runFacebookMultiPhotoCheck(a.supabase, "u");
  assert.equal(r1.ok, false);
  assert.equal(r1.count, 4);
  assert.ok(deleted.includes("111_test"));

  const failing = { ...short, createPageFeedPost: async () => { throw new Error("(#100) attached_media limit"); } };
  const b = loadCapability({ graph: failing, posts: [realCarouselRow] });
  const r2 = await b.mod.runFacebookMultiPhotoCheck(b.supabase, "u");
  assert.equal(r2.ok, false);
  assert.match(r2.error, /attached_media/);
  assert.equal(b.merged[0][1].multiPhotoCheck.ok, false);
});

// ===== OAuth routes =====

function loadCallback({ state = { cookie: "S", param: "S" }, pages, exchangeError, env = { META_APP_ID: "APP", META_APP_SECRET: "SECRET_APP", NEXT_PUBLIC_SITE_URL: "https://atlas-media-ai.vercel.app" } }) {
  const t = { upserts: [], merges: [], deleted: [] };
  const route = loadTypeScriptModule(
    "src/app/api/facebook/callback/route.ts",
    (s) =>
      ({
        "next/server": { NextResponse: { redirect: (url, status) => ({ status, location: url.toString() }) } },
        "next/headers": {
          cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined), delete: (name) => t.deleted.push(name) }),
        },
        "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u" } } }) } }) },
        "@/lib/publishing/connections/meta-graph": { MetaGraphApiError: class extends Error {} },
        "@/lib/publishing/connections/facebook-graph": {
          exchangeFacebookCode: async () => {
            if (exchangeError) throw new Error("boom");
            return "SECRET_SHORT";
          },
          exchangeFacebookLongLivedUserToken: async () => USER_TOKEN,
          listManagedFacebookPages: async () => pages,
        },
        "@/lib/publishing/connections/query": {
          upsertConnectedMetaAccount: async (_s, input) => (t.upserts.push(input), { success: true, id: `row-${input.externalAccountId}` }),
          mergeConnectedAccountMetadata: async (_s, _u, id, patch) => (t.merges.push([id, patch]), true),
        },
        "@/lib/publishing/connections/oauth-state": {
          FACEBOOK_OAUTH_STATE_COOKIE: "atlas_facebook_oauth_state",
          isValidOAuthState: (a, b) => Boolean(a) && a === b,
        },
      })[s] ?? {},
    { console: capturingConsole().console, process: { env }, URL, Response },
  );
  const call = (params) => route.GET({ url: `https://atlas-media-ai.vercel.app/api/facebook/callback?${new URLSearchParams({ state: state.param ?? "", ...params })}` });
  return { call, t };
}

const status = (response) => new URL(response.location).searchParams.get("facebook_connection");

test("Facebook callback: invalid state, denial or missing code create nothing (Instagram untouched)", async () => {
  const bad = loadCallback({ state: { cookie: "S", param: "OTHER" }, pages: [] });
  assert.equal(status(await bad.call({ code: "C" })), "invalid_state");
  assert.deepEqual(bad.t.deleted, ["atlas_facebook_oauth_state"]);
  const denied = loadCallback({ pages: [] });
  assert.equal(status(await denied.call({ error: "access_denied" })), "denied");
  const noCode = loadCallback({ pages: [] });
  assert.equal(status(await noCode.call({})), "invalid_callback");
  for (const c of [bad, denied, noCode]) assert.equal(c.t.upserts.length, 0);
});

test("Facebook callback: one manageable Page is stored as platform 'facebook' with its PAGE token and auto-selected", async () => {
  const { call, t } = loadCallback({
    pages: [
      { id: "111", name: "Suat Kılıç Gayrimenkul", accessToken: PAGE_TOKEN, canCreateContent: true },
      { id: "222", name: "Analyst only", accessToken: "SECRET_X", canCreateContent: false },
    ],
  });
  assert.equal(status(await call({ code: "C" })), "success");
  assert.equal(t.upserts.length, 1);
  assert.equal(t.upserts[0].platform, "facebook");
  assert.equal(t.upserts[0].accessToken, PAGE_TOKEN);
  assert.equal(t.upserts[0].tokenExpiresAt, null);
  assert.ok(t.upserts.every((u) => u.platform !== "instagram"));
  assert.equal(JSON.stringify(t.merges), JSON.stringify([["row-111", { selected: true }]]));
});

test("Facebook callback: several Pages are stored unselected and Suat is asked to choose; token/no-page failures create nothing", async () => {
  const many = loadCallback({
    pages: [
      { id: "111", name: "A", accessToken: PAGE_TOKEN, canCreateContent: true },
      { id: "222", name: "B", accessToken: "SECRET_B", canCreateContent: true },
    ],
  });
  assert.equal(status(await many.call({ code: "C" })), "select_page");
  assert.equal(many.t.upserts.length, 2);
  assert.equal(many.t.merges.length, 0);

  const none = loadCallback({ pages: [] });
  assert.equal(status(await none.call({ code: "C" })), "no_pages");
  const broken = loadCallback({ pages: [], exchangeError: true });
  assert.equal(status(await broken.call({ code: "C" })), "token_error");
  const unconfigured = loadCallback({ pages: [], env: { NEXT_PUBLIC_SITE_URL: "https://atlas-media-ai.vercel.app" } });
  assert.equal(status(await unconfigured.call({ code: "C" })), "not_configured");
  for (const c of [none, broken, unconfigured]) assert.equal(c.t.upserts.length, 0);
});

test("Facebook connect: separate route + state cookie scoped to /api/facebook (never the Instagram flow's)", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/app/api/facebook/connect/route.ts"), "utf8");
  assert.match(source, /FACEBOOK_OAUTH_STATE_COOKIE/);
  assert.match(source, /oauthStateCookieOptions\("\/api\/facebook"\)/);
  assert.match(source, /process\.env\.META_APP_ID/);
  assert.doesNotMatch(source, /INSTAGRAM_APP_ID/);
  const state = loadTypeScriptModule("src/lib/publishing/connections/oauth-state.ts", () => ({}), { process: { env: {} }, crypto });
  assert.equal(state.oauthStateCookieOptions().path, "/api/meta", "Instagram flow unchanged");
  assert.equal(state.oauthStateCookieOptions("/api/facebook").path, "/api/facebook");
});

test("dashboard: publishing is one explicit, selection-driven step; approval (StatusAction) never publishes", () => {
  const status = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/StatusAction.tsx"), "utf8");
  assert.doesNotMatch(status, /publishSelectedPlatformsAction|publishApprovedPost|Facebook'ta Paylaş/);
  assert.ok(status.includes('status === "draft" && ('), "only drafts get a button (Onayla)");
  const panel = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/PublishPanel.tsx"), "utf8");
  assert.ok(panel.includes("useState<Platform[]>([])"), "nothing pre-selected");
  assert.match(panel, /Seçili Platformlarda Yayınla/);
  assert.ok(panel.includes("disabled={isPending || selected.length === 0}"), "cannot submit with no platform ticked");
  const actions = fs.readFileSync(path.join(projectRoot, "src/app/dashboard/actions.ts"), "utf8");
  assert.ok(actions.includes('parseSelectedPlatforms(formData.getAll("platform"))'), "platforms come only from the ticked boxes");
  assert.doesNotMatch(actions, /export async function publishApprovedPost|export async function publishToFacebookAction/, "no second publish path");
});
