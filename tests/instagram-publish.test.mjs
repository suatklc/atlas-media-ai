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

function makeSupabaseMock({ selectResult, updateResult = { error: null } }, trackers) {
  return {
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

function loadPublishGeneratedPost({
  post,
  connectedAccounts,
  credential,
  publishResult,
  updateResult,
}) {
  const trackers = {
    fromCalls: [],
    selectCalls: [],
    updateCalls: [],
    listConnectedMetaAccountsCalls: [],
    getConnectedAccountCredentialCalls: [],
    publishPostCalls: [],
  };

  const supabase = makeSupabaseMock({ selectResult: { data: post, error: post ? null : { message: "not found" } }, updateResult }, trackers);

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
