import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(projectRoot, "src/lib/ai/image/templates/educational.ts"),
  "utf8",
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

let renderedSvg = "";

function sharpMock() {
  return {
    resize() {
      return this;
    },
    composite(entries) {
      renderedSvg = entries[0].input.toString("utf8");
      return this;
    },
    png() {
      return this;
    },
    async toBuffer() {
      return Buffer.from("image");
    },
  };
}
sharpMock.strategy = { attention: "attention" };

const dependencies = {
  sharp: sharpMock,
  "./shared": {
    FONT_STACK: "sans-serif",
    escapeXml: (value) => value,
    layoutAtSize: (value) => ({ lines: [value], truncated: false }),
    buildBrandBadgeMarkup: () => "",
  },
};
const loadedModule = { exports: {} };
const context = {
  Buffer,
  dependencies,
  exports: loadedModule.exports,
};
vm.runInNewContext(
  `(function (exports, dependencies) { const require = (name) => dependencies[name]; ${output}\n})(exports, dependencies);`,
  context,
);
const educational = loadedModule.exports;

test("replaces the live Detay count with the displayed count", () => {
  assert.equal(
    educational.normalizeHeadlineForDisplayedPointCount(
      "Yatırım Öncesi Gözden Kaçırılmaması Gereken 5 Detay",
      3,
    ),
    "Yatırım Öncesi Gözden Kaçırılmaması Gereken 3 Detay",
  );
});

test("supports one fixed qualifier before Nokta and Kontrol", () => {
  assert.equal(
    educational.normalizeHeadlineForDisplayedPointCount("Gayrimenkul Yatırımında 5 Kritik Nokta", 3),
    "Gayrimenkul Yatırımında 3 Kritik Nokta",
  );
  assert.equal(
    educational.normalizeHeadlineForDisplayedPointCount("Yatırımda 5 Temel Kontrol", 4),
    "Yatırımda 4 Temel Kontrol",
  );
});

test("replaces count while preserving the supported noun surface", () => {
  assert.equal(educational.normalizeHeadlineForDisplayedPointCount("5 Başlık", 3), "3 Başlık");
  assert.equal(educational.normalizeHeadlineForDisplayedPointCount("5 İpucu", 3), "3 İpucu");
});

test("leaves unrelated numbers unchanged", () => {
  for (const headline of [
    "5 Yıllık Yatırım Planı",
    "2026 Gayrimenkul Beklentileri",
    "3+1 Ev Alırken Dikkat Edilecekler",
    "5 Milyon TL Bütçeyle Ne Alınır?",
    "3 Aylık Yatırım Planı",
  ]) {
    assert.equal(educational.normalizeHeadlineForDisplayedPointCount(headline, 3), headline);
  }
});

test("leaves matching and lower headline counts unchanged", () => {
  assert.equal(educational.normalizeHeadlineForDisplayedPointCount("3 Detay", 3), "3 Detay");
  assert.equal(educational.normalizeHeadlineForDisplayedPointCount("2 Detay", 3), "2 Detay");
});

test("square renderer normalizes against the clamped three displayed points", async () => {
  renderedSvg = "";
  await educational.renderEducational({
    baseImage: Buffer.from("base"),
    contentTemplateId: "EDUCATIONAL_CAROUSEL_01",
    visualTemplateId: "educational",
    aspectRatio: "1:1",
    dimensionsPx: "1080x1080",
    typographyHierarchy: "",
    textPlacement: "",
    logoPlacement: "",
    ctaVisualTreatment: "",
    headline: "5 Detay",
    educationalPoints: ["Bir", "İki", "Üç", "Dört", "Beş"],
  });
  assert.match(renderedSvg, />3 Detay</);
  assert.doesNotMatch(renderedSvg, />04</);
});

test("portrait renderer normalizes against the clamped four displayed points", async () => {
  renderedSvg = "";
  await educational.renderEducational({
    baseImage: Buffer.from("base"),
    contentTemplateId: "EDUCATIONAL_CAROUSEL_01",
    visualTemplateId: "educational",
    aspectRatio: "4:5",
    dimensionsPx: "1080x1350",
    typographyHierarchy: "",
    textPlacement: "",
    logoPlacement: "",
    ctaVisualTreatment: "",
    headline: "5 Nokta",
    educationalPoints: ["Bir", "İki", "Üç", "Dört", "Beş"],
  });
  assert.match(renderedSvg, />4 Nokta</);
  assert.match(renderedSvg, />04</);
  assert.doesNotMatch(renderedSvg, />05</);
});
