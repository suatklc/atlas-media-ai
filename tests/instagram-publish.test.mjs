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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { module: loadedModule, exports: loadedModule.exports, require: dependencyLoader, ...globals };
  vm.runInNewContext(
    `(function (module, exports, require) { ${output}\n})(module, exports, require);`,
    context,
  );
  return loadedModule.exports;
}

const SECRET_ACCESS_TOKEN = "SUPER_SECRET_VAULT_ACCESS_TOKEN";
const SECRET_IMAGE_URL = "https://storage.example.test/posts/atlas-post.png";

function containsSecret(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.includes(SECRET_ACCESS_TOKEN);
}

function makeCapturingConsole() {
  const calls = [];
  return { console: { error: (...args) => calls.push(args), log: () => {}, warn: () => {} }, calls };
}

// ===== meta-graph.ts: real content-publishing Graph API calls =====

function loadMetaGraph(fetchImpl, capturingConsole) {
  return loadTypeScriptModule(
    "src/lib/publishing/connections/meta-graph.ts",
    (specifier) => (specifier === "./meta-oauth" ? { META_GRAPH_API_VERSION: "v25.0" } : {}),
    { fetch: fetchImpl, URL, FormData, console: capturingConsole.console },
  );
}

function makeSequencedFetch(responses) {
  let call = 0;
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url: url.toString(), options });
      const resp = responses[call++];
      if (!resp) throw new Error("test setup error: no mock response queued");
      return { ok: resp.ok, status: resp.status ?? (resp.ok ? 200 : 400), json: async () => resp.body };
    },
  };
}

test("meta-graph: createInstagramMediaContainer POSTs JSON with an Authorization: Bearer header to graph.instagram.com/{ig-id}/media", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([{ ok: true, body: { id: "container-123" } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const containerId = await metaGraph.createInstagramMediaContainer({
    igUserId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
    imageUrl: SECRET_IMAGE_URL,
    caption: "Atlas ile hazırlanan içerik",
  });

  assert.equal(containerId, "container-123");
  assert.equal(calls[0].url, "https://graph.instagram.com/v25.0/17841400000000000/media");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_ACCESS_TOKEN}`);
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.image_url, SECRET_IMAGE_URL);
  assert.equal(body.caption, "Atlas ile hazırlanan içerik");
  assert.equal(cc.calls.length, 0, "a successful call must not log anything");
});

test("meta-graph: createInstagramMediaContainer throws a safe error when Meta doesn't return a container id, and never logs the token", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: false, status: 400, body: { error: { message: "Invalid image URL.", type: "OAuthException", code: 2207001 } } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(
    () =>
      metaGraph.createInstagramMediaContainer({
        igUserId: "17841400000000000",
        accessToken: SECRET_ACCESS_TOKEN,
        imageUrl: SECRET_IMAGE_URL,
        caption: "x",
      }),
    (error) => {
      assert.ok(error instanceof metaGraph.MetaGraphApiError);
      assert.ok(!containsSecret(error.message));
      return true;
    },
  );
  assert.ok(!containsSecret(cc.calls), "no log call may contain the access token");
});

test("meta-graph: publishInstagramMediaContainer POSTs creation_id to media_publish and returns the real media id", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([{ ok: true, body: { id: "17900000000000000" } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const mediaId = await metaGraph.publishInstagramMediaContainer({
    igUserId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
    containerId: "container-123",
  });

  assert.equal(mediaId, "17900000000000000");
  assert.equal(calls[0].url, "https://graph.instagram.com/v25.0/17841400000000000/media_publish");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.creation_id, "container-123");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_ACCESS_TOKEN}`);
});

test("meta-graph: publishInstagramMediaContainer throws a safe error on failure, never logging the token", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: false, status: 500, body: { error: { message: "Media not ready.", type: "OAuthException", code: 9007 } } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.publishInstagramMediaContainer({
      igUserId: "17841400000000000",
      accessToken: SECRET_ACCESS_TOKEN,
      containerId: "container-123",
    }),
  );
  assert.ok(!containsSecret(cc.calls));
});

// ===== providers/meta.ts: publishToMeta orchestration =====

function loadMetaProvider(metaGraphMock) {
  return loadTypeScriptModule(
    "src/lib/publishing/providers/meta.ts",
    (specifier) =>
      ({ "../connections/meta-graph": metaGraphMock })[specifier] ?? {},
    { console },
  );
}

test("providers/meta: publishToMeta succeeds for instagram only after BOTH container creation and publish succeed, returning the real media id", async () => {
  const calls = [];
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    waitForInstagramContainerReady: async () => {},
    createInstagramCarouselContainer: async () => "carousel-container",
    createInstagramMediaContainer: async (input) => {
      calls.push(["create", input]);
      return "container-abc";
    },
    publishInstagramMediaContainer: async (input) => {
      calls.push(["publish", input]);
      return "media-xyz";
    },
  };
  const provider = loadMetaProvider(metaGraphMock);

  const result = await provider.publishToMeta({
    platform: "instagram",
    caption: "caption",
    imageUrl: SECRET_IMAGE_URL,
    externalAccountId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
  });

  assert.equal(result.success, true);
  assert.equal(result.platform, "instagram");
  assert.equal(result.externalPostId, "media-xyz");
  assert.equal(calls[0][0], "create");
  assert.equal(calls[1][0], "publish");
  assert.equal(calls[1][1].containerId, "container-abc", "the publish step must use the id the create step returned");
});

test("providers/meta: a container-creation failure returns success:false and NEVER calls the publish step", async () => {
  let publishCalled = false;
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    waitForInstagramContainerReady: async () => {},
    createInstagramCarouselContainer: async () => "carousel-container",
    createInstagramMediaContainer: async () => {
      throw new metaGraphMock.MetaGraphApiError("boom");
    },
    publishInstagramMediaContainer: async () => {
      publishCalled = true;
      return "media-xyz";
    },
  };
  const provider = loadMetaProvider(metaGraphMock);

  const result = await provider.publishToMeta({
    platform: "instagram",
    caption: "caption",
    imageUrl: SECRET_IMAGE_URL,
    externalAccountId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
  });

  assert.equal(result.success, false);
  assert.equal(publishCalled, false);
});

test("providers/meta: a publish-step failure (container created, publish fails) still returns success:false", async () => {
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    waitForInstagramContainerReady: async () => {},
    createInstagramCarouselContainer: async () => "carousel-container",
    createInstagramMediaContainer: async () => "container-abc",
    publishInstagramMediaContainer: async () => {
      throw new metaGraphMock.MetaGraphApiError("boom");
    },
  };
  const provider = loadMetaProvider(metaGraphMock);

  const result = await provider.publishToMeta({
    platform: "instagram",
    caption: "caption",
    imageUrl: SECRET_IMAGE_URL,
    externalAccountId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
  });

  assert.equal(result.success, false);
});

// ===== publishGeneratedPost.ts: the full orchestrator =====

function makeSupabaseMock({ selectResult, updateResult = { error: null }, rpcResult = { error: null } }, trackers) {
  return {
    rpc: async (name, args) => {
      trackers.rpcCalls.push([name, args]);
      return rpcResult;
    },
    from: (table) => {
      trackers.fromCalls.push(table);
      return {
        select: (cols) => {
          trackers.selectCalls.push(cols);
          return {
            eq: () => ({
              eq: () => ({
                single: async () => selectResult,
              }),
            }),
          };
        },
        update: (patch) => {
          trackers.updateCalls.push(patch);
          return {
            eq: () => ({
              eq: async () => updateResult,
            }),
          };
        },
      };
    },
  };
}

function loadTokenLifecycle(refreshInstagramLongLivedToken, capturingConsole = { console }) {
  return loadTypeScriptModule(
    "src/lib/publishing/connections/tokenLifecycle.ts",
    (specifier) => (specifier === "./meta-graph" ? { refreshInstagramLongLivedToken } : {}),
    { console: capturingConsole.console, Date },
  );
}

function loadPublishGeneratedPost({
  post,
  connectedAccounts,
  credential,
  publishResult,
  updateResult,
  rpcResult,
  refreshImpl,
}) {
  const trackers = {
    rpcCalls: [],
    refreshCalls: [],
    fromCalls: [],
    selectCalls: [],
    updateCalls: [],
    listConnectedMetaAccountsCalls: [],
    getConnectedAccountCredentialCalls: [],
    publishPostCalls: [],
  };

  const supabase = makeSupabaseMock({ selectResult: { data: post, error: post ? null : { message: "not found" } }, updateResult, rpcResult }, trackers);
  const tokenLifecycleModule = loadTokenLifecycle(async (token) => {
    trackers.refreshCalls.push(token);
    return refreshImpl ? refreshImpl(token) : { accessToken: "REFRESHED_TOKEN", expiresInSeconds: 5184000 };
  });

  const platformConfigModule = loadTypeScriptModule("src/lib/ai/platform/config.ts", () => ({}), {});
  const eligibilityModule = loadTypeScriptModule(
    "src/lib/publishing/eligibility.ts",
    (specifier) =>
      ({
        "../ai/platform/config": platformConfigModule,
        "./config": loadTypeScriptModule("src/lib/publishing/config.ts", () => ({}), {}),
      })[specifier] ?? {},
    {},
  );

  const routerMock = {
    publishPost: async (request) => {
      trackers.publishPostCalls.push(request);
      return publishResult ?? { success: true, platform: request.platform, externalPostId: "media-xyz" };
    },
  };
  const queryMock = {
    listConnectedMetaAccounts: async (_supabase, userId) => {
      trackers.listConnectedMetaAccountsCalls.push(userId);
      return connectedAccounts ?? [];
    },
  };
  const credentialsMock = {
    getConnectedAccountCredential: async (_supabase, connectedAccountId) => {
      trackers.getConnectedAccountCredentialCalls.push(connectedAccountId);
      return credential === undefined ? SECRET_ACCESS_TOKEN : credential;
    },
  };

  const mod = loadTypeScriptModule(
    "src/lib/publishing/publishGeneratedPost.ts",
    (specifier) =>
      ({
        "./eligibility": eligibilityModule,
        "./router": routerMock,
        "./connections/query": queryMock,
        "./connections/credentials": credentialsMock,
        "./connections/tokenLifecycle": tokenLifecycleModule,
        "../ai/platform/config": platformConfigModule,
      })[specifier] ?? {},
    { console },
  );

  return { mod, supabase, trackers };
}

test("publishGeneratedPost: a DRAFT post is rejected by eligibility and never reaches account lookup, credential retrieval, or publish", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "draft", metadata: { platform: "instagram" } },
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, false);
  assert.match(result.error, /onaylanmadı/);
  assert.equal(trackers.listConnectedMetaAccountsCalls.length, 0, "draft posts must never reach account lookup");
  assert.equal(trackers.getConnectedAccountCredentialCalls.length, 0, "draft posts must never reach credential retrieval");
  assert.equal(trackers.publishPostCalls.length, 0, "draft posts must never reach the publish call");
  assert.equal(trackers.updateCalls.length, 0, "draft posts must never be written to");
});

test("publishGeneratedPost: an APPROVED post with a connected+credentialed Instagram account proceeds to publish", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [
      { id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "17841400000000000", externalAccountName: "atlas.emlak", tokenExpiresAt: null, hasCredential: true },
    ],
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, true);
  assert.equal(trackers.publishPostCalls.length, 1);
  assert.equal(trackers.publishPostCalls[0].externalAccountId, "17841400000000000");
  assert.equal(trackers.publishPostCalls[0].accessToken, SECRET_ACCESS_TOKEN);
});

test("publishGeneratedPost: credential retrieval uses the sanctioned Vault helper with the connected_accounts id, never a raw vault/secret id", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [
      { id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "17841400000000000", externalAccountName: null, tokenExpiresAt: null, hasCredential: true },
    ],
  });

  await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(trackers.getConnectedAccountCredentialCalls.length, 1);
  assert.equal(trackers.getConnectedAccountCredentialCalls[0], "conn-1", "must pass the connected_accounts row id, not a vault secret id");
});

test("publishGeneratedPost: no connected/credentialed account is a safe failure — publish and status update are never attempted", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [],
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, false);
  assert.equal(trackers.publishPostCalls.length, 0);
  assert.equal(trackers.updateCalls.length, 0);
});

test("publishGeneratedPost: an account with hasCredential:false is skipped, same as no account at all", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [
      { id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "id", externalAccountName: null, tokenExpiresAt: null, hasCredential: false },
    ],
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, false);
  assert.equal(trackers.getConnectedAccountCredentialCalls.length, 0);
  assert.equal(trackers.publishPostCalls.length, 0);
});

test("publishGeneratedPost: a FAILED Meta publish never updates generated_posts — the row is never marked posted", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [
      { id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "id", externalAccountName: null, tokenExpiresAt: null, hasCredential: true },
    ],
    publishResult: { success: false, platform: "instagram", error: "Meta üzerinden yayınlama başarısız oldu." },
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, false);
  assert.equal(trackers.updateCalls.length, 0, "a failed Meta publish must never write status:'posted'");
});

test("publishGeneratedPost: a SUCCESSFUL Meta publish marks the post posted and stores the real media id in metadata, preserving existing metadata keys", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram", other: "kept" } },
    connectedAccounts: [
      { id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "id", externalAccountName: null, tokenExpiresAt: null, hasCredential: true },
    ],
    publishResult: { success: true, platform: "instagram", externalPostId: "17900000000000000" },
  });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, true);
  assert.equal(trackers.updateCalls.length, 1);
  assert.equal(trackers.updateCalls[0].status, "posted");
  assert.equal(trackers.updateCalls[0].metadata.instagramMediaId, "17900000000000000");
  assert.equal(trackers.updateCalls[0].metadata.platform, "instagram", "existing metadata must be preserved, not overwritten");
  assert.equal(trackers.updateCalls[0].metadata.other, "kept");
});

test("publishGeneratedPost: a missing/not-owned post row is a safe, generic failure", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({ post: null });

  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");

  assert.equal(result.success, false);
  assert.equal(trackers.listConnectedMetaAccountsCalls.length, 0);
});

test("publishGeneratedPost: the access token never appears in the returned error, and never in any console.error call across every scenario above", async () => {
  const scenarios = [
    { post: { id: "1", content: "c", final_image_url: SECRET_IMAGE_URL, status: "draft", metadata: {} } },
    { post: { id: "1", content: "c", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: {} }, connectedAccounts: [] },
    {
      post: { id: "1", content: "c", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: {} },
      connectedAccounts: [{ id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "id", externalAccountName: null, tokenExpiresAt: null, hasCredential: true }],
      publishResult: { success: false, platform: "instagram", error: "yayınlama başarısız oldu" },
    },
  ];

  for (const scenario of scenarios) {
    const { mod, supabase } = loadPublishGeneratedPost(scenario);
    const result = await mod.publishGeneratedPost(supabase, "user-1", "1");
    if (!result.success) {
      assert.ok(!containsSecret(result.error), "error message must never contain the access token");
    }
  }
});

// ===== Real production publish failure (2026-10-19): readiness + carousel =====
// Live-verified: a freshly created image container is IN_PROGRESS and only
// becomes FINISHED seconds later; the old flow called media_publish
// immediately and sent only the cover as a single image.

test("meta-graph: a carousel CHILD container sends is_carousel_item and no caption", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([{ ok: true, body: { id: "child-1" } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  const id = await metaGraph.createInstagramMediaContainer({
    igUserId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
    imageUrl: SECRET_IMAGE_URL,
    isCarouselItem: true,
  });
  assert.equal(id, "child-1");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.is_carousel_item, true);
  assert.equal("caption" in body, false);
  assert.equal(body.image_url, SECRET_IMAGE_URL);
});

test("meta-graph: the CAROUSEL container sends media_type, ordered children and the caption", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([{ ok: true, body: { id: "carousel-1" } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  const id = await metaGraph.createInstagramCarouselContainer({
    igUserId: "17841400000000000",
    accessToken: SECRET_ACCESS_TOKEN,
    childContainerIds: ["c1", "c2", "c3", "c4", "c5"],
    caption: "Atlas caption #Zekeriyaköy",
  });
  assert.equal(id, "carousel-1");
  assert.equal(calls[0].url, "https://graph.instagram.com/v25.0/17841400000000000/media");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.media_type, "CAROUSEL");
  assert.equal(body.children, "c1,c2,c3,c4,c5");
  assert.equal(body.caption, "Atlas caption #Zekeriyaköy");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_ACCESS_TOKEN}`);
});

test("meta-graph: waitForInstagramContainerReady polls IN_PROGRESS until FINISHED, token only in the header", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([
    { ok: true, body: { status_code: "IN_PROGRESS" } },
    { ok: true, body: { status_code: "IN_PROGRESS" } },
    { ok: true, body: { status_code: "FINISHED" } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  const sleeps = [];
  await metaGraph.waitForInstagramContainerReady({
    containerId: "container-123",
    accessToken: SECRET_ACCESS_TOKEN,
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://graph.instagram.com/v25.0/container-123?fields=status_code,status");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SECRET_ACCESS_TOKEN}`);
  assert.ok(!calls[0].url.includes(SECRET_ACCESS_TOKEN));
  assert.equal(sleeps.length, 2);
  assert.equal(cc.calls.length, 0);
});

test("meta-graph: waitForInstagramContainerReady fails on ERROR/EXPIRED and on a bounded timeout — never treats an unready container as ready", async () => {
  for (const statusCode of ["ERROR", "EXPIRED"]) {
    const cc = makeCapturingConsole();
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: true, body: { status_code: statusCode, status: "Error: 2207052" } }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    await assert.rejects(
      () => metaGraph.waitForInstagramContainerReady({ containerId: "c", accessToken: SECRET_ACCESS_TOKEN, sleep: async () => {} }),
      (error) => error instanceof metaGraph.MetaGraphApiError && error.details.message.includes(statusCode),
    );
    assert.match(cc.calls[0][0], new RegExp(`status_code=${statusCode}`));
  }
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch(Array.from({ length: 10 }, () => ({ ok: true, body: { status_code: "IN_PROGRESS" } })));
  const metaGraph = loadMetaGraph(mockFetch, cc);
  await assert.rejects(() =>
    metaGraph.waitForInstagramContainerReady({ containerId: "c", accessToken: SECRET_ACCESS_TOKEN, timeoutMs: 4000, intervalMs: 2000, sleep: async () => {} }),
  );
  assert.equal(calls.length, 3, "0 ms, 2000 ms, 4000 ms — then stops");
});

test("meta-graph: a Meta error logs stage, HTTP status, code, subcode, type, message and fbtrace_id — never the token", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    {
      ok: false,
      status: 400,
      body: { error: { message: "Media ID is not available", type: "OAuthException", code: 9007, error_subcode: 2207027, error_user_msg: "The media is not ready for publishing, please wait for a moment", fbtrace_id: "AbCdEf123" } },
    },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  await assert.rejects(
    () => metaGraph.publishInstagramMediaContainer({ igUserId: "1784", accessToken: SECRET_ACCESS_TOKEN, containerId: "c" }),
    (error) => {
      assert.equal(error.details.stage, "medya yayınlama");
      assert.equal(error.details.code, "9007");
      assert.equal(error.details.subcode, "2207027");
      assert.equal(error.details.fbtraceId, "AbCdEf123");
      assert.equal(error.details.httpStatus, 400);
      return true;
    },
  );
  const line = cc.calls[0][0];
  for (const part of ["stage=medya yayınlama", "status=400", "code=9007", "subcode=2207027", "type=OAuthException", "fbtrace_id=AbCdEf123", "not ready for publishing"]) {
    assert.ok(line.includes(part), `log line must include ${part}`);
  }
  assert.ok(!containsSecret(cc.calls));
});

test("providers/meta: a CAROUSEL request creates 5 children in slide order, waits for each, creates the CAROUSEL container with the caption, waits, then publishes it", async () => {
  const log = [];
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    createInstagramMediaContainer: async (input) => {
      log.push(["child", input.imageUrl, input.isCarouselItem, input.caption]);
      return `child-${input.imageUrl.slice(-5, -4)}`;
    },
    waitForInstagramContainerReady: async (input) => log.push(["wait", input.containerId]),
    createInstagramCarouselContainer: async (input) => {
      log.push(["carousel", input.childContainerIds.join(","), input.caption]);
      return "carousel-1";
    },
    publishInstagramMediaContainer: async (input) => {
      log.push(["publish", input.containerId]);
      return "media-1";
    },
  };
  const provider = loadMetaProvider(metaGraphMock);
  const urls = [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`);
  const result = await provider.publishToMeta({
    platform: "instagram",
    caption: "Carousel caption",
    imageUrl: urls[0],
    carouselImageUrls: urls,
    externalAccountId: "1784",
    accessToken: SECRET_ACCESS_TOKEN,
  });
  assert.equal(result.success, true);
  assert.equal(result.externalPostId, "media-1");
  const children = log.filter((entry) => entry[0] === "child");
  assert.equal(children.length, 5);
  assert.ok(children.every((entry) => entry[2] === true && entry[3] === undefined), "children: is_carousel_item, no caption");
  const carousel = log.find((entry) => entry[0] === "carousel");
  assert.equal(carousel[1], "child-1,child-2,child-3,child-4,child-5");
  assert.equal(carousel[2], "Carousel caption");
  const waits = log.filter((entry) => entry[0] === "wait").map((entry) => entry[1]);
  assert.deepEqual(waits, ["child-1", "child-2", "child-3", "child-4", "child-5", "carousel-1"]);
  assert.deepEqual(log.at(-1), ["publish", "carousel-1"]);
  assert.ok(log.findIndex((e) => e[0] === "publish") > log.findLastIndex((e) => e[0] === "wait"), "publish only after the last readiness check");
});

test("providers/meta: a SINGLE image waits for readiness before media_publish", async () => {
  const log = [];
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    createInstagramMediaContainer: async () => (log.push("create"), "c1"),
    waitForInstagramContainerReady: async () => log.push("wait"),
    createInstagramCarouselContainer: async () => (log.push("carousel"), "x"),
    publishInstagramMediaContainer: async () => (log.push("publish"), "m1"),
  };
  const provider = loadMetaProvider(metaGraphMock);
  const result = await provider.publishToMeta({ platform: "instagram", caption: "c", imageUrl: SECRET_IMAGE_URL, externalAccountId: "1", accessToken: SECRET_ACCESS_TOKEN });
  assert.equal(result.success, true);
  assert.deepEqual(log, ["create", "wait", "publish"]);
});

test("providers/meta: a container that never becomes ready is a failure and media_publish is NEVER called", async () => {
  let published = false;
  const metaGraphMock = {
    MetaGraphApiError: class extends Error {},
    createInstagramMediaContainer: async () => "c1",
    waitForInstagramContainerReady: async () => {
      throw new metaGraphMock.MetaGraphApiError("not ready");
    },
    createInstagramCarouselContainer: async () => "x",
    publishInstagramMediaContainer: async () => {
      published = true;
      return "m1";
    },
  };
  const provider = loadMetaProvider(metaGraphMock);
  const result = await provider.publishToMeta({ platform: "instagram", caption: "c", imageUrl: SECRET_IMAGE_URL, carouselImageUrls: [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`), externalAccountId: "1", accessToken: SECRET_ACCESS_TOKEN });
  assert.equal(result.success, false);
  assert.equal(published, false);
});

const APPROVED_ACCOUNT = [{ id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "1784", externalAccountName: null, tokenExpiresAt: null, hasCredential: true }];

test("publishGeneratedPost: an approved CAROUSEL post sends all slide URLs in slide order (not just the cover)", async () => {
  const urls = [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`);
  const shuffled = [3, 0, 4, 1, 2].map((i) => ({ slide: i + 1, imageUrl: urls[i] }));
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: urls[0], status: "approved", metadata: { platform: "instagram", outputMode: "carousel", carouselImages: shuffled } },
    connectedAccounts: APPROVED_ACCOUNT,
  });
  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");
  assert.equal(result.success, true);
  assert.equal(trackers.publishPostCalls[0].carouselImageUrls.join(" "), urls.join(" "));
});

test("publishGeneratedPost: a carousel with missing/invalid slides fails safely — never posts the cover alone, never marks posted", async () => {
  const urls = [1, 2, 3, 4, 5].map((n) => `https://proj.supabase.co/storage/v1/object/public/generated-visuals/u/slide-${n}.png`);
  for (const carouselImages of [undefined, [], [{ slide: 1, imageUrl: urls[0] }], [{ slide: 1, imageUrl: "http://insecure/x.png" }, { slide: 2, imageUrl: urls[1] }]]) {
    const { mod, supabase, trackers } = loadPublishGeneratedPost({
      post: { id: "post-1", content: "caption", final_image_url: urls[0], status: "approved", metadata: { platform: "instagram", outputMode: "carousel", carouselImages } },
      connectedAccounts: APPROVED_ACCOUNT,
    });
    const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");
    assert.equal(result.success, false);
    assert.equal(trackers.publishPostCalls.length, 0);
    assert.equal(trackers.updateCalls.length, 0);
  }
});

test("publishGeneratedPost: a single-image post sends no carousel URLs", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: APPROVED_ACCOUNT,
  });
  await mod.publishGeneratedPost(supabase, "user-1", "post-1");
  assert.equal(trackers.publishPostCalls[0].carouselImageUrls, undefined);
});

test("dashboard: the route hosting the publish server action allows enough time for container readiness", () => {
  const page = fs.readFileSync(path.join(projectRoot, "src/app/dashboard/page.tsx"), "utf8");
  assert.match(page, /export const maxDuration = 60;/);
});

// ===== Instagram token lifecycle (Instagram API with Instagram Login) =====
// Long-lived Instagram User token: 60 days; refreshable once >= 24 h old and
// unexpired via graph.instagram.com/refresh_access_token (ig_refresh_token);
// not refreshed within 60 days = expired, reconnect required.

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const inDays = (days) => new Date(NOW + days * DAY).toISOString();
const IG_ACCOUNT = (tokenExpiresAt) => ({ id: "conn-1", provider: "meta", platform: "instagram", externalAccountId: "1784", externalAccountName: "suatkilic.era", tokenExpiresAt, hasCredential: true });

test("meta-graph: refreshInstagramLongLivedToken GETs graph.instagram.com/refresh_access_token with ig_refresh_token and returns the NEW token + expires_in", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([{ ok: true, body: { access_token: "NEW_TOKEN", token_type: "bearer", expires_in: 5184000 } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  const result = await metaGraph.refreshInstagramLongLivedToken(SECRET_ACCESS_TOKEN);
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://graph.instagram.com/refresh_access_token");
  assert.equal(url.searchParams.get("grant_type"), "ig_refresh_token");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(result.accessToken, "NEW_TOKEN");
  assert.equal(result.expiresInSeconds, 5184000);
  assert.equal(cc.calls.length, 0);
});

test("meta-graph: a failed token refresh throws without logging the token", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([{ ok: false, status: 400, body: { error: { message: "Error validating access token", type: "OAuthException", code: 190 } } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);
  await assert.rejects(() => metaGraph.refreshInstagramLongLivedToken(SECRET_ACCESS_TOKEN));
  assert.ok(cc.calls.length > 0);
  assert.ok(!containsSecret(cc.calls));
});

test("tokenLifecycle: classification — >30 days valid, <=30 days refresh-due, past expired, missing unknown; reconnect only when expired or <=7 days left", () => {
  const lifecycle = loadTokenLifecycle(async () => {
    throw new Error("unused");
  });
  assert.equal(lifecycle.classifyInstagramToken(inDays(45), NOW), "valid");
  assert.equal(lifecycle.classifyInstagramToken(inDays(30), NOW), "refresh-due");
  assert.equal(lifecycle.classifyInstagramToken(inDays(-1), NOW), "expired");
  assert.equal(lifecycle.classifyInstagramToken(null, NOW), "unknown");
  assert.equal(lifecycle.needsInstagramReconnect(inDays(45), NOW), false);
  assert.equal(lifecycle.needsInstagramReconnect(inDays(20), NOW), false, "still refreshable — no reconnect prompt");
  assert.equal(lifecycle.needsInstagramReconnect(inDays(5), NOW), true);
  assert.equal(lifecycle.needsInstagramReconnect(inDays(-1), NOW), true);
  assert.equal(lifecycle.needsInstagramReconnect(null, NOW), false);
});

function lifecycleSupabase({ rpcError = null, updateError = null } = {}) {
  const t = { rpc: [], updates: [], eqs: [] };
  return {
    t,
    client: {
      rpc: async (name, args) => (t.rpc.push([name, args]), { error: rpcError }),
      from: (table) => ({
        update: (patch) => (t.updates.push([table, patch]), { eq: async (c, v) => (t.eqs.push([c, v]), { error: updateError }) }),
      }),
    },
  };
}

test("tokenLifecycle: a VALID token is used as-is — no refresh, no writes", async () => {
  let refreshed = 0;
  const lifecycle = loadTokenLifecycle(async () => (refreshed++, { accessToken: "X", expiresInSeconds: 1 }));
  const { client, t } = lifecycleSupabase();
  const result = await lifecycle.ensureFreshInstagramToken(client, IG_ACCOUNT(inDays(45)), "OLD", NOW);
  assert.equal(result.accessToken, "OLD");
  assert.equal(result.state, "valid");
  assert.equal(refreshed, 0);
  assert.equal(t.rpc.length + t.updates.length, 0);
});

test("tokenLifecycle: a REFRESH-DUE token is refreshed — new token stored in Vault first, then the new expiry", async () => {
  const cc = makeCapturingConsole();
  const lifecycle = loadTokenLifecycle(async (token) => {
    assert.equal(token, "OLD");
    return { accessToken: "NEW", expiresInSeconds: 60 * 24 * 3600 };
  }, cc);
  const { client, t } = lifecycleSupabase();
  const result = await lifecycle.ensureFreshInstagramToken(client, IG_ACCOUNT(inDays(20)), "OLD", NOW);
  assert.equal(result.state, "refreshed");
  assert.equal(result.accessToken, "NEW");
  assert.equal(result.tokenExpiresAt, inDays(60));
  assert.equal(JSON.stringify(t.rpc[0]), JSON.stringify(["store_connected_account_credential", { p_connected_account_id: "conn-1", p_secret: "NEW" }]));
  assert.equal(t.updates[0][0], "connected_accounts");
  assert.equal(t.updates[0][1].token_expires_at, inDays(60));
  assert.deepEqual(t.eqs[0], ["id", "conn-1"]);
  assert.equal(cc.calls.length, 0);
});

test("tokenLifecycle: a failed refresh, or a failed Vault write, keeps the existing still-valid token and writes nothing else", async () => {
  const failing = loadTokenLifecycle(async () => {
    throw new Error("Meta refresh failed");
  }, makeCapturingConsole());
  const first = lifecycleSupabase();
  const r1 = await failing.ensureFreshInstagramToken(first.client, IG_ACCOUNT(inDays(20)), "OLD", NOW);
  assert.equal(r1.state, "refresh-failed");
  assert.equal(r1.accessToken, "OLD");
  assert.equal(r1.tokenExpiresAt, inDays(20));
  assert.equal(first.t.rpc.length + first.t.updates.length, 0);

  const cc = makeCapturingConsole();
  const working = loadTokenLifecycle(async () => ({ accessToken: "NEW", expiresInSeconds: 5184000 }), cc);
  const second = lifecycleSupabase({ rpcError: { message: "vault down" } });
  const r2 = await working.ensureFreshInstagramToken(second.client, IG_ACCOUNT(inDays(20)), "OLD", NOW);
  assert.equal(r2.accessToken, "OLD");
  assert.equal(second.t.updates.length, 0, "expiry is never advanced without the new token stored");
  assert.ok(!JSON.stringify(cc.calls).includes("NEW") && !JSON.stringify(cc.calls).includes("OLD"), "tokens are never logged");
});

test("tokenLifecycle: an EXPIRED token is never refreshed or returned", async () => {
  let refreshed = 0;
  const lifecycle = loadTokenLifecycle(async () => (refreshed++, { accessToken: "X", expiresInSeconds: 1 }));
  const { client } = lifecycleSupabase();
  const result = await lifecycle.ensureFreshInstagramToken(client, IG_ACCOUNT(inDays(-2)), "OLD", NOW);
  assert.equal(result.state, "expired");
  assert.equal(result.accessToken, null);
  assert.equal(refreshed, 0);
});

test("publishGeneratedPost: an EXPIRED Instagram token stops before Meta with a reconnect message; the post stays approved", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [IG_ACCOUNT(new Date(Date.now() - DAY).toISOString())],
  });
  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");
  assert.equal(result.success, false);
  assert.match(result.error, /yeniden bağlayın/);
  assert.equal(trackers.publishPostCalls.length, 0);
  assert.equal(trackers.updateCalls.length, 0);
  assert.equal(trackers.refreshCalls.length, 0);
});

test("publishGeneratedPost: a REFRESH-DUE token is refreshed before publishing and the NEW token is used", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [IG_ACCOUNT(new Date(Date.now() + 10 * DAY).toISOString())],
  });
  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");
  assert.equal(result.success, true);
  assert.deepEqual(trackers.refreshCalls, [SECRET_ACCESS_TOKEN]);
  assert.equal(trackers.rpcCalls[0][0], "store_connected_account_credential");
  assert.equal(trackers.publishPostCalls[0].accessToken, "REFRESHED_TOKEN");
});

test("publishGeneratedPost: if the refresh fails, publishing continues with the still-valid stored token", async () => {
  const { mod, supabase, trackers } = loadPublishGeneratedPost({
    post: { id: "post-1", content: "caption", final_image_url: SECRET_IMAGE_URL, status: "approved", metadata: { platform: "instagram" } },
    connectedAccounts: [IG_ACCOUNT(new Date(Date.now() + 10 * DAY).toISOString())],
    refreshImpl: () => {
      throw new Error("refresh failed");
    },
  });
  const result = await mod.publishGeneratedPost(supabase, "user-1", "post-1");
  assert.equal(result.success, true);
  assert.equal(trackers.publishPostCalls[0].accessToken, SECRET_ACCESS_TOKEN);
});

test("dashboard: Bağlı Hesaplar refreshes on use and offers 'Yeniden Bağla' only when needsInstagramReconnect", () => {
  const ui = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/SocialAccounts.tsx"), "utf8");
  assert.match(ui, /ensureFreshInstagramToken/);
  assert.match(ui, /needsInstagramReconnect\(account\.tokenExpiresAt\)/);
  assert.match(ui, /Yeniden Bağla/);
});
