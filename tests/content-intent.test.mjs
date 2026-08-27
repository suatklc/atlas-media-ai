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

// ============================================================
// Boundary-matching regressions (from the prior substring-collision fix)
// ============================================================

test("'e-Devlet' does not trigger the 'ev' listing keyword (the documented root-cause case)", () => {
  const result = intent.detectContentIntent(
    "e-Devlet üzerinden yapılan tapu işlemleri hakkında bilgilendirici içerik hazırla",
  );
  assert.notEqual(result, "listing");
  assert.equal(result, "educational");
});

test("a longer unrelated Turkish word merely containing a shorter keyword does not trigger that intent", () => {
  // "evrensel" (universal) shares its first two letters with "ev" but is an
  // entirely different, unrelated word — must not resolve to listing. (Now
  // doubly true: "ev" is no longer even a listing trigger — see the
  // priority-fix section below — but the underlying boundary mechanism
  // this exercises remains load-bearing for every other trigger phrase.)
  const result = intent.detectContentIntent("evrensel bir konu hakkında içerik hazırla");
  assert.notEqual(result, "listing");
  assert.equal(result, "educational");
});

test("apostrophe-suffixed proper nouns still match their bare trigger", () => {
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
  const result = intent.detectContentIntent("ilan için bir gönderi hazırlamak istiyorum");
  assert.equal(result, "listing");
});

// ============================================================
// Priority fix (Handoff — content-intent priority false-positive):
// a property SUBJECT noun (villa, konut, daire, ev, arsa, ...) must never
// by itself resolve "listing" — only a genuine listing PURPOSE/action
// signal (ilan, satılık, kiralık, satışa çıkar/sun, kiraya ver, portföy,
// tanıtım) may. A stronger, more specific purpose signal (market-stats,
// educational, comparison, announcement vocabulary) must be able to win
// even when a property noun is also present.
// ============================================================

test("property subject nouns alone (no purpose signal) no longer resolve to listing", () => {
  // Demonstrates the exact bug this fix addresses: "konut projesi" was
  // previously a listing SUBJECT trigger; it no longer is. "hakkında" +
  // "bilgilendirici" are genuine educational purpose signals, which now
  // correctly win.
  assert.equal(
    intent.detectContentIntent("konut projesi hakkında bilgilendirici bir içerik hazırla"),
    "educational",
  );
});

test("property subject nouns alone, with no other purpose or category signal at all, resolve to none", () => {
  assert.equal(intent.detectContentIntent("villa için görsel hazırla"), "none");
});

// --- The 10 required regression cases from the task, in the task's own
// numbering. Cases 4-10 are bare topic/question fragments in the task's
// own wording, with no CREATION_SIGNALS trigger word at all (a separate,
// pre-existing, untouched gate — detectContentIntent correctly returns
// "none" for these exact literal strings, asserted first below). Each is
// also tested with a natural creation-imperative appended — exactly how a
// real Atlas chat message would read — to validate the actual
// subject/purpose classification this task changed, without altering any
// of the original trigger words themselves.

test("case 1 (listing): Zekeriyaköy'de satılık villa için ilan hazırla", () => {
  assert.equal(intent.detectContentIntent("Zekeriyaköy'de satılık villa için ilan hazırla"), "listing");
});

test("case 2 (listing): Bu arsayı satışa çıkarmak için tanıtım metni oluştur", () => {
  assert.equal(intent.detectContentIntent("Bu arsayı satışa çıkarmak için tanıtım metni oluştur"), "listing");
});

test("case 3 (listing): Kiralık dairem için sosyal medya içeriği hazırla", () => {
  assert.equal(intent.detectContentIntent("Kiralık dairem için sosyal medya içeriği hazırla"), "listing");
});

test("case 4 (educational): Villa alırken dikkat edilmesi gereken 5 konu", () => {
  const literal = "Villa alırken dikkat edilmesi gereken 5 konu";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  assert.equal(
    intent.detectContentIntent(`${literal} hakkında içerik hazırla`),
    "educational",
  );
});

test("case 5 (educational): Tapu türleri arasındaki farkları anlat", () => {
  const literal = "Tapu türleri arasındaki farkları anlat";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  // Educational's "anlat" must win over comparison's "fark" here — this is
  // the existing, unchanged declaration-order tie-break (educational is
  // still checked directly before comparison), not something this fix
  // altered.
  assert.equal(intent.detectContentIntent(`${literal}. İçerik hazırla.`), "educational");
});

test("case 6 (educational): Arsa yatırımında nelere dikkat edilmeli?", () => {
  const literal = "Arsa yatırımında nelere dikkat edilmeli?";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  assert.equal(intent.detectContentIntent(`${literal} İçerik hazırla.`), "educational");
});

test("case 7 (market-stats): Türkiye'de konut fiyatlarındaki değişimi anlat", () => {
  const literal = "Türkiye'de konut fiyatlarındaki değişimi anlat";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  // market-stats vocabulary ("değişim") must win over educational's
  // generic "anlat" here — the priority reordering this fix introduced.
  assert.equal(intent.detectContentIntent(`${literal}. İçerik hazırla.`), "market-stats");
});

test("case 8 (market-stats): Konut kredisi faizlerindeki son gelişmeleri değerlendir", () => {
  const literal = "Konut kredisi faizlerindeki son gelişmeleri değerlendir";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  assert.equal(intent.detectContentIntent(`${literal}. İçerik hazırla.`), "market-stats");
});

test("case 9 (market-stats): Zekeriyaköy villa piyasasındaki fiyat değişimini analiz et", () => {
  const literal = "Zekeriyaköy villa piyasasındaki fiyat değişimini analiz et";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  // "villa" is present but irrelevant to classification (no listing
  // purpose signal); "fiyat"/"değişim" correctly resolve market-stats.
  assert.equal(intent.detectContentIntent(`${literal}. İçerik hazırla.`), "market-stats");
});

test("case 10 (comparison): Villa mı arsa mı yatırım açısından karşılaştır", () => {
  const literal = "Villa mı arsa mı yatırım açısından karşılaştır";
  assert.equal(intent.detectContentIntent(literal), "none", "bare fragment has no creation signal");
  assert.equal(intent.detectContentIntent(`${literal}. İçerik hazırla.`), "comparison");
});

// ============================================================
// Existing behavior — general, non-priority-specific regressions
// ============================================================

test("other existing listing purpose keywords remain intact", () => {
  assert.equal(intent.detectContentIntent("satılık villa için Instagram gönderisi hazırla"), "listing");
});

test("educational: legitimate wording remains intact, including the öğret+ici derived form", () => {
  assert.equal(
    intent.detectContentIntent("gayrimenkul yatırımı hakkında eğitici bir içerik hazırla"),
    "educational",
  );
  assert.equal(intent.detectContentIntent("öğretici bir Instagram gönderisi hazırla"), "educational");
});

test("announcement: existing behavior remains intact", () => {
  assert.equal(intent.detectContentIntent("yeni ofis açılışı için duyuru hazırla"), "announcement");
});

test("market-stats: existing keyword vocabulary remains intact", () => {
  assert.equal(
    intent.detectContentIntent("piyasa istatistiklerini ve trend verilerini içeren bir rapor hazırla"),
    "market-stats",
  );
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
