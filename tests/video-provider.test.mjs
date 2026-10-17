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

const config = loadTypeScriptModule("src/lib/ai/media/config.ts");

// Video/Reels V1: a mocked fal client — no network, no spend. Records
// every subscribe() call so tests can prove the guard runs first.
function loadVideoStack({ env = {}, falData = { video: { url: "https://fal.example/clip.mp4" } } } = {}) {
  const state = { subscribeCalls: [], configured: [] };
  const falModule = {
    fal: {
      config: (options) => state.configured.push(Boolean(options.credentials)),
      subscribe: async (model, options) => {
        state.subscribeCalls.push({ model, input: options.input });
        return { data: falData };
      },
    },
  };
  const fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "video/mp4" },
    arrayBuffer: async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]).buffer,
  });
  const processStub = { env: { FAL_KEY: "test-key", ...env } };
  const fal = loadTypeScriptModule(
    "src/lib/ai/media/providers/fal.ts",
    (specifier) => (specifier === "@fal-ai/client" ? falModule : specifier === "../config" ? config : {}),
    { process: processStub, fetch, Buffer },
  );
  const router = loadTypeScriptModule(
    "src/lib/ai/media/router.ts",
    (specifier) => {
      if (specifier === "./providers/fal") return fal;
      if (specifier === "./config") return config;
      return {};
    },
    { process: processStub },
  );
  return { router, fal, state };
}

const request = (overrides = {}) => ({
  provider: "fal",
  model: config.DEFAULT_VIDEO_MODEL,
  prompt: "Slow cinematic push-in on a Zekeriyaköy garden villa at golden hour",
  imageUrl: "https://storage.example/base.png",
  aspectRatio: "9:16",
  tier: "test",
  ...overrides,
});

test("video generation is OFF by default — no provider call ever happens without VIDEO_GENERATION_ENABLED=true", async () => {
  const { router, state } = loadVideoStack();
  await assert.rejects(router.generateVideo(request()), /disabled/);
  assert.equal(state.subscribeCalls.length, 0);
});

test("anything other than exactly 'true' keeps video generation disabled", async () => {
  for (const value of ["1", "TRUE", "yes", " true"]) {
    const { router, state } = loadVideoStack({ env: { VIDEO_GENERATION_ENABLED: value } });
    await assert.rejects(router.generateVideo(request()), /disabled/);
    assert.equal(state.subscribeCalls.length, 0);
  }
});

test("both tiers are priced under the hard per-request cap, and 'final' costs more than 'test'", () => {
  const testCost = config.estimateVideoCostUsd("test");
  const finalCost = config.estimateVideoCostUsd("final");
  assert.ok(testCost > 0 && testCost <= config.MAX_VIDEO_COST_PER_REQUEST_USD);
  assert.ok(finalCost > testCost && finalCost <= config.MAX_VIDEO_COST_PER_REQUEST_USD);
});

test("enabled: the fal request is vertical 9:16, tier-fixed duration/resolution, audio off, on the verified Seedance endpoint", async () => {
  const { router, state } = loadVideoStack({ env: { VIDEO_GENERATION_ENABLED: "true" } });
  const video = await router.generateVideo(request({ tier: "test" }));

  assert.equal(state.subscribeCalls.length, 1);
  const [{ model, input }] = state.subscribeCalls;
  assert.equal(model, "fal-ai/bytedance/seedance/v1.5/pro/image-to-video");
  assert.equal(input.aspect_ratio, "9:16");
  assert.equal(input.duration, "5");
  assert.equal(input.resolution, "480p");
  assert.equal(input.generate_audio, false);
  assert.equal(input.image_url, "https://storage.example/base.png");

  assert.equal(video.contentType, "video/mp4");
  assert.ok(video.bytes.length > 0);
  assert.equal(video.durationSeconds, 5);
  assert.equal(video.estimatedCostUsd, config.estimateVideoCostUsd("test"));
});

test("the final tier maps to the Reel-quality shape", () => {
  const { fal } = loadVideoStack();
  const input = fal.buildFalVideoInput(request({ tier: "final" }));
  assert.equal(input.duration, String(config.VIDEO_TIERS.final.durationSeconds));
  assert.equal(input.resolution, "1080p");
});

test("a fal response without a video URL fails loudly, never a silent empty clip", async () => {
  const { router } = loadVideoStack({ env: { VIDEO_GENERATION_ENABLED: "true" }, falData: {} });
  await assert.rejects(router.generateVideo(request()), /no video data/);
});

test("video code never touches approval/publishing", () => {
  for (const file of ["src/lib/ai/media/router.ts", "src/lib/ai/media/providers/fal.ts", "src/lib/ai/media/config.ts"]) {
    const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
    assert.doesNotMatch(source, /publishGeneratedPost|publishing\/|status:\s*"(approved|posted)"/);
  }
});
