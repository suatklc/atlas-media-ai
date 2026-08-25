import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { module: loadedModule, exports: loadedModule.exports, require: dependencyLoader, ...globals };
  vm.runInNewContext(
    `(function (module, exports, require) { ${output}\n})(module, exports, require);`,
    context,
  );
  return loadedModule.exports;
}

const SECRET_TOKEN = "SUPER_SECRET_TOKEN_VALUE";
const SECRET_VAULT_ID = "11111111-2222-3333-4444-555555555555";

function containsAnySecret(html) {
  return html.includes(SECRET_TOKEN) || html.includes(SECRET_VAULT_ID) || html.includes("credential_secret_id");
}

// Loads SocialAccounts.tsx with every dependency mocked: a fake Supabase
// client whose connected_accounts row includes a live credential_secret_id
// and a plaintext-shaped token field, so the test can prove the component's
// only path to that data (listConnectedMetaAccounts) strips both before
// anything reaches render.
function loadSocialAccounts({ user, rows, queryError = null }) {
  // react/jsx-runtime's jsx/jsxs signature is (type, props, key) — key is a
  // separate positional argument, NOT part of props. React.createElement's
  // signature is (type, config, ...children), so passing key straight
  // through as a third argument makes createElement treat it as a child
  // instead. This shim folds key into props the way the real runtime does.
  function jsx(type, props, key) {
    const { children, ...rest } = props ?? {};
    const finalProps = key !== undefined ? { ...rest, key } : rest;
    return children !== undefined
      ? React.createElement(type, finalProps, children)
      : React.createElement(type, finalProps);
  }
  const reactRuntime = { jsx, jsxs: jsx, Fragment: React.Fragment };
  const callTracker = { fromCalls: 0 };

  const supabaseServerMock = {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user } }) },
      from: () => {
        callTracker.fromCalls += 1;
        return {
          select: () => ({
            eq: () => ({
              eq: async () => (queryError ? { data: null, error: queryError } : { data: rows, error: null }),
            }),
          }),
        };
      },
    }),
  };

  const queryModule = loadTypeScriptModule(
    "src/lib/publishing/connections/query.ts",
    () => ({}),
    { console },
  );

  const platformConfigModule = loadTypeScriptModule(
    "src/lib/ai/platform/config.ts",
    () => ({}),
    {},
  );

  const mod = loadTypeScriptModule(
    "src/components/dashboard/SocialAccounts.tsx",
    (specifier) =>
      ({
        "@/lib/supabase/server": supabaseServerMock,
        "@/lib/publishing/connections/query": queryModule,
        "@/lib/ai/platform/config": platformConfigModule,
        "react/jsx-runtime": reactRuntime,
        react: React,
      })[specifier] ?? {},
    { console },
  );

  return { mod, callTracker };
}

test("SocialAccounts: no connected accounts renders the honest empty state", async () => {
  const { mod } = loadSocialAccounts({ user: { id: "user-1" }, rows: [] });
  const element = await mod.default({});
  const html = renderToStaticMarkup(element);
  assert.match(html, /Bağlı hesap yok/);
});

test("SocialAccounts: a connected Instagram account is listed with platform label and connected status", async () => {
  const { mod } = loadSocialAccounts({
    user: { id: "user-1" },
    rows: [
      {
        id: "row-1",
        provider: "meta",
        platform: "instagram",
        external_account_id: "ig-123",
        external_account_name: "atlas.emlak",
        token_expires_at: null,
        credential_secret_id: SECRET_VAULT_ID,
      },
    ],
  });
  const element = await mod.default({});
  const html = renderToStaticMarkup(element);
  assert.match(html, /Instagram/);
  assert.match(html, /atlas\.emlak/);
  assert.match(html, /Bağlı/);
  assert.ok(!containsAnySecret(html), "rendered HTML must never contain the vault secret id or a token");
});

test("SocialAccounts: a connected Facebook account is listed and a missing credential shows the honest 'eksik' state", async () => {
  const { mod } = loadSocialAccounts({
    user: { id: "user-1" },
    rows: [
      {
        id: "row-2",
        provider: "meta",
        platform: "facebook",
        external_account_id: "page-1",
        external_account_name: "Atlas Emlak",
        token_expires_at: null,
        credential_secret_id: null,
      },
    ],
  });
  const element = await mod.default({});
  const html = renderToStaticMarkup(element);
  assert.match(html, /Facebook/);
  assert.match(html, /Atlas Emlak/);
  assert.match(html, /Kimlik bilgisi eksik/);
});

test("SocialAccounts: a malformed/legacy row (missing external_account_name) never throws and falls back to the raw id", async () => {
  const { mod } = loadSocialAccounts({
    user: { id: "user-1" },
    rows: [
      {
        id: "row-3",
        provider: "meta",
        platform: "instagram",
        external_account_id: "ig-legacy",
        external_account_name: null,
        token_expires_at: null,
        credential_secret_id: SECRET_VAULT_ID,
      },
    ],
  });
  const element = await mod.default({});
  const html = renderToStaticMarkup(element);
  assert.match(html, /ig-legacy/);
  assert.ok(!containsAnySecret(html));
});

test("SocialAccounts: a query error is handled quietly and never thrown, rendering the empty state", async () => {
  const { mod } = loadSocialAccounts({
    user: { id: "user-1" },
    rows: null,
    queryError: { message: "db unavailable" },
  });
  const element = await mod.default({});
  const html = renderToStaticMarkup(element);
  assert.match(html, /Bağlı hesap yok/);
});

test("SocialAccounts: connectionStatus 'success' shows the success banner; anything else shows no invented banner", async () => {
  const { mod } = loadSocialAccounts({ user: { id: "user-1" }, rows: [] });

  const successHtml = renderToStaticMarkup(await mod.default({ connectionStatus: "success" }));
  assert.match(successHtml, /başarıyla bağlandı/);

  const noBannerHtml = renderToStaticMarkup(await mod.default({}));
  assert.doesNotMatch(noBannerHtml, /başarıyla bağlandı/);

  const unknownStatusHtml = renderToStaticMarkup(await mod.default({ connectionStatus: "failure" }));
  assert.doesNotMatch(unknownStatusHtml, /başarıyla bağlandı/);
});

test("SocialAccounts: the connect control targets the existing /api/meta/connect route", async () => {
  const { mod } = loadSocialAccounts({ user: { id: "user-1" }, rows: [] });
  const html = renderToStaticMarkup(await mod.default({}));
  assert.match(html, /href="\/api\/meta\/connect"/);
});

test("SocialAccounts: an unauthenticated user renders the empty state without ever querying connected_accounts", async () => {
  const { mod, callTracker } = loadSocialAccounts({ user: null, rows: [{ id: "should-not-be-used" }] });
  const html = renderToStaticMarkup(await mod.default({}));
  assert.match(html, /Bağlı hesap yok/);
  assert.equal(callTracker.fromCalls, 0, "connected_accounts must never be queried for a signed-out user");
});
