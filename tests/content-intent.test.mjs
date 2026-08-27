import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same loader convention as tests/output-mode.test.mjs and
// tests/educational-metadata.test.mjs.
function loadTypeScriptModule(relativePath, dependencyLoader = () => ({})) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const intent = loadTypeScriptModule("src/lib/ai/content/intent.ts");

// --- TRUE POSITIVES: legitimate wording must still classify correctly ---

test("listing: genuine 'ev' usage (whole word and common inflected forms) still detects listing", () => {
  assert.equal(intent.detectContentIntent("ev satışı için ilan hazırla"), "listing");
  assert.equal(intent.detectContentIntent("ev ilanı hazırla"), "listing");
  assert.equal(intent.detectContentIntent("evimi satmak istiyorum, ilan hazırla"), "listing");
});

test("listing: other existing listing keywords remain intact", () => {
  assert.equal(intent.detectContentIntent("satılık villa için Instagram gönderisi hazırla"), "listing");
  assert.equal(
    intent.detectContentIntent("konut projesi hakkında bilgilendirici bir içerik hazırla"),
    "listing",
  );
});

test("educational: legitimate wording remains intact, including the öğret+ici derived form", () => {
  assert.equal(
    intent.detectContentIntent("gayrimenkul yatırımı hakkında eğitici bir içerik hazırla"),
    "educational",
  );
  assert.equal(intent.detectContentIntent("öğretici bir Instagram gönderisi hazırla"), "educational");
});

test("comparison, market-stats, announcement: existing behavior remains intact", () => {
  assert.equal(
    intent.detectContentIntent("iki yatırım stratejisi arasındaki farkı karşılaştıran bir içerik hazırla"),
    "comparison",
  );
  assert.equal(
    intent.detectContentIntent("piyasa istatistiklerini ve trend verilerini içeren bir rapor hazırla"),
    "market-stats",
  );
  assert.equal(intent.detectContentIntent("yeni ofis açılışı için duyuru hazırla"), "announcement");
});

test("transform-meta exclusions still veto content planning", () => {
  assert.equal(
    intent.detectContentIntent(
      "Bir önceki yanıtını, kullanıma hazır ve dikkat çekici bir Instagram paylaşımına dönüştür.",
    ),
    "none",
  );
});

test("no creation signal still resolves to none", () => {
  assert.equal(intent.detectContentIntent("merhaba nasılsın"), "none");
});

// --- FALSE POSITIVES: substring collisions must not fire ---

test("'e-Devlet' does not trigger the 'ev' listing keyword (the documented root-cause case)", () => {
  const result = intent.detectContentIntent(
    "e-Devlet üzerinden yapılan tapu işlemleri hakkında bilgilendirici içerik hazırla",
  );
  assert.notEqual(result, "listing");
  assert.equal(result, "educational");
});

test("a longer unrelated Turkish word merely containing a shorter keyword does not trigger that intent", () => {
  // "evrensel" (universal) shares its first two letters with "ev" but is an
  // entirely different, unrelated word — must not resolve to listing.
  const result = intent.detectContentIntent("evrensel bir konu hakkında içerik hazırla");
  assert.notEqual(result, "listing");
  assert.equal(result, "educational");
});

test("punctuation and Turkish characters do not break legitimate word-boundary matching: apostrophe-suffixed proper nouns still match their bare trigger", () => {
  const result = intent.detectContentIntent("Zekeriyaköy'de satılık bir villa için içerik hazırla");
  assert.equal(result, "listing");
});

test("a keyword embedded mid-word (preceded by a word character) is rejected generically, not only for 'e-Devlet'", () => {
  // "yaz" (write) is a CREATION_SIGNALS trigger; "beyaz" (white) contains it
  // mid-word and must not itself count as a creation signal. The message
  // has no other creation signal, so overall intent must be "none".
  assert.equal(intent.detectContentIntent("beyaz bir villa fotoğrafı"), "none");
});

test("a genuinely suffixed creation-signal verb still counts as a creation signal", () => {
  // "hazırlamak" (hazırla + mak, infinitive) must still count as "hazırla".
  const result = intent.detectContentIntent("villa için bir gönderi hazırlamak istiyorum");
  assert.equal(result, "listing");
});
