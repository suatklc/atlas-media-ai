import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({})) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const caption = loadTypeScriptModule("src/lib/ai/creative/caption.ts");
const directive = loadTypeScriptModule("src/lib/ai/creative/directive.ts");
const educationalPoints = loadTypeScriptModule("src/lib/ai/content/educational-points.ts", (specifier) => {
  if (specifier === "../creative/caption") return caption;
  return {};
});

function plain(value) {
  return value === undefined ? undefined : Array.from(value);
}

test("valid marker wins over fallback and is capped at five", () => {
  const result = caption.extractEducationalPoints(
    "1. Fallback\n[[EDUCATIONAL_POINTS: Bir | İki | Üç | Dört | Beş | Altı]]",
  );
  assert.deepEqual(plain(result), ["Bir", "İki", "Üç", "Dört", "Beş"]);
});

test("metadata marker ordering does not matter", () => {
  for (const response of [
    "Metin\n[[VISUAL_HEADLINE: Güvenli Yatırım]]\n[[EDUCATIONAL_POINTS: Tapu | Bütçe]]",
    "Metin\n[[EDUCATIONAL_POINTS: Tapu | Bütçe]]\n[[VISUAL_HEADLINE: Güvenli Yatırım]]",
  ]) {
    const result = caption.extractVisualHeadlineMarker(response);
    assert.equal(result.visualHeadline, "Güvenli Yatırım");
    assert.deepEqual(plain(result.educationalPoints), ["Tapu", "Bütçe"]);
    assert.equal(result.displayText, "Metin");
  }
});

test("explicit educational sections support all narrow labels", () => {
  const response = [
    "Nokta 1: Tapu kaydını inceleyin",
    "Madde 2: Bütçeyi netleştirin",
    "Adım 3: Bölgeyi araştırın",
    "İpucu 4: Kira potansiyelini ölçün",
    "Kontrol 5: Masrafları hesaplayın",
  ].join("\n");
  assert.deepEqual(plain(caption.extractEducationalPoints(response)), [
    "Tapu kaydını inceleyin",
    "Bütçeyi netleştirin",
    "Bölgeyi araştırın",
    "Kira potansiyelini ölçün",
    "Masrafları hesaplayın",
  ]);
});

test("standalone educational heading uses first eligible following line", () => {
  const response = "### **Nokta 1:**\nTapu ve imar durumunu doğrulayın\nNokta 2\nToplam maliyeti hesaplayın";
  assert.deepEqual(plain(caption.extractEducationalPoints(response)), [
    "Tapu ve imar durumunu doğrulayın",
    "Toplam maliyeti hesaplayın",
  ]);
});

test("numbered list forms are extracted in source order", () => {
  const response = "1. Tapu kontrolü\n2) Finansman planı\n3 - Bölge analizi";
  assert.deepEqual(plain(caption.extractEducationalPoints(response)), [
    "Tapu kontrolü",
    "Finansman planı",
    "Bölge analizi",
  ]);
});

test("malformed marker is ignored and a coherent bullet block is recovered", () => {
  const response = "[[EDUCATIONAL_POINTS: bozuk\n- Tapu durumunu doğrulayın\n- Aidat ve vergileri hesaplayın";
  assert.deepEqual(plain(caption.extractEducationalPoints(response)), [
    "Tapu durumunu doğrulayın",
    "Aidat ve vergileri hesaplayın",
  ]);
});

test("ordinary prose and one isolated bullet do not fabricate points", () => {
  assert.equal(caption.extractEducationalPoints("Gayrimenkul yatırımında araştırma önemlidir."), undefined);
  assert.equal(caption.extractEducationalPoints("Giriş\n- Tek başına bir not\nDevam eden normal metin."), undefined);
});

test("hashtags, CTA, internal visual sections, and visual headline are excluded", () => {
  const response = [
    "Görsel Spesifikasyonu:",
    "- Logo sağ altta",
    "- Tipografi yüksek kontrastlı",
    "Kapanış/CTA:",
    "- Detaylar için mesaj gönderin",
    "- Gönderiyi paylaşın",
    "Etiketler:",
    "#gayrimenkul #yatırım",
    "[[VISUAL_HEADLINE: Yatırım Kontrolü]]",
  ].join("\n");
  assert.equal(caption.extractEducationalPoints(response), undefined);
});

test("Turkish characters are preserved", () => {
  const result = caption.extractEducationalPoints("1. İmar ölçüsünü öğrenin\n2. Güçlü kira dönüşünü değerlendirin");
  assert.deepEqual(plain(result), ["İmar ölçüsünü öğrenin", "Güçlü kira dönüşünü değerlendirin"]);
});

test("educational directive always contains the required marker pair", () => {
  const brief = {
    direction: {
      attentionFocus: "A".repeat(800),
      primaryMessage: "temel kavram",
      secondaryMessage: "uygulama",
      narrativeAngle: "rehberlik",
      emotionalTone: "profesyonel",
      visualPriority: "bilgi",
      eyeFlow: "yukarıdan aşağıya",
    },
    execution: {
      aspectRatio: "1:1",
      dimensionsPx: "1080x1080",
      composition: "sade",
      imagerySubject: "ikon",
      imageryTreatment: "temiz",
      cameraDirection: "uygulanamaz",
      lightingDirection: "uygulanamaz",
      colorDirection: "marka",
      typographyHierarchy: "net",
      textPlacement: "orta",
      logoPlacement: "sağ alt",
      ctaVisualTreatment: "yok",
      structureConstraint: "tek yapı",
      headlineHookNote: "opsiyonel başlık notu",
      consistencyNote: "opsiyonel tutarlılık notu",
    },
  };

  const result = directive.buildCreativeDirective(brief, "educational");
  assert.match(result, /\[\[VISUAL_HEADLINE:/);
  assert.match(result, /\[\[EDUCATIONAL_POINTS:/);
  assert.ok(result.indexOf("[[VISUAL_HEADLINE:") < result.indexOf("[[EDUCATIONAL_POINTS:"));
  assert.doesNotMatch(result, /opsiyonel başlık notu|opsiyonel tutarlılık notu/);
  assert.ok(result.length <= 1250);
});

test("client and server source retain the recovery contract without changing protected renderers", () => {
  const client = fs.readFileSync(
    path.join(projectRoot, "src/components/dashboard/AIAssistantPanel.tsx"),
    "utf8",
  );
  const server = fs.readFileSync(path.join(projectRoot, "src/app/api/generate-visual/route.ts"), "utf8");

  assert.match(client, /assistantResponseText:\s*fullText/);
  assert.match(client, /educationalPoints,\s*assistantResponseText/);
  assert.match(server, /resolveEducationalPoints\(/);
});

test("server recovers only missing educational points and preserves valid client points", () => {
  assert.deepEqual(
    plain(educationalPoints.resolveEducationalPoints("educational", undefined, "1. Tapu\n2. Bütçe")),
    ["Tapu", "Bütçe"],
  );
  assert.deepEqual(
    plain(educationalPoints.resolveEducationalPoints("educational", [null, ""], "- Tapu\n- Bütçe")),
    ["Tapu", "Bütçe"],
  );
  assert.deepEqual(
    plain(educationalPoints.resolveEducationalPoints("educational", ["İstemci noktası"], "1. Fallback")),
    ["İstemci noktası"],
  );
  assert.deepEqual(plain(educationalPoints.resolveEducationalPoints("educational", undefined, "Normal prose")), []);
});

test("server does not run educational fallback for Hero or Comparison intents", () => {
  assert.deepEqual(plain(educationalPoints.resolveEducationalPoints("listing", undefined, "1. Yanlış nokta")), []);
  assert.deepEqual(plain(educationalPoints.resolveEducationalPoints("comparison", undefined, "1. Yanlış nokta")), []);
});
