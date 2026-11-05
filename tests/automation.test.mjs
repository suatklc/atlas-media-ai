import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

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

const read = (relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
const automation = loadTypeScriptModule("src/lib/automation/dailyContent.ts", () => ({}), { console: { log() {}, error() {} } });

// ===== In-memory stand-in for the service-role Supabase client =====

function fakeAdmin({ claimConflict = false, reclaimRows = [], postId = "post-1", notificationInsertError = null } = {}) {
  const log = [];
  const respond = (q) => {
    if (q.table === "automation_runs" && q.op === "insert") {
      return { data: null, error: claimConflict ? { code: "23505", message: "duplicate key" } : null };
    }
    if (q.table === "automation_runs" && q.op === "update" && q.filters.some(([kind]) => kind === "or")) {
      return { data: reclaimRows, error: null };
    }
    if (q.table === "generated_posts" && q.op === "select") return { data: postId ? { id: postId } : null, error: null };
    if (q.table === "notifications" && q.op === "insert") {
      return notificationInsertError ? { data: null, error: notificationInsertError } : { data: { id: `n-${log.length}` }, error: null };
    }
    return { data: null, error: null };
  };
  const from = (table) => {
    const q = { table, op: null, payload: null, filters: [] };
    const api = {
      insert(payload) { q.op = "insert"; q.payload = payload; return api; },
      update(payload) { q.op = "update"; q.payload = payload; return api; },
      select() { if (!q.op) q.op = "select"; return api; },
      eq(key, value) { q.filters.push(["eq", key, value]); return api; },
      or(expr) { q.filters.push(["or", expr]); return api; },
      single() { return api; },
      maybeSingle() { return api; },
      then(resolve, reject) { log.push(q); return Promise.resolve(respond(q)).then(resolve, reject); },
    };
    return api;
  };
  return { from, log };
}

const ideaItem = (n) => ({ kind: "idea", label: `Etiket ${n}`, title: `Fikir ${n}`, reason: "r", format: "f", instruction: `Talimat ${n} için yeterince uzun bir uzman talimatı.`, ideaId: `idea-${n}` });
const currentItem = { kind: "current", label: "Güncel/Trend", title: "Tapu işlemlerinde yeni düzenleme", reason: "r", opportunity: { topic: "Tapu işlemlerinde yeni düzenleme", sources: [] } };
const PLAN = { items: [ideaItem(1), ideaItem(2), ideaItem(3), currentItem], alternates: [], radar: "used" };

function deps(overrides = {}) {
  const calls = { plan: 0, pkg: [], visual: [], telegram: [] };
  const admin = overrides.admin ?? fakeAdmin();
  return {
    calls,
    admin,
    value: {
      admin,
      userId: "user-1",
      siteUrl: "https://atlas-media-ai.vercel.app",
      buildPlan: async () => { calls.plan += 1; return overrides.plan ?? { status: 200, data: PLAN }; },
      generatePackage: async (body) => { calls.pkg.push(body); return overrides.pkg ?? { status: 200, data: { contentPackage: { topic: "t" } } }; },
      generateVisual: async (body) => { calls.visual.push(body); return overrides.visual ?? { status: 200, data: { images: [{ slide: 1, imageUrl: "https://cdn/cover.png" }] } }; },
      sendTelegram: async (text, url) => { calls.telegram.push({ text, url }); return overrides.telegram ?? { ok: true }; },
    },
  };
}

const MONDAY = new Date("2026-11-02T04:10:00.000Z");
const WEDNESDAY = new Date("2026-11-04T04:10:00.000Z");
const SATURDAY = new Date("2026-11-07T04:10:00.000Z");

test("schedule: the run day is read in Europe/Istanbul, so 04:00 UTC is 07:00 on the same day all year (no DST assumption)", () => {
  for (const [utc, day, weekday] of [
    ["2026-01-05T04:00:00.000Z", "2026-01-05", 1],
    ["2026-03-30T04:00:00.000Z", "2026-03-30", 1],
    ["2026-07-06T04:59:00.000Z", "2026-07-06", 1],
    ["2026-10-26T04:00:00.000Z", "2026-10-26", 1],
    ["2026-11-07T04:30:00.000Z", "2026-11-07", 6],
    ["2026-12-31T21:30:00.000Z", "2027-01-01", 5],
  ]) {
    assert.deepEqual({ ...automation.turkeyRunDay(new Date(utc)) }, { runKey: day, weekday }, utc);
  }
});

test("schedule: Turkey-local day decides the run (Mon/Tue/Thu/Sat -> plan slots 0..3)", () => {
  assert.equal(automation.turkeyRunDay(new Date("2026-11-01T22:30:00.000Z")).runKey, "2026-11-02", "01:30 Turkey on Monday");
  assert.equal(automation.turkeyRunDay(MONDAY).weekday, 1);
  assert.deepEqual([1, 2, 4, 6].map(automation.slotForWeekday), [0, 1, 2, 3]);
  assert.deepEqual([0, 3, 5].map(automation.slotForWeekday), [undefined, undefined, undefined]);
});

test("not a run day -> nothing is claimed or generated", async () => {
  const d = deps();
  const outcome = await automation.runDailyContent(WEDNESDAY, d.value);
  assert.equal(outcome.status, "not-a-run-day");
  assert.equal(d.admin.log.length, 0);
  assert.equal(d.calls.plan, 0);
});

test("Monday: ONE draft through the existing handlers, run recorded, in-app + Telegram notification with a direct draft link", async () => {
  const d = deps();
  const outcome = await automation.runDailyContent(MONDAY, d.value);
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.postId, "post-1");
  assert.equal(d.calls.pkg.length, 1);
  assert.equal(d.calls.visual.length, 1);
  assert.equal(d.calls.pkg[0].instruction, PLAN.items[0].instruction, "Monday = plan slot 0, expert instruction flow");
  assert.equal(d.calls.visual[0].message, PLAN.items[0].instruction);
  assert.equal(d.calls.visual[0].contentPackage.topic, "t", "the visual uses the package just generated");

  const claim = d.admin.log.find((q) => q.table === "automation_runs" && q.op === "insert");
  assert.equal(claim.payload.run_key, "2026-11-02");
  assert.equal(claim.payload.user_id, "user-1");
  const done = d.admin.log.find((q) => q.table === "automation_runs" && q.op === "update" && q.payload.status === "succeeded");
  assert.equal(done.payload.post_id, "post-1");

  const notification = d.admin.log.find((q) => q.table === "notifications" && q.op === "insert");
  assert.equal(notification.payload.kind, "draft_ready");
  assert.equal(notification.payload.link, "/dashboard#draft-post-1");
  assert.equal(d.calls.telegram.length, 1);
  assert.equal(d.calls.telegram[0].url, "https://atlas-media-ai.vercel.app/dashboard#draft-post-1");
  assert.match(d.calls.telegram[0].text, /Onaylamadan hiçbir yerde yayınlanmaz/);
  const delivery = d.admin.log.find((q) => q.table === "notifications" && q.op === "update");
  assert.equal(delivery.payload.telegram_status, "sent");
});

test("Saturday: a current (Radar) topic goes through the existing opportunity flow", async () => {
  const d = deps();
  await automation.runDailyContent(SATURDAY, d.value);
  assert.equal(d.calls.pkg[0].contentOpportunity.topic, currentItem.title);
  assert.equal(d.calls.pkg[0].instruction, undefined);
  assert.equal(d.calls.visual[0].contentOpportunity.topic, currentItem.title);
});

test("a second / concurrent invocation for the same day does nothing (unique run lock)", async () => {
  const d = deps({ admin: fakeAdmin({ claimConflict: true, reclaimRows: [] }) });
  const outcome = await automation.runDailyContent(MONDAY, d.value);
  assert.equal(outcome.status, "already-handled");
  assert.equal(d.calls.plan, 0);
  assert.equal(d.calls.pkg.length, 0);
  assert.equal(d.calls.telegram.length, 0);
});

test("a failed (or stale running) day may be claimed again; a live running or succeeded day may not", async () => {
  const d = deps({ admin: fakeAdmin({ claimConflict: true, reclaimRows: [{ id: "run-1" }] }) });
  assert.equal((await automation.runDailyContent(MONDAY, d.value)).status, "succeeded");
  const reclaim = d.admin.log.find((q) => q.table === "automation_runs" && q.op === "update" && q.filters.some(([k]) => k === "or"));
  const orExpr = reclaim.filters.find(([k]) => k === "or")[1];
  assert.match(orExpr, /^status\.eq\.failed,and\(status\.eq\.running,started_at\.lt\.2026-11-02T04:00:00\.000Z\)$/, "running only when older than 10 minutes");
});

test("a generation failure is recorded, notified in-app + Telegram, and never leaves a draft claimed as success", async () => {
  const d = deps({ pkg: { status: 502, data: { error: "İçerik kalite kontrolünden geçemedi." } } });
  const outcome = await automation.runDailyContent(MONDAY, d.value);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error, /içerik \(502\): İçerik kalite kontrolünden geçemedi/);
  assert.equal(d.calls.visual.length, 0, "no visual for a failed package");
  const failed = d.admin.log.find((q) => q.table === "automation_runs" && q.op === "update" && q.payload.status === "failed");
  assert.ok(failed.payload.error);
  const notification = d.admin.log.find((q) => q.table === "notifications" && q.op === "insert");
  assert.equal(notification.payload.kind, "run_failed");
  assert.equal(d.calls.telegram.length, 1);
});

test("a missing saved draft (generate-visual insert failed) is a failure, not a success", async () => {
  const d = deps({ admin: fakeAdmin({ postId: null }) });
  const outcome = await automation.runDailyContent(MONDAY, d.value);
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error, /taslak kaydı bulunamadı/);
});

test("a Telegram failure is recorded on the notification; the draft itself still succeeds", async () => {
  const d = deps({ telegram: { ok: false, error: "Telegram 400: chat not found" } });
  const outcome = await automation.runDailyContent(MONDAY, d.value);
  assert.equal(outcome.status, "succeeded");
  const delivery = d.admin.log.find((q) => q.table === "notifications" && q.op === "update");
  assert.equal(delivery.payload.telegram_status, "failed");
  assert.equal(delivery.payload.telegram_error, "Telegram 400: chat not found");
});

// ===== Telegram =====

function loadTelegram(env, fetchImpl) {
  return loadTypeScriptModule("src/lib/notifications/telegram.ts", () => ({}), {
    process: { env },
    fetch: fetchImpl,
    AbortSignal,
    JSON,
  });
}
const TOKEN = "123456:SECRET-TOKEN-VALUE";

test("Telegram: not configured -> skipped, no request", async () => {
  let called = false;
  const telegram = loadTelegram({}, async () => { called = true; });
  const result = await telegram.sendTelegramMessage("x");
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});

test("Telegram: sends only to the configured chat id, link as an https button", async () => {
  let request;
  const telegram = loadTelegram({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42" }, async (url, init) => { request = { url, body: JSON.parse(init.body) }; return { ok: true }; });
  const result = await telegram.sendTelegramMessage("Merhaba", "https://atlas-media-ai.vercel.app/dashboard#draft-1");
  assert.equal(result.ok, true);
  assert.equal(request.body.chat_id, "42");
  assert.equal(request.body.reply_markup.inline_keyboard[0][0].url, "https://atlas-media-ai.vercel.app/dashboard#draft-1");
  const noButton = loadTelegram({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42" }, async (url, init) => { request = { body: JSON.parse(init.body) }; return { ok: true }; });
  await noButton.sendTelegramMessage("x", "http://localhost:3000/dashboard");
  assert.equal(request.body.reply_markup, undefined, "Telegram rejects non-https buttons");
});

test("Telegram: the bot token never appears in a returned error", async () => {
  const failing = loadTelegram({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42" }, async (url) => { throw new TypeError(`fetch failed for ${url}`); });
  const thrown = await failing.sendTelegramMessage("x");
  assert.equal(thrown.ok, false);
  assert.doesNotMatch(thrown.error, /SECRET-TOKEN-VALUE/);
  const rejected = loadTelegram({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "42" }, async () => ({ ok: false, status: 401, json: async () => ({ description: "Unauthorized" }) }));
  const result = await rejected.sendTelegramMessage("x");
  assert.equal(result.error, "Telegram 401: Unauthorized");
  assert.doesNotMatch(read("src/lib/notifications/telegram.ts"), /console\./, "the module itself never logs");
});

// ===== Cron route =====

function loadCron(env, overrides = {}) {
  const state = { ran: 0, adminCreated: 0 };
  const route = loadTypeScriptModule(
    "src/app/api/cron/daily-content/route.ts",
    (specifier) => {
      if (specifier === "node:crypto") return nodeRequire("node:crypto");
      if (specifier === "@/lib/supabase/admin") return { createAdminClient: () => { state.adminCreated += 1; return { auth: {} }; } };
      if (specifier === "@/lib/supabase/server") return { runAsAutomationUser: (_client, _userId, fn) => fn() };
      if (specifier === "@/lib/automation/dailyContent") {
        return { runDailyContent: async () => { state.ran += 1; return overrides.outcome ?? { status: "succeeded", runKey: "2026-11-02", postId: "p" }; } };
      }
      return { POST: async () => new Response("{}"), sendTelegramMessage: async () => ({ ok: true }) };
    },
    { process: { env }, Response, Request, URL, Buffer, console: { log() {}, error() {} } },
  );
  return { route, state };
}
const ENV = { CRON_SECRET: "cron-secret-1", AUTOMATION_ENABLED: "true", ATLAS_AUTOMATION_USER_ID: "user-1", NEXT_PUBLIC_SITE_URL: "https://atlas-media-ai.vercel.app" };
const cronRequest = (auth) => new Request("https://atlas-media-ai.vercel.app/api/cron/daily-content", { headers: auth ? { authorization: auth } : {} });

test("cron: missing or wrong CRON_SECRET -> 401, nothing runs", async () => {
  for (const auth of [undefined, "Bearer wrong", "cron-secret-1"]) {
    const { route, state } = loadCron(ENV);
    const response = await route.GET(cronRequest(auth));
    assert.equal(response.status, 401, String(auth));
    assert.equal(state.ran, 0);
    assert.equal(state.adminCreated, 0, "no service-role client (so no DB access) before authorization");
  }
  const { route, state } = loadCron({ ...ENV, CRON_SECRET: "" });
  assert.equal((await route.GET(cronRequest("Bearer "))).status, 401, "no secret configured never authorizes");
  assert.equal(state.ran, 0);
});

test("cron: authorized but AUTOMATION_ENABLED not 'true' -> disabled, nothing runs", async () => {
  const { route, state } = loadCron({ ...ENV, AUTOMATION_ENABLED: "" });
  const response = await route.GET(cronRequest("Bearer cron-secret-1"));
  assert.equal((await response.json()).status, "disabled");
  assert.equal(state.ran, 0);
  assert.equal(state.adminCreated, 0);
});

test("cron: enabled + authorized -> one run; a missing automation user is a config error", async () => {
  const ok = loadCron(ENV);
  const response = await ok.route.GET(cronRequest("Bearer cron-secret-1"));
  assert.equal(response.status, 200);
  assert.equal(ok.state.ran, 1);
  const missing = loadCron({ ...ENV, ATLAS_AUTOMATION_USER_ID: "" });
  assert.equal((await missing.route.GET(cronRequest("Bearer cron-secret-1"))).status, 500);
  assert.equal(missing.state.ran, 0);
});

test("cron contracts: Hobby-compatible schedule (once per day, 07:00 Turkey), fra1, <= 300 s, never publishes", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.deepEqual(config.crons, [{ path: "/api/cron/daily-content", schedule: "0 4 * * 1,2,4,6" }]);
  assert.deepEqual(config.functions["src/app/api/cron/daily-content/route.ts"], { regions: ["fra1"] });
  const route = read("src/app/api/cron/daily-content/route.ts");
  assert.match(route, /export const maxDuration = 300;/);
  assert.match(route, /timingSafeEqual/);
  for (const file of ["src/app/api/cron/daily-content/route.ts", "src/lib/automation/dailyContent.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /@\/lib\/publishing|publishToSelectedPlatforms|publishGeneratedPost/, file);
    assert.doesNotMatch(source, /status: "approved"|status: "posted"/, file);
  }
});

// ===== Session context =====

test("createClient: inside runAsAutomationUser it returns the run's client pinned to that user; outside it uses the cookie session", async () => {
  let cookieCalls = 0;
  const server = loadTypeScriptModule("src/lib/supabase/server.ts", (specifier) => {
    if (specifier === "node:async_hooks") return nodeRequire("node:async_hooks");
    if (specifier === "next/headers") return { cookies: async () => { cookieCalls += 1; return { getAll: () => [] }; } };
    if (specifier === "@supabase/ssr") return { createServerClient: () => ({ kind: "cookie-client" }) };
    return {};
  }, { process: { env: {} } });
  const runClient = { kind: "run-client", auth: { getUser: async () => ({ data: { user: null } }) } };
  const inside = await server.runAsAutomationUser(runClient, "user-1", async () => {
    const client = await server.createClient();
    return { kind: client.kind, user: (await client.auth.getUser()).data.user.id };
  });
  assert.deepEqual(inside, { kind: "run-client", user: "user-1" });
  assert.equal(cookieCalls, 0);
  assert.equal((await server.createClient()).kind, "cookie-client");
  assert.equal(cookieCalls, 1);
});

// ===== Database, reject, bell =====

test("migration 0004: unique run lock, RLS on both tables, owners may only mark notifications read", () => {
  const sql = read("supabase/migrations/0004_automation.sql");
  assert.match(sql, /unique \(user_id, run_key\)/);
  assert.match(sql, /alter table public\.automation_runs enable row level security/);
  assert.match(sql, /alter table public\.notifications enable row level security/);
  assert.match(sql, /grant update \(read_at\) on public\.notifications to authenticated/);
  assert.doesNotMatch(sql, /for insert/, "only the server (service role) writes runs and notifications");
});

test("reject: drafts only, status stays draft, a rejected draft can never be approved and leaves the list", () => {
  const review = loadTypeScriptModule("src/lib/automation/review.ts");
  assert.equal(review.isRejectedDraft({ review: { state: "rejected" } }), true);
  assert.equal(review.isRejectedDraft({}), false);
  assert.equal(review.isRejectedDraft(null), false);
  const actions = read("src/app/dashboard/actions.ts");
  const reject = actions.slice(actions.indexOf("export async function rejectPostAction"));
  assert.match(reject, /\.eq\("status", "draft"\)/);
  assert.doesNotMatch(reject.slice(0, reject.indexOf("// ===== Facebook")), /status: "/, "rejecting never writes status");
  assert.match(actions, /if \(isRejectedDraft\(current\?\.metadata\)\) \{\s*return \{ error: "Reddedilen taslak onaylanamaz\." \};/);
  assert.match(read("src/components/dashboard/GenerationHistory.tsx"), /filter\(\(post\) => !isRejectedDraft\(post\.metadata\)\)/);
  assert.match(read("src/components/dashboard/GenerationHistory.tsx"), /id=\{`draft-\$\{post\.id\}`\}/, "notification links land on the draft card");
});

test("bell: the unread dot shows only when there are unread notifications", () => {
  const bell = read("src/components/layout/NotificationBell.tsx");
  assert.match(bell, /\{unread > 0 && <span/);
  assert.match(read("src/components/layout/Topbar.tsx"), /<NotificationBell \/>/);
});

test("privilege boundary: only the cron route can create the service-role client or enter the automation session", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(rel);
    }
  };
  walk("src");
  const users = files.filter((file) => /createAdminClient|runAsAutomationUser|SUPABASE_SERVICE_ROLE_KEY/.test(read(file)));
  assert.deepEqual(users.sort(), ["src/app/api/cron/daily-content/route.ts", "src/lib/supabase/admin.ts", "src/lib/supabase/server.ts"]);
  assert.match(read("src/lib/supabase/admin.ts"), /^import "server-only";/, "never bundled for the browser");
  const route = read("src/app/api/cron/daily-content/route.ts");
  const get = route.slice(route.indexOf("export async function GET"));
  assert.ok(get.indexOf("isAuthorized(request)") < get.indexOf("createAdminClient()"), "authorization before the service-role client");
  assert.ok(get.indexOf("AUTOMATION_ENABLED") < get.indexOf("createAdminClient()"), "kill switch before the service-role client");
});

// 2026-11-05 first scheduled run: the cron function's bundle lacked the
// resvg wasm (read at runtime via fs), so carousel composition failed.
test("the cron route's bundle includes every file the carousel renderer reads at runtime, same as generate-visual", () => {
  const config = read("next.config.ts");
  assert.match(config, /"\/api\/generate-visual": RENDER_ASSETS,/);
  assert.match(config, /"\/api\/cron\/daily-content": RENDER_ASSETS,/);
  for (const asset of ["index_bg.wasm", "Inter.ttf", "PlayfairDisplay-Bold.ttf", "suat-kilic-logo.png"]) {
    assert.ok(config.slice(0, config.indexOf("const nextConfig")).includes(asset), asset);
  }
});
