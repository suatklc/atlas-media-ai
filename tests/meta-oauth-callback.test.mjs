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

const SECRET_APP_SECRET = "SUPER_SECRET_APP_SECRET_VALUE";
const SECRET_CODE = "SUPER_SECRET_AUTH_CODE_VALUE";
const SECRET_SHORT_TOKEN = "SUPER_SECRET_SHORT_LIVED_TOKEN";
const SECRET_LONG_TOKEN = "SUPER_SECRET_LONG_LIVED_TOKEN";

function containsAnySecret(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [SECRET_APP_SECRET, SECRET_CODE, SECRET_SHORT_TOKEN, SECRET_LONG_TOKEN].some((s) => text.includes(s));
}

function makeCapturingConsole() {
  const calls = [];
  return {
    console: {
      error: (...args) => calls.push(args),
      log: () => {},
      warn: () => {},
    },
    calls,
  };
}

// ===== meta-graph.ts: real Instagram API with Instagram Login request/
// response handling, mocked fetch. This targets a DIFFERENT product from
// the earlier Facebook Login for Business flow (see meta-oauth.ts/
// meta-graph.ts comments) — three distinct hosts, a multipart POST for the
// code exchange, and "data"-wrapped responses for two of the three calls. =====

function loadMetaGraph(fetchImpl, capturingConsole) {
  return loadTypeScriptModule(
    "src/lib/publishing/connections/meta-graph.ts",
    (specifier) => (specifier === "./meta-oauth" ? { META_GRAPH_API_VERSION: "v25.0" } : {}),
    { fetch: fetchImpl, URL, FormData, console: capturingConsole.console },
  );
}

// Records url + full options (method/body) for every call, since the code
// exchange is a POST with a FormData body while the other two calls are
// plain GETs — a single url.toString() capture (as the old Facebook-flow
// tests used) isn't enough to verify the POST request shape.
function makeSequencedFetch(responses) {
  let call = 0;
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url: url.toString(), options });
      const resp = responses[call++];
      if (!resp) throw new Error("test setup error: no mock response queued");
      if (resp.networkError) throw new Error("simulated network failure");
      return { ok: resp.ok, status: resp.status ?? (resp.ok ? 200 : 400), json: async () => resp.body };
    },
  };
}

test("meta-graph: exchangeCodeForUserToken POSTs the documented multipart request to api.instagram.com and parses the data-wrapped response", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([
    {
      ok: true,
      body: {
        data: [
          {
            access_token: SECRET_SHORT_TOKEN,
            user_id: "17841400000000000",
            permissions: "instagram_business_basic,instagram_business_content_publish",
          },
        ],
      },
    },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const result = await metaGraph.exchangeCodeForUserToken({
    appId: "IG_APP_ID",
    appSecret: SECRET_APP_SECRET,
    redirectUri: "https://example.test/api/meta/callback",
    code: SECRET_CODE,
  });

  assert.equal(result.accessToken, SECRET_SHORT_TOKEN);
  assert.equal(result.userId, "17841400000000000");
  assert.equal(calls[0].url, "https://api.instagram.com/oauth/access_token");
  assert.equal(calls[0].options.method, "POST");
  const form = calls[0].options.body;
  assert.equal(form.get("client_id"), "IG_APP_ID");
  assert.equal(form.get("client_secret"), SECRET_APP_SECRET);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("redirect_uri"), "https://example.test/api/meta/callback");
  assert.equal(form.get("code"), SECRET_CODE);
});

test("meta-graph: exchangeCodeForUserToken succeeds on the EXACT verbatim production response shape — access_token,permissions,user_id flat, no data wrapper", async () => {
  // This is the exact fixture from the real Vercel production log (Handoff
  // 6 Step 5D follow-up):
  //   Meta Graph API unexpected success shape — stage=code exchange
  //   topLevelKeys=access_token,permissions,user_id dataShape=undefined
  // Reproducing that exact key set (flat, these 3 keys, no "data" key) with
  // valid non-empty string values and running it through the REAL function
  // (not a mental model of it) proves the flat-shape parser fix from the
  // prior turn is correct: this must succeed, not throw. It does. That
  // means the earlier structural fix was never the remaining problem — see
  // the tests below for what actually still fails and why.
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    {
      ok: true,
      body: {
        access_token: SECRET_SHORT_TOKEN,
        permissions: "instagram_business_basic,instagram_business_content_publish",
        user_id: "17841400000000000",
      },
    },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const result = await metaGraph.exchangeCodeForUserToken({
    appId: "IG_APP_ID",
    appSecret: SECRET_APP_SECRET,
    redirectUri: "https://example.test/api/meta/callback",
    code: SECRET_CODE,
  });

  assert.equal(result.accessToken, SECRET_SHORT_TOKEN);
  assert.equal(result.userId, "17841400000000000");
  assert.equal(cc.calls.length, 0, "a successfully-parsed response (either shape) must not log anything");
});

test("meta-graph: the SAME key set (access_token,permissions,user_id) still correctly rejects an invalid access_token VALUE — proving key presence alone was never sufficient", async () => {
  // topLevelKeys reports only key NAMES, so "missing", null, and an empty
  // string all look identical from that field alone — this is exactly the
  // ambiguity the production log couldn't resolve. These three variants
  // share the identical key set as the passing fixture above but differ
  // only in access_token's VALUE, and correctly still fail (a genuinely
  // invalid token must never be accepted/persisted).
  const invalidAccessTokenValues = [null, 123456, ""];
  for (const access_token of invalidAccessTokenValues) {
    const cc = makeCapturingConsole();
    const { fetch: mockFetch } = makeSequencedFetch([
      { ok: true, body: { access_token, permissions: "x", user_id: "17841400000000000" } },
    ]);
    const metaGraph = loadMetaGraph(mockFetch, cc);

    await assert.rejects(
      () =>
        metaGraph.exchangeCodeForUserToken({
          appId: "id",
          appSecret: SECRET_APP_SECRET,
          redirectUri: "https://example.test/api/meta/callback",
          code: SECRET_CODE,
        }),
      (error) => {
        assert.match(error.message, /erişim jetonunu döndürmedi/);
        return true;
      },
    );
  }
});

test("meta-graph: the field-level diagnostic log distinguishes access_token being missing/null/empty/wrong-type — never logging the actual value", async () => {
  const cases = [
    { label: "missing", body: { permissions: "x", user_id: "17841400000000000" }, expect: /accessTokenField=missing/ },
    { label: "null", body: { access_token: null, permissions: "x", user_id: "17841400000000000" }, expect: /accessTokenField=null/ },
    {
      label: "empty string",
      body: { access_token: "", permissions: "x", user_id: "17841400000000000" },
      expect: /accessTokenField=empty-string/,
    },
    {
      label: "wrong type (number)",
      body: { access_token: 123456, permissions: "x", user_id: "17841400000000000" },
      expect: /accessTokenField=number/,
    },
  ];

  for (const { body, expect } of cases) {
    const cc = makeCapturingConsole();
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: true, body }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);

    await assert.rejects(() =>
      metaGraph.exchangeCodeForUserToken({
        appId: "id",
        appSecret: SECRET_APP_SECRET,
        redirectUri: "https://example.test/api/meta/callback",
        code: SECRET_CODE,
      }),
    );

    assert.equal(cc.calls.length, 1);
    const line = cc.calls[0][0];
    assert.match(line, expect);
    assert.match(line, /userIdField=non-empty-string/);
    assert.ok(!containsAnySecret(line), "the diagnostic line must never contain the actual field value");
    assert.ok(!line.includes("123456"), "a numeric field value must never appear literally in the log line");
  }
});

test("meta-graph: exchangeCodeForUserToken SUCCEEDS on the exact confirmed production condition — flat response, user_id returned as a NUMBER — and returns userId as a STRING", async () => {
  // This is the final confirmed production log (Handoff 6 Step 5D
  // follow-up): accessTokenField=non-empty-string, userIdField=number.
  // access_token was always valid; the sole remaining failure was that
  // Meta returns user_id as a JSON number in this flow, not a string, and
  // the parser previously required it to already be one. This is the
  // regression test proving that gap is closed: the exact shape must now
  // succeed, and the returned userId must be a string (every downstream
  // consumer — externalAccountId, the connected_accounts row, Vault
  // lookups — expects a string, never a number).
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    {
      ok: true,
      body: {
        access_token: SECRET_SHORT_TOKEN,
        permissions: "instagram_business_basic,instagram_business_content_publish",
        user_id: 17841400000000000,
      },
    },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const result = await metaGraph.exchangeCodeForUserToken({
    appId: "IG_APP_ID",
    appSecret: SECRET_APP_SECRET,
    redirectUri: "https://example.test/api/meta/callback",
    code: SECRET_CODE,
  });

  assert.equal(result.accessToken, SECRET_SHORT_TOKEN);
  assert.equal(result.userId, "17841400000000000");
  assert.equal(typeof result.userId, "string", "userId must be normalized to a string, never left as a number");
  assert.equal(cc.calls.length, 0, "a successfully-parsed response must not log anything, even with a numeric user_id");
});

test("meta-graph: a non-finite or otherwise invalid user_id (NaN, boolean, object) is still safely rejected, never coerced into a bogus string", async () => {
  const invalidUserIdValues = [Number.NaN, true, { nested: "object" }, [1, 2, 3]];
  for (const user_id of invalidUserIdValues) {
    const cc = makeCapturingConsole();
    const { fetch: mockFetch } = makeSequencedFetch([
      { ok: true, body: { access_token: SECRET_SHORT_TOKEN, permissions: "x", user_id } },
    ]);
    const metaGraph = loadMetaGraph(mockFetch, cc);

    await assert.rejects(
      () =>
        metaGraph.exchangeCodeForUserToken({
          appId: "id",
          appSecret: SECRET_APP_SECRET,
          redirectUri: "https://example.test/api/meta/callback",
          code: SECRET_CODE,
        }),
      (error) => {
        assert.match(error.message, /hesap kimliğini döndürmedi/);
        return true;
      },
    );
  }
});

test("meta-graph: exchangeCodeForUserToken throws a safe error when the response has no access_token or no user_id", async () => {
  const cc = makeCapturingConsole();
  {
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: true, body: { data: [{ user_id: "123" }] } }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    await assert.rejects(() =>
      metaGraph.exchangeCodeForUserToken({
        appId: "id",
        appSecret: SECRET_APP_SECRET,
        redirectUri: "https://example.test/api/meta/callback",
        code: SECRET_CODE,
      }),
    );
  }
  {
    const { fetch: mockFetch } = makeSequencedFetch([
      { ok: true, body: { data: [{ access_token: SECRET_SHORT_TOKEN }] } },
    ]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    await assert.rejects(() =>
      metaGraph.exchangeCodeForUserToken({
        appId: "id",
        appSecret: SECRET_APP_SECRET,
        redirectUri: "https://example.test/api/meta/callback",
        code: SECRET_CODE,
      }),
    );
  }
});

test("meta-graph: an unexpected HTTP-200 shape (neither wrapped nor flat) now logs a shape-only diagnostic line — this was previously invisible", async () => {
  // Regression test for finding F of the production diagnosis: a
  // successful (HTTP 200, valid JSON) response that fails shape validation
  // used to log NOTHING at all, which is exactly why the real shape Meta
  // sent in production couldn't be determined from the runtime log.
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: true, body: { unexpected_field: "something else entirely" } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );

  assert.equal(cc.calls.length, 1, "an unexpected 200 shape must produce exactly one diagnostic log line");
  assert.equal(cc.calls[0].length, 1, "single string argument only");
  const line = cc.calls[0][0];
  assert.match(line, /Meta Graph API unexpected success shape/);
  assert.match(line, /stage=code exchange/);
  assert.match(line, /topLevelKeys=unexpected_field/);
  assert.match(line, /dataShape=undefined/);
  assert.ok(!containsAnySecret(line), "the shape-diagnostic line must never contain a token/secret/code value");
});

test("meta-graph: the shape-diagnostic log never includes any field VALUE, only key names and structural type info", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: true, body: { data: [{ some_other_field: SECRET_SHORT_TOKEN }] } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );

  const line = cc.calls[0][0];
  assert.match(line, /dataShape=array\(length=1\)/);
  assert.ok(!containsAnySecret(line));
});

test("meta-graph: a non-ok/error response throws MetaGraphApiError with a safe message, never leaking the secret/token/code", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: false, status: 400, body: { error: { message: "Invalid authorization code.", type: "OAuthException", code: 400 } } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(
    () =>
      metaGraph.exchangeCodeForUserToken({
        appId: "id",
        appSecret: SECRET_APP_SECRET,
        redirectUri: "https://example.test/api/meta/callback",
        code: SECRET_CODE,
      }),
    (error) => {
      assert.ok(error instanceof metaGraph.MetaGraphApiError);
      assert.ok(!containsAnySecret(error.message), "thrown error message must not contain any secret/token");
      return true;
    },
  );
  assert.ok(!containsAnySecret(cc.calls), "console.error calls must not contain any secret/token/code");
});

test("meta-graph: a non-ok/error response logs ONE single-string console.error line containing stage, HTTP status, and Meta's type/code/message", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: false, status: 400, body: { error: { message: "Invalid authorization code.", type: "OAuthException", code: 400 } } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );

  assert.equal(cc.calls.length, 1, "exactly one console.error call for this failure");
  assert.equal(cc.calls[0].length, 1, "the log call must be a single string argument, not a separate object argument");
  const line = cc.calls[0][0];
  assert.match(line, /stage=code exchange/);
  assert.match(line, /status=400/);
  assert.match(line, /type=OAuthException/);
  assert.match(line, /code=400/);
  assert.match(line, /message=Invalid authorization code\./);
  assert.ok(!containsAnySecret(line));
});

test("meta-graph: an error response with NO structured error body logs a safe fallback line instead of silently dropping the failure", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([{ ok: false, status: 503, body: { unexpected: "shape" } }]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );

  assert.equal(cc.calls.length, 1);
  const line = cc.calls[0][0];
  assert.match(line, /stage=code exchange/);
  assert.match(line, /status=503/);
  assert.match(line, /no structured error body/);
});

test("meta-graph: a non-JSON error response (e.g. an HTML error page) now logs a diagnostic line before throwing — this was previously silent", async () => {
  // Regression test for the real production incident (Handoff 6 Step 5D
  // follow-up): a live 502 produced zero matching log lines because
  // handleGraphResponse threw inside its response.json() catch block
  // without ever calling console.error. This proves that gap is closed.
  const cc = makeCapturingConsole();
  const brokenJsonFetch = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error("Unexpected token < in JSON at position 0");
    },
  });
  const metaGraph = loadMetaGraph(brokenJsonFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );

  assert.equal(cc.calls.length, 1, "a non-JSON error response must produce exactly one log line, not zero");
  const line = cc.calls[0][0];
  assert.match(line, /stage=code exchange/);
  assert.match(line, /status=502/);
  assert.match(line, /non-JSON error response/);
  assert.ok(!containsAnySecret(line), "the non-JSON log line must never include the unparseable body content");
});

test("meta-graph: the long-lived token exchange stage is distinguishable from the code-exchange stage in the log line", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch } = makeSequencedFetch([
    { ok: false, status: 401, body: { error: { message: "Error validating access token.", type: "OAuthException", code: 190 } } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  await assert.rejects(() =>
    metaGraph.exchangeForLongLivedUserToken({ appSecret: SECRET_APP_SECRET, shortLivedToken: SECRET_SHORT_TOKEN }),
  );

  const line = cc.calls[0][0];
  assert.match(line, /stage=long-lived token exchange/);
  assert.ok(!containsAnySecret(line));
});

test("meta-graph: a network failure (fetch throws) is converted to a safe MetaGraphApiError, never logging the caught error object", async () => {
  const cc = makeCapturingConsole();
  const metaGraph = loadMetaGraph(async () => {
    throw new Error(`network down while calling https://api.instagram.com/oauth/access_token?client_secret=${SECRET_APP_SECRET}`);
  }, cc);

  await assert.rejects(() =>
    metaGraph.exchangeCodeForUserToken({
      appId: "id",
      appSecret: SECRET_APP_SECRET,
      redirectUri: "https://example.test/api/meta/callback",
      code: SECRET_CODE,
    }),
  );
  assert.ok(!containsAnySecret(cc.calls), "network-error log path must not leak the secret embedded in the caught error");
});

test("meta-graph: exchangeForLongLivedUserToken GETs graph.instagram.com/access_token with grant_type=ig_exchange_token and no client_id", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([
    { ok: true, body: { access_token: SECRET_LONG_TOKEN, token_type: "bearer", expires_in: 5183944 } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const result = await metaGraph.exchangeForLongLivedUserToken({
    appSecret: SECRET_APP_SECRET,
    shortLivedToken: SECRET_SHORT_TOKEN,
  });

  assert.equal(result.accessToken, SECRET_LONG_TOKEN);
  assert.equal(result.expiresInSeconds, 5183944);
  const requested = new URL(calls[0].url);
  assert.equal(requested.origin + requested.pathname, "https://graph.instagram.com/access_token");
  assert.equal(requested.searchParams.get("grant_type"), "ig_exchange_token");
  assert.equal(requested.searchParams.get("client_secret"), SECRET_APP_SECRET);
  assert.equal(requested.searchParams.get("access_token"), SECRET_SHORT_TOKEN);
  assert.equal(requested.searchParams.has("client_id"), false, "this endpoint takes no client_id per Meta's docs");
});

test("meta-graph: fetchInstagramUsername GETs graph.instagram.com/{version}/me and reads username from the data-wrapped response", async () => {
  const cc = makeCapturingConsole();
  const { fetch: mockFetch, calls } = makeSequencedFetch([
    { ok: true, body: { data: [{ user_id: "17841400000000000", username: "atlas.emlak" }] } },
  ]);
  const metaGraph = loadMetaGraph(mockFetch, cc);

  const username = await metaGraph.fetchInstagramUsername("some-access-token");

  assert.equal(username, "atlas.emlak");
  const requested = new URL(calls[0].url);
  assert.equal(requested.origin + requested.pathname, "https://graph.instagram.com/v25.0/me");
  assert.equal(requested.searchParams.get("fields"), "user_id,username");
  assert.equal(requested.searchParams.get("access_token"), "some-access-token");
});

test("meta-graph: fetchInstagramUsername returns null (never throws) on failure or an empty/malformed data array", async () => {
  const cc = makeCapturingConsole();
  {
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: false, status: 500, body: { error: { message: "server error" } } }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    assert.equal(await metaGraph.fetchInstagramUsername("token"), null);
  }
  {
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: true, body: { data: [] } }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    assert.equal(await metaGraph.fetchInstagramUsername("token"), null);
  }
  {
    const { fetch: mockFetch } = makeSequencedFetch([{ ok: true, body: { data: [{ user_id: "123" }] } }]);
    const metaGraph = loadMetaGraph(mockFetch, cc);
    assert.equal(await metaGraph.fetchInstagramUsername("token"), null);
  }
});

// ===== oauth-state.ts: CSRF state validation (unchanged by this product swap) =====

const oauthState = loadTypeScriptModule("src/lib/publishing/connections/oauth-state.ts", () => ({}), {
  crypto: globalThis.crypto,
  process: { env: {} },
});

test("oauth-state: isValidOAuthState requires a non-empty cookie value matching the callback's state param", () => {
  assert.equal(oauthState.isValidOAuthState("abc-123", "abc-123"), true);
  assert.equal(oauthState.isValidOAuthState(undefined, "abc-123"), false);
  assert.equal(oauthState.isValidOAuthState("abc-123", null), false);
  assert.equal(oauthState.isValidOAuthState("abc-123", "different"), false);
  assert.equal(oauthState.isValidOAuthState("", ""), false);
});

// ===== callback/route.ts: full orchestration, every dependency mocked =====
// No Facebook Page discovery step exists anymore — one token exchange
// yields both the access token and the connected Instagram account's id, so
// there is exactly one upsertConnectedMetaAccount call per successful
// callback, never a loop over Pages.

function buildCallbackHarness({
  storedState = "state-abc",
  requestState = "state-abc",
  requestError = null,
  requestCode = "auth-code",
  env = { NEXT_PUBLIC_SITE_URL: "https://atlas.example", INSTAGRAM_APP_ID: "ig-app-id", INSTAGRAM_APP_SECRET: SECRET_APP_SECRET },
  exchangeCodeImpl,
  exchangeLongLivedImpl,
  fetchUsernameImpl,
  upsertImpl,
} = {}) {
  const cc = makeCapturingConsole();
  const upsertCalls = [];
  let cookieDeleted = false;

  const params = new URLSearchParams();
  if (requestState !== undefined && requestState !== null) params.set("state", requestState);
  if (requestError) params.set("error", requestError);
  if (requestCode) params.set("code", requestCode);
  const requestUrl = `https://atlas.example/api/meta/callback?${params.toString()}`;

  class MockMetaGraphApiError extends Error {}

  const metaGraphMock = {
    MetaGraphApiError: MockMetaGraphApiError,
    exchangeCodeForUserToken:
      exchangeCodeImpl ?? (async () => ({ accessToken: SECRET_SHORT_TOKEN, userId: "ig-user-1" })),
    exchangeForLongLivedUserToken:
      exchangeLongLivedImpl ?? (async () => ({ accessToken: SECRET_LONG_TOKEN, expiresInSeconds: 5184000 })),
    fetchInstagramUsername: fetchUsernameImpl ?? (async () => null),
  };

  const route = loadTypeScriptModule(
    "src/app/api/meta/callback/route.ts",
    (specifier) =>
      ({
        "next/server": { NextResponse: { redirect: (url, status) => ({ __redirect: url.toString(), status }) } },
        "next/headers": {
          cookies: async () => ({
            get: (name) =>
              name === "atlas_meta_oauth_state" && !cookieDeleted && storedState !== undefined
                ? { value: storedState }
                : undefined,
            delete: () => {
              cookieDeleted = true;
            },
          }),
        },
        "@/lib/supabase/server": {
          createClient: async () => ({
            auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
          }),
        },
        "@/lib/publishing/connections/meta-graph": metaGraphMock,
        "@/lib/publishing/connections/query": {
          upsertConnectedMetaAccount:
            upsertImpl ??
            (async (_supabase, input) => {
              upsertCalls.push(input);
              return { success: true };
            }),
        },
        "@/lib/publishing/connections/oauth-state": oauthState,
      })[specifier] ?? {},
    { Response, URL, Date, console: cc.console, process: { env } },
  );

  return { route, cc, upsertCalls, requestUrl, cookieDeletedRef: () => cookieDeleted };
}

test("callback: invalid/mismatched state is rejected before anything else runs, and the state cookie is always cleared", async () => {
  const h = buildCallbackHarness({ storedState: "expected", requestState: "different" });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /Geçersiz|süresi dolmuş/);
  assert.ok(h.cookieDeletedRef(), "state cookie must be deleted even on rejection");
  assert.equal(h.upsertCalls.length, 0);
});

test("callback: missing state cookie (e.g. expired/cleared) is rejected the same as a mismatch", async () => {
  const h = buildCallbackHarness({ storedState: undefined, requestState: "whatever" });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 400);
});

test("callback: user-denied authorization returns an explicit failure, never a fake success", async () => {
  const h = buildCallbackHarness({ requestError: "access_denied", requestCode: null });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 400);
  assert.equal(h.upsertCalls.length, 0);
});

test("callback: missing code with valid state returns an explicit 400", async () => {
  const h = buildCallbackHarness({ requestCode: null });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 400);
});

test("callback: missing Instagram app credentials returns 501, never attempts token exchange", async () => {
  let exchangeCalled = false;
  const h = buildCallbackHarness({
    env: { NEXT_PUBLIC_SITE_URL: "https://atlas.example" },
    exchangeCodeImpl: async () => {
      exchangeCalled = true;
      return { accessToken: "x", userId: "y" };
    },
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 501);
  assert.equal(exchangeCalled, false);
});

test("callback: code-exchange failure returns 502 and never reaches the long-lived exchange or persistence", async () => {
  let longLivedCalled = false;
  const h = buildCallbackHarness({
    exchangeCodeImpl: async () => {
      throw new (class extends Error {})("code exchange: Meta API isteği başarısız oldu.");
    },
    exchangeLongLivedImpl: async () => {
      longLivedCalled = true;
      return { accessToken: "x", expiresInSeconds: null };
    },
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 502);
  assert.equal(longLivedCalled, false);
  assert.equal(h.upsertCalls.length, 0);
});

test("callback: long-lived token exchange failure returns 502 and never attempts persistence", async () => {
  const h = buildCallbackHarness({
    exchangeLongLivedImpl: async () => {
      throw new Error("long-lived token exchange: Meta API isteği başarısız oldu.");
    },
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 502);
  assert.equal(h.upsertCalls.length, 0);
});

test("callback: persistence failure returns an explicit 502, never a fake success redirect", async () => {
  const h = buildCallbackHarness({
    upsertImpl: async () => ({ success: false, error: "db down" }),
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 502);
});

test("callback: a successful connection persists exactly one instagram row using the account id and long-lived token from the exchange", async () => {
  const h = buildCallbackHarness({
    exchangeCodeImpl: async () => ({ accessToken: SECRET_SHORT_TOKEN, userId: "17841400000000000" }),
    exchangeLongLivedImpl: async () => ({ accessToken: SECRET_LONG_TOKEN, expiresInSeconds: 5184000 }),
    fetchUsernameImpl: async () => "atlas.emlak",
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 302);
  assert.equal(h.upsertCalls.length, 1);
  const [call] = h.upsertCalls;
  assert.equal(call.platform, "instagram");
  assert.equal(call.externalAccountId, "17841400000000000");
  assert.equal(call.externalAccountName, "atlas.emlak");
  assert.equal(call.accessToken, SECRET_LONG_TOKEN, "the persisted credential is the long-lived token, not the short-lived one");
});

test("callback: a failed/empty username lookup falls back to the account id as the display name, and is not treated as an error", async () => {
  const h = buildCallbackHarness({
    exchangeCodeImpl: async () => ({ accessToken: SECRET_SHORT_TOKEN, userId: "ig-user-legacy" }),
    fetchUsernameImpl: async () => null,
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 302);
  assert.equal(h.upsertCalls.length, 1);
  assert.equal(h.upsertCalls[0].externalAccountName, "ig-user-legacy");
});

test("callback: the success redirect never contains the access token, app secret, or auth code, and no log call leaks them either", async () => {
  const h = buildCallbackHarness({
    requestCode: SECRET_CODE,
    exchangeCodeImpl: async () => ({ accessToken: SECRET_SHORT_TOKEN, userId: "ig-user-1" }),
    exchangeLongLivedImpl: async () => ({ accessToken: SECRET_LONG_TOKEN, expiresInSeconds: 5184000 }),
  });
  const response = await h.route.GET({ url: h.requestUrl });
  assert.equal(response.status, 302);
  assert.ok(!containsAnySecret(response.__redirect), "redirect URL must never contain a secret/token/code");
  assert.ok(!containsAnySecret(h.cc.calls), "no console.error call may contain a secret/token/code");
});

test("callback: every jsonError failure body across this suite is free of secret/token/code leakage", async () => {
  const scenarios = [
    buildCallbackHarness({ storedState: "a", requestState: "b" }),
    buildCallbackHarness({ requestError: "access_denied", requestCode: null }),
    buildCallbackHarness({
      requestCode: SECRET_CODE,
      exchangeCodeImpl: async () => {
        throw new Error("boom");
      },
    }),
  ];
  for (const h of scenarios) {
    const response = await h.route.GET({ url: h.requestUrl });
    if (typeof response.json === "function") {
      const body = await response.json();
      assert.ok(!containsAnySecret(body), "error response body must never contain a secret/token/code");
    }
  }
});

// ===== meta-oauth.ts: authorization URL uses the current scope/host set =====

test("meta-oauth: buildMetaAuthorizationUrl targets instagram.com/oauth/authorize with only the two currently-enabled minimum scopes", () => {
  const metaOauth = loadTypeScriptModule("src/lib/publishing/connections/meta-oauth.ts", () => ({}), { URL, URLSearchParams });
  const url = new URL(
    metaOauth.buildMetaAuthorizationUrl({ appId: "ig-app-id", redirectUri: "https://example.test/api/meta/callback", state: "state-1" }),
  );
  assert.equal(url.origin + url.pathname, "https://www.instagram.com/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "ig-app-id");
  assert.equal(url.searchParams.get("response_type"), "code");
  const scopes = url.searchParams.get("scope").split(",");
  assert.deepEqual(scopes, ["instagram_business_basic", "instagram_business_content_publish"]);

  const obsoleteScopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
  ];
  for (const scope of obsoleteScopes) {
    assert.ok(!scopes.includes(scope), `obsolete scope "${scope}" must never be requested`);
  }
});
