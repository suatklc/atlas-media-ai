import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same loader convention used throughout tests/*.test.mjs (output-mode.test
// .mjs's own route-level tests in particular — a real route.POST() call
// against a fully mocked dependency graph, never a live network call).
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

// Minimal, cooperative stand-ins for every prompt/directive builder
// assistant/route.ts imports — none of these are under test here (they're
// pure string builders, unchanged by the Anthropic->OpenAI swap, and
// already covered by their own existing tests elsewhere); only the actual
// model-provider call mechanics are what this file verifies.
function baseDependencyMap(openaiClientModule) {
  return {
    "@/lib/supabase/server": {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      }),
    },
    "@/lib/ai/client": openaiClientModule,
    "@/lib/ai/system-prompt": { SYSTEM_PROMPT: "SYSTEM" },
    "@/lib/ai/knowledge": { knowledgeEntries: [] },
    "@/lib/ai/knowledge/router": { matchTopics: () => [] },
    "@/lib/ai/knowledge/context": { buildSystemContext: (sysPrompt) => sysPrompt },
    "@/lib/ai/reasoning/assess": { assessRequest: () => ({}) },
    "@/lib/ai/reasoning/directive": { buildReasoningDirective: () => "" },
    "@/lib/ai/content/plan": {
      buildContentPlan: () => ({ intent: "educational", outputMode: "single" }),
    },
    "@/lib/ai/content/directive": { buildContentDirective: () => "" },
    "@/lib/ai/creative/brief": { buildCreativeBrief: () => ({}) },
    "@/lib/ai/creative/directive": { buildCreativeDirective: () => "" },
    "@/lib/ai/platform/config": {
      DEFAULT_PLATFORM: "instagram",
      isPlatformId: (value) => value === "instagram",
    },
    "@/lib/ai/platform/copy": { buildPlatformDirective: () => "" },
    "@/lib/ai/research/opportunity": {
      buildSeedMessage: () => "",
      buildResearchDirective: () => "",
      isContentOpportunity: () => false,
    },
    "@/lib/ai/research/formatRecommendation": {
      isVisualFormat: () => false,
      buildFormatSuffix: () => "",
    },
  };
}

// Mirrors the real OpenAI SDK's streaming shape closely enough for this
// route's own consumption (`chunk.choices[0]?.delta?.content`) — a plain
// async-iterable of ChatCompletionChunk-like objects, exactly what
// `openai.chat.completions.create({ stream: true })` resolves to.
function makeMockOpenAIClient(chunks, { captureArgs, failBeforeStream, failDuringStream } = {}) {
  return {
    chat: {
      completions: {
        create: async (args) => {
          if (captureArgs) captureArgs.push(args);
          if (failBeforeStream) {
            throw new Error("simulated OpenAI API failure (e.g. insufficient credit)");
          }
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const text of chunks) {
                if (failDuringStream && text === failDuringStream.at) {
                  throw new Error("simulated mid-stream failure");
                }
                yield { choices: [{ delta: { content: text } }] };
              }
            },
          };
        },
      },
    },
  };
}

async function drainResponseText(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    fullText += decoder.decode(value, { stream: true });
  }
  return fullText;
}

function loadRoute(dependencyLoader) {
  return loadTypeScriptModule(
    "src/app/api/assistant/route.ts",
    (specifier) => (dependencyLoader[specifier] ? dependencyLoader[specifier] : {}),
    { Response, ReadableStream, TextEncoder, TextDecoder, console: { error: () => {}, log: () => {}, warn: () => {} } },
  );
}

function makeRequest(body) {
  return { json: async () => body };
}

// ============================================================
// 1. /api/assistant no longer calls Anthropic for production generation.
// ============================================================

test("assistant/route.ts source no longer imports or calls the Anthropic client — it imports the OpenAI text client instead", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /getAnthropicClient/);
  assert.doesNotMatch(routeSource, /anthropic\.messages/);
  assert.match(routeSource, /getOpenAITextClient/);
  assert.match(routeSource, /AI_TEXT_MODEL/);
  assert.match(routeSource, /openai\.chat\.completions\.create/);
});

test("client.ts still exports getAnthropicClient (kept available, not deleted) alongside the new getOpenAITextClient/AI_TEXT_MODEL", () => {
  const clientSource = fs.readFileSync(path.join(projectRoot, "src/lib/ai/client.ts"), "utf8");
  assert.match(clientSource, /export function getAnthropicClient/);
  assert.match(clientSource, /export function getOpenAITextClient/);
  assert.match(clientSource, /export const AI_TEXT_MODEL = "gpt-4\.1-mini"/);
});

// ============================================================
// 2 & 3. OpenAI streaming output returned as the same plain-text stream
// contract; system + conversation messages passed correctly.
// ============================================================

test("a normal chat message streams back as plain UTF-8 text, and the model/system/conversation are passed to OpenAI correctly", async () => {
  const captured = [];
  const mockClient = makeMockOpenAIClient(["Merhaba", ", ", "nasıl", " yardımcı", " olabilirim?"], {
    captureArgs: captured,
  });
  const route = loadRoute(
    baseDependencyMap({ getOpenAITextClient: () => mockClient, AI_TEXT_MODEL: "gpt-4.1-mini" }),
  );

  const response = await route.POST(
    makeRequest({ message: "Merhaba", history: [{ role: "user", content: "Önceki mesaj" }] }),
  );

  assert.equal(response.headers.get("Content-Type"), "text/plain; charset=utf-8");
  const text = await drainResponseText(response);
  assert.equal(text, "Merhaba, nasıl yardımcı olabilirim?");

  assert.equal(captured.length, 1);
  const requestArgs = captured[0];
  assert.equal(requestArgs.model, "gpt-4.1-mini");
  assert.equal(requestArgs.stream, true);
  assert.equal(requestArgs.messages[0].role, "system");
  assert.equal(typeof requestArgs.messages[0].content, "string");
  assert.ok(requestArgs.messages.some((m) => m.role === "user" && m.content === "Merhaba"));
  assert.ok(requestArgs.messages.some((m) => m.role === "user" && m.content === "Önceki mesaj"));
});

// ============================================================
// 4. Existing marker-formatted content remains intact in the streamed
// output — the route must not alter, strip, or reformat marker syntax; it
// only re-encodes whatever text the model produces.
// ============================================================

test("marker-formatted content ([[VISUAL_HEADLINE: ...]], [[CAROUSEL_STRUCTURE: ...]]) survives the OpenAI stream byte-for-byte", async () => {
  const markerText =
    "Bir başlık burada.\n\n[[VISUAL_HEADLINE: Faiz Kararı Açıklandı]]\n[[CAROUSEL_STRUCTURE: ne oldu|neden önemli|harekete geç]]";
  // Split across multiple chunks (as a real stream would) to prove
  // chunk-boundary splitting never corrupts the marker syntax.
  const chunks = [
    markerText.slice(0, 10),
    markerText.slice(10, 40),
    markerText.slice(40),
  ];
  const mockClient = makeMockOpenAIClient(chunks);
  const route = loadRoute(
    baseDependencyMap({ getOpenAITextClient: () => mockClient, AI_TEXT_MODEL: "gpt-4.1-mini" }),
  );

  const response = await route.POST(makeRequest({ message: "içerik üret" }));
  const text = await drainResponseText(response);
  assert.equal(text, markerText);
  assert.match(text, /\[\[VISUAL_HEADLINE: Faiz Kararı Açıklandı\]\]/);
  assert.match(text, /\[\[CAROUSEL_STRUCTURE: ne oldu\|neden önemli\|harekete geç\]\]/);
});

// ============================================================
// 5. Stream/API failure still results in controlled route failure
// behavior — the same try/catch/controller.error() path as before,
// just triggered by OpenAI instead of Anthropic.
// ============================================================

test("an OpenAI API failure before streaming starts (e.g. insufficient credit) results in a controlled stream error, never an unhandled crash", async () => {
  const mockClient = makeMockOpenAIClient([], { failBeforeStream: true });
  const route = loadRoute(
    baseDependencyMap({ getOpenAITextClient: () => mockClient, AI_TEXT_MODEL: "gpt-4.1-mini" }),
  );

  const response = await route.POST(makeRequest({ message: "içerik üret" }));
  await assert.rejects(() => drainResponseText(response), /Bir hata oluştu/);
});

test("a failure mid-stream is also caught as a controlled stream error, not an unhandled crash", async () => {
  const mockClient = makeMockOpenAIClient(["Merhaba", " dünya"], { failDuringStream: { at: " dünya" } });
  const route = loadRoute(
    baseDependencyMap({ getOpenAITextClient: () => mockClient, AI_TEXT_MODEL: "gpt-4.1-mini" }),
  );

  const response = await route.POST(makeRequest({ message: "içerik üret" }));
  await assert.rejects(() => drainResponseText(response), /Bir hata oluştu/);
});

test("getOpenAITextClient throwing (e.g. missing OPENAI_API_KEY) returns a clean 500, never a stream at all", async () => {
  const route = loadRoute(
    baseDependencyMap({
      getOpenAITextClient: () => {
        throw new Error("OPENAI_API_KEY is not configured.");
      },
      AI_TEXT_MODEL: "gpt-4.1-mini",
    }),
  );

  const response = await route.POST(makeRequest({ message: "içerik üret" }));
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.match(body.error, /kullanılamıyor/);
});

// ============================================================
// 6. No downstream schema/UI changes are required — the route never
// touches generated_posts/connected_accounts, and never references
// publishing (unchanged from before this task, re-confirmed here).
// ============================================================

test("assistant route still never references generated_posts, connected_accounts, or any publishing action", () => {
  const routeSource = fs.readFileSync(path.join(projectRoot, "src/app/api/assistant/route.ts"), "utf8");
  assert.doesNotMatch(routeSource, /generated_posts|connected_accounts/);
  assert.doesNotMatch(routeSource, /publishGeneratedPost|publishPost|publishToMeta/i);
});

test("AIAssistantPanel.tsx (the frontend consumer) is untouched by this task — no file changes here needed for the provider swap", () => {
  const panelSource = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/AIAssistantPanel.tsx"), "utf8");
  // Same generic Fetch API stream consumption as always — no Anthropic or
  // OpenAI SDK reference of any kind belongs in frontend code.
  assert.doesNotMatch(panelSource, /anthropic|openai/i);
  assert.match(panelSource, /response\.body\.getReader\(\)/);
  assert.match(panelSource, /new TextDecoder\(\)/);
});
