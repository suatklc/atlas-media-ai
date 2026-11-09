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

const review = loadTypeScriptModule("src/lib/automation/review.ts");
const flow = loadTypeScriptModule(
  "src/lib/automation/telegramReview.ts",
  (specifier) => (specifier === "./review" ? review : {}),
  { console: { log() {}, error() {} }, Date, Number, String, Boolean, JSON, Error },
);

// ===== In-memory database with the behaviours the flow relies on =====

function fakeDb() {
  const tables = { telegram_updates: [], telegram_jobs: [], generated_posts: [] };
  let seq = 0;
  const matches = (row, filters) =>
    filters.every(([op, key, value]) => (op === "eq" ? row[key] === value : op === "in" ? value.includes(row[key]) : op === "lt" ? String(row[key]) < String(value) : true));
  const from = (table) => {
    const q = { op: "select", filters: [], payload: null, order: null, limit: null, returning: false, single: false };
    const run = () => {
      const rows = tables[table];
      if (q.op === "insert") {
        if (table === "telegram_updates" && rows.some((r) => r.update_id === q.payload.update_id)) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `${table}-${++seq}`, updated_at: new Date().toISOString(), ...q.payload };
        rows.push(row);
        return { data: q.single ? row : [row], error: null };
      }
      let found = rows.filter((r) => matches(r, q.filters));
      if (q.op === "update") {
        found.forEach((r) => Object.assign(r, q.payload));
        return { data: q.returning ? found.map((r) => ({ ...r })) : null, error: null };
      }
      if (q.order) found = found.slice().sort((a, b) => (q.order.ascending ? 1 : -1) * String(a[q.order.key]).localeCompare(String(b[q.order.key])));
      if (q.limit) found = found.slice(0, q.limit);
      if (q.single) return { data: found[0] ? { ...found[0] } : null, error: null };
      return { data: found.map((r) => ({ ...r })), error: null };
    };
    const api = {
      insert(payload) { q.op = "insert"; q.payload = payload; return api; },
      update(payload) { q.op = "update"; q.payload = payload; return api; },
      select() { if (q.op !== "select") q.returning = true; return api; },
      eq(key, value) { q.filters.push(["eq", key, value]); return api; },
      in(key, values) { q.filters.push(["in", key, values]); return api; },
      lt(key, value) { q.filters.push(["lt", key, value]); return api; },
      order(key, opts) { q.order = { key, ascending: opts?.ascending !== false }; return api; },
      limit(n) { q.limit = n; return api; },
      single() { q.single = true; return api; },
      maybeSingle() { q.single = true; return api; },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  };
  return { from, tables };
}

const CHAT = "424242";
let updateSeq = 1000;

function harness(overrides = {}) {
  const db = fakeDb();
  const calls = { pkg: [], visual: [], publish: [], sent: [], photos: [], answers: [], cleared: [], transcribed: 0 };
  const deps = {
    admin: db,
    userId: "user-1",
    authorizedChatId: CHAT,
    actionsEnabled: overrides.actionsEnabled ?? true,
    generatePackage: async (body) => {
      calls.pkg.push(body);
      return overrides.pkg ?? { status: 200, data: { contentPackage: { caption: "Örnek caption", hashtags: ["#Zekeriyaköy"] } } };
    },
    generateVisual: async (body, reuse) => {
      calls.visual.push({ body, reuse });
      if (overrides.visual) return overrides.visual;
      const n = calls.visual.length;
      const urls = [1, 2, 3, 4, 5].map((s) => `https://cdn/run${n}/slide${s}.png`);
      db.tables.generated_posts.push({ id: `post-${n}`, user_id: "user-1", status: "draft", final_image_url: urls[0], base_image_url: `https://cdn/run${n}/base.png`, metadata: {} });
      return { status: 200, data: { images: urls.map((imageUrl, i) => ({ slide: i + 1, imageUrl })) } };
    },
    publish: async (postId, platforms) => {
      calls.publish.push({ postId, platforms });
      if (overrides.publish) return overrides.publish(postId, platforms, db);
      const post = db.tables.generated_posts.find((p) => p.id === postId);
      post.status = "posted";
      post.metadata = { ...post.metadata, instagramMediaId: "ig-media-1", publishResults: { facebook: { state: "published", postId: "page_1" } } };
      return { error: null, results: platforms.map((platform) => ({ platform, status: "published", message: "Paylaşıldı" })) };
    },
    instagramPermalink: async () => "https://www.instagram.com/p/ABC/",
    transcribe: async () => { calls.transcribed += 1; return overrides.transcribe ?? { ok: true, text: "Zekeriyaköy'de arsa sahiplerine imar durumunu anlatan bir paylaşım hazırla" }; },
    telegram: {
      sendText: async (text, buttons) => { calls.sent.push({ text, buttons }); return { ok: true, result: {} }; },
      sendPhotos: async (urls, caption) => { calls.photos.push({ urls, caption }); return { ok: true, result: [] }; },
      answerCallback: async (_id, text) => { calls.answers.push(text); return { ok: true, result: true }; },
      clearButtons: async (id) => { calls.cleared.push(id); return { ok: true, result: true }; },
      downloadVoice: async () => ({ ok: true, bytes: Buffer.from("ogg") }),
    },
  };
  const send = (text, from = CHAT) => flow.handleTelegramUpdate({ update_id: ++updateSeq, message: { message_id: 1, from: { id: Number(from) }, chat: { id: Number(from), type: "private" }, text } }, deps);
  const press = (data, from = CHAT) =>
    flow.handleTelegramUpdate({ update_id: ++updateSeq, callback_query: { id: `cb-${updateSeq}`, from: { id: Number(from) }, data, message: { message_id: 77, chat: { id: Number(from), type: "private" } } } }, deps);
  const lastButtons = () => [...([...calls.sent].reverse().find((m) => m.buttons)?.buttons.flat().map((b) => b.data) ?? [])];
  const job = () => db.tables.telegram_jobs[db.tables.telegram_jobs.length - 1];
  return { db, calls, deps, send, press, lastButtons, job };
}

const INSTRUCTION = "Zekeriyaköy'de villasını satmak isteyenlere doğru fiyatlandırmayı anlatan bir paylaşım hazırla";

// ===== Authorization and duplicates =====

test("an unauthorized user or chat is ignored before anything is stored or generated", async () => {
  const h = harness();
  assert.equal(await h.send(INSTRUCTION, "999"), "ignored-unauthorized");
  assert.equal(h.db.tables.telegram_updates.length, 0);
  assert.equal(h.calls.pkg.length, 0);
  assert.equal(h.calls.sent.length, 0);
});

test("a re-delivered update (same update_id) is processed once — no second generation", async () => {
  const h = harness();
  const update = { update_id: 5000, message: { message_id: 1, from: { id: Number(CHAT) }, chat: { id: Number(CHAT), type: "private" }, text: INSTRUCTION } };
  assert.equal(await flow.handleTelegramUpdate(update, h.deps), "started");
  assert.equal(await flow.handleTelegramUpdate(update, h.deps), "duplicate");
  assert.equal(h.calls.pkg.length, 1);
  assert.equal(h.calls.visual.length, 1);
});

// ===== Instruction -> draft -> preview =====

test("an instruction produces one draft and a Telegram preview: 5 photos + caption + Onayla/Düzelt/Reddet", async () => {
  const h = harness();
  assert.equal(await h.send(INSTRUCTION), "started");
  assert.deepEqual({ ...h.calls.pkg[0] }, { instruction: INSTRUCTION, visualFormat: "carousel" });
  assert.equal(h.calls.visual[0].reuse, undefined, "a first draft gets a fresh image");
  assert.equal(h.calls.photos.length, 1);
  assert.equal(h.calls.photos[0].urls.length, 5);
  const job = h.job();
  assert.equal(job.state, "awaiting_review");
  assert.equal(job.post_id, "post-1");
  assert.deepEqual(h.lastButtons(), [`a:${job.id}:1`, `d:${job.id}:1`, `r:${job.id}:1`]);
  assert.match(h.calls.sent.at(-1).text, /Örnek caption/);
});

test("voice instructions are transcribed and used as the instruction; a failed transcription creates nothing", async () => {
  const h = harness();
  const voice = (deps) => flow.handleTelegramUpdate({ update_id: ++updateSeq, message: { message_id: 2, from: { id: Number(CHAT) }, chat: { id: Number(CHAT), type: "private" }, voice: { file_id: "f1" } } }, deps);
  assert.equal(await voice(h.deps), "started");
  assert.equal(h.calls.transcribed, 1);
  assert.match(h.calls.pkg[0].instruction, /imar durumunu/);

  const failing = harness({ transcribe: { ok: false, error: "anlaşılmadı" } });
  assert.equal(await voice(failing.deps), "rejected-input");
  assert.equal(failing.calls.pkg.length, 0);
  assert.equal(failing.db.tables.telegram_jobs.length, 0);
});

test("a second instruction while one is being generated is refused (no parallel paid generation)", async () => {
  const h = harness();
  h.db.tables.telegram_jobs.push({ id: "busy-job", user_id: "user-1", instruction: "x", post_id: null, state: "generating", revision: 1, updated_at: new Date().toISOString() });
  assert.equal(await h.send(INSTRUCTION), "busy");
  assert.equal(h.calls.pkg.length, 0);
});

test("a generation failure marks the job failed and reports it; no review buttons are sent", async () => {
  const h = harness({ pkg: { status: 502, data: { error: "İçerik kalite kontrolünden geçemedi." } } });
  await h.send(INSTRUCTION);
  assert.equal(h.job().state, "failed");
  assert.equal(h.calls.visual.length, 0);
  assert.match(h.calls.sent.at(-1).text, /Taslak hazırlanamadı/);
  assert.equal(h.lastButtons().length, 0);
});

// ===== Approve -> explicit publish =====

test("Onayla only approves; publishing needs the separate platform choice; a second tap changes nothing", async () => {
  const h = harness();
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`a:${job.id}:1`);
  assert.equal(h.db.tables.generated_posts[0].status, "approved");
  assert.equal(h.calls.publish.length, 0, "approval never publishes");
  assert.deepEqual(h.lastButtons(), [`p:${job.id}:1:both`, `p:${job.id}:1:ig`, `p:${job.id}:1:fb`, `d:${job.id}:1`]);

  await h.press(`a:${job.id}:1`);
  assert.equal(h.calls.answers.at(-1), "Bu taslak zaten işlendi.");
});

test("publish choice publishes once to exactly the chosen platforms and reports per-platform results with links", async () => {
  const h = harness();
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`a:${job.id}:1`);
  await h.press(`p:${job.id}:1:both`);
  assert.deepEqual(h.calls.publish.map((c) => ({ postId: c.postId, platforms: [...c.platforms] })), [{ postId: "post-1", platforms: ["instagram", "facebook"] }]);
  const report = h.calls.sent.at(-1).text;
  assert.match(report, /✅ Instagram: yayınlandı — https:\/\/www\.instagram\.com\/p\/ABC\//);
  assert.match(report, /✅ Facebook: yayınlandı — https:\/\/www\.facebook\.com\/page_1/);
  assert.equal(h.job().state, "published");

  await h.press(`p:${job.id}:1:both`);
  assert.equal(h.calls.publish.length, 1, "a repeated publish tap never publishes again");
});

test("a failed platform leaves the job approved with retry buttons; publish without approval is refused", async () => {
  const h = harness({
    publish: async (_postId, platforms) => ({
      error: null,
      results: platforms.map((platform) => (platform === "facebook" ? { platform, status: "failed", message: "Page token yok" } : { platform, status: "published", message: "ok" })),
    }),
  });
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`p:${job.id}:1:both`);
  assert.equal(h.calls.publish.length, 0, "no publish before Onayla");

  await h.press(`a:${job.id}:1`);
  await h.press(`p:${job.id}:1:both`);
  assert.match(h.calls.sent.at(-1).text, /❌ Facebook: Page token yok/);
  assert.equal(h.job().state, "approved");
  assert.ok(h.lastButtons().includes(`p:${job.id}:1:fb`), "retry offered");
});

// ===== Correction invalidates the previous approval =====

test("Düzelt -> correction text: new revision on the same photo, old draft withdrawn, old buttons dead", async () => {
  const h = harness();
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`d:${job.id}:1`);
  assert.equal(h.job().state, "awaiting_correction");

  assert.equal(await h.send("Daha kısa ve daha sade olsun"), "corrected");
  assert.equal(h.job().revision, 2);
  assert.equal(h.calls.visual[1].reuse, "https://cdn/run1/base.png", "no new image cost for a correction");
  assert.match(h.calls.pkg[1].instruction, /DÜZELTME: Daha kısa ve daha sade olsun/);
  const oldPost = h.db.tables.generated_posts[0];
  assert.equal(review.isRejectedDraft(oldPost.metadata), true);
  assert.equal(h.job().post_id, "post-2");
  assert.deepEqual(h.lastButtons(), [`a:${job.id}:2`, `d:${job.id}:2`, `r:${job.id}:2`]);

  await h.press(`a:${job.id}:1`);
  assert.match(h.calls.answers.at(-1), /artık geçerli değil/);
  assert.equal(h.db.tables.generated_posts[1].status, "draft", "the old button approved nothing");
});

test("a correction after approval withdraws that approval: the old post goes back to draft and its publish buttons die", async () => {
  const h = harness();
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`a:${job.id}:1`);
  assert.equal(h.db.tables.generated_posts[0].status, "approved");
  await h.press(`d:${job.id}:1`);
  await h.send("Başlığı değiştir");
  assert.equal(h.db.tables.generated_posts[0].status, "draft");
  assert.equal(review.isRejectedDraft(h.db.tables.generated_posts[0].metadata), true);
  await h.press(`p:${job.id}:1:both`);
  assert.equal(h.calls.publish.length, 0);
});

test("Reddet rejects the draft; it can no longer be approved or published", async () => {
  const h = harness();
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`r:${job.id}:1`);
  assert.equal(h.job().state, "rejected");
  assert.equal(review.isRejectedDraft(h.db.tables.generated_posts[0].metadata), true);
  await h.press(`a:${job.id}:1`);
  await h.press(`p:${job.id}:1:both`);
  assert.equal(h.db.tables.generated_posts[0].status, "draft");
  assert.equal(h.calls.publish.length, 0);
});

test("/start answers with help and generates nothing", async () => {
  const h = harness();
  assert.equal(await h.send("/start"), "help");
  assert.equal(h.calls.pkg.length, 0);
});

// ===== Webhook route =====

function loadWebhook(env) {
  const scheduled = [];
  const route = loadTypeScriptModule(
    "src/app/api/telegram/webhook/route.ts",
    (specifier) => {
      if (specifier === "node:crypto") return nodeRequire("node:crypto");
      if (specifier === "next/server") return { after: (fn) => scheduled.push(fn) };
      if (specifier === "@/lib/notifications/telegram") return { authorizedChatId: () => env.TELEGRAM_CHAT_ID };
      return {};
    },
    { process: { env }, Response, Request, URL, Buffer, console: { log() {}, error() {} } },
  );
  return { route, scheduled };
}
const WEBHOOK_ENV = { TELEGRAM_WEBHOOK_SECRET: "hook-secret-1", ATLAS_AUTOMATION_USER_ID: "user-1", TELEGRAM_CHAT_ID: CHAT };
const hookRequest = (secret) =>
  new Request("https://atlas.example/api/telegram/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
    body: JSON.stringify({ update_id: 1, message: { text: "x" } }),
  });

test("webhook: missing or wrong secret -> 401 and nothing is scheduled", async () => {
  for (const secret of [undefined, "wrong"]) {
    const { route, scheduled } = loadWebhook(WEBHOOK_ENV);
    assert.equal((await route.POST(hookRequest(secret))).status, 401);
    assert.equal(scheduled.length, 0);
  }
  const { route, scheduled } = loadWebhook({ ...WEBHOOK_ENV, TELEGRAM_WEBHOOK_SECRET: "" });
  assert.equal((await route.POST(hookRequest(""))).status, 401, "no secret configured never authorizes");
  assert.equal(scheduled.length, 0);
});

test("webhook: valid secret -> immediate 200 and the work is scheduled with after()", async () => {
  const { route, scheduled } = loadWebhook(WEBHOOK_ENV);
  const response = await route.POST(hookRequest("hook-secret-1"));
  assert.equal(response.status, 200);
  assert.equal(scheduled.length, 1);
});

// ===== Credentials, database, bundle =====

test("credentials: inside the automation context the service-only RPC with the owner id is used; otherwise the original one", async () => {
  let automationUser;
  const credentials = loadTypeScriptModule(
    "src/lib/publishing/connections/credentials.ts",
    (specifier) => (specifier === "../../supabase/server" ? { currentAutomationUserId: () => automationUser } : {}),
    { console: { error() {} } },
  );
  const rpcCalls = [];
  const client = { rpc: async (name, args) => { rpcCalls.push({ name, args: { ...args } }); return { data: "token", error: null }; } };
  await credentials.getConnectedAccountCredential(client, "acc-1");
  automationUser = "user-1";
  await credentials.getConnectedAccountCredential(client, "acc-1");
  assert.deepEqual(rpcCalls, [
    { name: "get_connected_account_credential", args: { p_connected_account_id: "acc-1" } },
    { name: "get_connected_account_credential_for_user", args: { p_connected_account_id: "acc-1", p_user_id: "user-1" } },
  ]);
});

test("migration 0005: update dedupe key, server-only tables, credential variant executable only by service_role", () => {
  const sql = read("supabase/migrations/0005_telegram_review.sql");
  assert.match(sql, /update_id bigint primary key/);
  assert.match(sql, /revoke all on public\.telegram_jobs from anon, authenticated;/);
  assert.match(sql, /revoke all on public\.telegram_updates from anon, authenticated;/);
  assert.match(sql, /revoke all on function public\.get_connected_account_credential_for_user\(uuid, uuid\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.get_connected_account_credential_for_user\(uuid, uuid\) to service_role;/);
  assert.match(sql, /and user_id = p_user_id;/);
});

test("the webhook bundle gets the carousel render assets; the flow never publishes outside publishToSelectedPlatforms", () => {
  assert.match(read("next.config.ts"), /"\/api\/telegram\/webhook": RENDER_ASSETS,/);
  const source = read("src/lib/automation/telegramReview.ts");
  assert.doesNotMatch(source, /status: "posted"/);
  assert.doesNotMatch(source, /publishGeneratedPost|publishToMeta|from "\.\.\/publishing\/providers/);
});

// ===== Private chat only; stale-job recovery =====

test("a message from the authorized user in a group (or with a mismatched chat) is ignored", async () => {
  const h = harness();
  const groupMessage = { update_id: ++updateSeq, message: { message_id: 3, from: { id: Number(CHAT) }, chat: { id: -100123, type: "supergroup" }, text: INSTRUCTION } };
  assert.equal(await flow.handleTelegramUpdate(groupMessage, h.deps), "ignored-unauthorized");
  const sameIdNotPrivate = { update_id: ++updateSeq, message: { message_id: 4, from: { id: Number(CHAT) }, chat: { id: Number(CHAT), type: "group" }, text: INSTRUCTION } };
  assert.equal(await flow.handleTelegramUpdate(sameIdNotPrivate, h.deps), "ignored-unauthorized");
  assert.equal(h.db.tables.telegram_updates.length, 0);
  assert.equal(h.calls.pkg.length, 0);
});

const OLD = new Date(Date.now() - 20 * 60 * 1000).toISOString();

test("recovery: a generating job cut off by a timeout is marked failed and reported on the next message (no silent stall)", async () => {
  const h = harness();
  h.db.tables.telegram_jobs.push({ id: "stuck-gen", user_id: "user-1", instruction: "x", post_id: null, state: "generating", revision: 1, updated_at: OLD });
  await h.send(INSTRUCTION);
  assert.equal(h.db.tables.telegram_jobs.find((j) => j.id === "stuck-gen").state, "failed");
  assert.ok(h.calls.sent.some((m) => /yarıda kaldı \(zaman aşımı\)/.test(m.text)));
  assert.equal(h.calls.pkg.length, 1, "the new instruction proceeds; the stuck one is not regenerated");
});

test("recovery: a publishing job cut off mid-publish returns to approved with publish buttons; re-choosing never republishes a published platform", async () => {
  const published = new Set(["instagram"]);
  const h = harness({
    publish: async (_postId, platforms) => ({
      error: null,
      results: platforms.map((platform) => (published.has(platform) ? { platform, status: "already-published", message: "zaten" } : (published.add(platform), { platform, status: "published", message: "ok" }))),
    }),
  });
  h.db.tables.generated_posts.push({ id: "post-x", user_id: "user-1", status: "approved", final_image_url: "u", metadata: {} });
  h.db.tables.telegram_jobs.push({ id: "stuck-pub", user_id: "user-1", instruction: "x", post_id: "post-x", state: "publishing", revision: 3, updated_at: OLD });
  await h.send("durum");
  assert.equal(h.db.tables.telegram_jobs.find((j) => j.id === "stuck-pub").state, "approved");
  assert.ok(h.calls.sent.some((m) => /Önceki yayın yarıda kaldı/.test(m.text) && m.buttons));
  await h.press("p:stuck-pub:3:both");
  assert.match(h.calls.sent.at(-1).text, /Instagram: zaten yayında/);
  assert.match(h.calls.sent.at(-1).text, /Facebook: yayınlandı/);
});

test("recovery never touches a job that is still within its time window", async () => {
  const h = harness();
  h.db.tables.telegram_jobs.push({ id: "live-pub", user_id: "user-1", instruction: "x", post_id: "p", state: "publishing", revision: 1, updated_at: new Date().toISOString() });
  await h.send("durum");
  assert.equal(h.db.tables.telegram_jobs.find((j) => j.id === "live-pub").state, "publishing");
});

// ===== Uncertain publish state (sent to Meta, outcome not recorded) =====

function stuckPublishing(h, { postStatus, facebookState, states }) {
  h.db.tables.generated_posts.push({ id: "post-u", user_id: "user-1", status: postStatus, final_image_url: "u", metadata: { publishResults: { facebook: { state: facebookState } } } });
  h.db.tables.telegram_jobs.push({ id: "job-u", user_id: "user-1", instruction: "x", post_id: "post-u", state: "publishing", revision: 2, publish_results: states, updated_at: OLD });
}

test("uncertain: a cut-off publish keeps the confirmed platform and marks the unconfirmed one uncertain; Telegram never republishes it", async () => {
  const h = harness();
  // Instagram was confirmed by Atlas's own record (status "posted"); Facebook was being sent but never recorded.
  stuckPublishing(h, { postStatus: "posted", facebookState: "publishing", states: { instagram: "sending", facebook: "sending" } });
  await h.send("ne oldu?");
  const job = h.db.tables.telegram_jobs.find((j) => j.id === "job-u");
  assert.equal(job.state, "approved");
  assert.deepEqual({ ...job.publish_results }, { instagram: "published", facebook: "uncertain" });
  const notice = h.calls.sent.find((m) => /Önceki yayın yarıda kaldı/.test(m.text));
  assert.match(notice.text, /✅ Instagram: yayında/);
  assert.match(notice.text, /⚠️ Facebook: durumu belirsiz/);
  assert.equal(notice.buttons, undefined, "no publish button for a published or uncertain platform");

  for (const choice of ["fb", "both", "ig"]) await h.press(`p:job-u:2:${choice}`);
  assert.equal(h.calls.publish.length, 0, "an uncertain platform is never republished from Telegram");
  assert.equal(job.state, "approved");
});

test("uncertain: the other direction — Facebook confirmed, Instagram unrecorded — only Instagram becomes uncertain", async () => {
  const h = harness();
  stuckPublishing(h, { postStatus: "approved", facebookState: "published", states: { instagram: "sending", facebook: "sending" } });
  await h.send("ne oldu?");
  const job = h.db.tables.telegram_jobs.find((j) => j.id === "job-u");
  assert.deepEqual({ ...job.publish_results }, { instagram: "uncertain", facebook: "published" });
});

test("uncertain: an exception during publishing marks the chosen platforms uncertain (never assumed unsent); a platform not chosen stays publishable", async () => {
  let seenBeforeCall;
  const h = harness({
    publish: async (_postId, _platforms, db) => {
      seenBeforeCall = { ...db.tables.telegram_jobs.at(-1).publish_results };
      throw new Error("connection reset");
    },
  });
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`a:${job.id}:1`);
  await h.press(`p:${job.id}:1:ig`);
  assert.deepEqual(seenBeforeCall, { instagram: "sending" }, "the attempt is recorded before Meta is called");
  assert.deepEqual({ ...h.job().publish_results }, { instagram: "uncertain" });
  assert.match(h.calls.sent.at(-1).text, /⚠️ Instagram: durumu belirsiz/);
  assert.deepEqual(h.lastButtons(), [`p:${job.id}:1:fb`, `d:${job.id}:1`], "only Facebook is still offered");
  await h.press(`p:${job.id}:1:ig`);
  assert.equal(h.calls.publish.length, 1);
});

test("a publish refused before any Meta call (publisher error) is a plain failure, not uncertain", async () => {
  const h = harness({ publish: async () => ({ error: "Gönderi henüz onaylanmadı.", results: [] }) });
  await h.send(INSTRUCTION);
  const job = h.job();
  await h.press(`a:${job.id}:1`);
  await h.press(`p:${job.id}:1:both`);
  assert.deepEqual({ ...h.job().publish_results }, { instagram: "failed", facebook: "failed" });
  assert.ok(h.lastButtons().includes(`p:${job.id}:1:both`), "a known failure can be retried");
});

// ===== First live check: only /start; old queued messages never start paid work =====

test("actions disabled: /start answers, instructions and buttons do nothing (no job, no generation, no state change)", async () => {
  const h = harness({ actionsEnabled: false });
  assert.equal(await h.send("/start"), "help");
  assert.match(h.calls.sent.at(-1).text, /yalnız bu komut etkin/);
  assert.equal(await h.send(INSTRUCTION), "disabled");
  h.db.tables.telegram_jobs.push({ id: "j-off", user_id: "user-1", instruction: "x", post_id: "p", state: "approved", revision: 1, updated_at: new Date().toISOString() });
  assert.equal(await h.press("p:j-off:1:both"), "disabled");
  assert.equal(h.calls.pkg.length, 0);
  assert.equal(h.calls.publish.length, 0);
  assert.equal(h.db.tables.telegram_jobs.find((j) => j.id === "j-off").state, "approved");
  assert.equal(h.db.tables.telegram_jobs.length, 1);
});

test("a message delivered late (queued before the webhook existed) never starts generation, even when actions are enabled", async () => {
  const h = harness();
  const oldMessage = {
    update_id: ++updateSeq,
    message: { message_id: 9, date: Math.floor((Date.now() - 60 * 60 * 1000) / 1000), from: { id: Number(CHAT) }, chat: { id: Number(CHAT), type: "private" }, text: INSTRUCTION },
  };
  assert.equal(await flow.handleTelegramUpdate(oldMessage, h.deps), "stale-message");
  assert.equal(h.calls.pkg.length, 0);
  assert.equal(h.db.tables.telegram_jobs.length, 0);
});

test("the webhook enables actions only when TELEGRAM_ACTIONS_ENABLED is exactly 'true'", () => {
  assert.match(read("src/app/api/telegram/webhook/route.ts"), /actionsEnabled: process\.env\.TELEGRAM_ACTIONS_ENABLED === "true",/);
});
