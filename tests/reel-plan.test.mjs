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

const reel = loadTypeScriptModule("src/lib/ai/video/reelPlan.ts");

const beat = (label, spoken, onScreen = "Kısa ekran metni") => ({ label, spoken, onScreen, visualBrief: "v" });

test("a clean, grounded Turkish beat sheet is ready: short concrete hook, beats under 4s, loop back to the hook", () => {
  const plan = reel.analyzeReelBeats([
    beat("HOOK", "Vatandaşlık için ev alana 12 ay kuralı.", "12 AY KURALI"),
    beat("STAKE", "Değerleme raporu 12 ayı geçerse yenilenecek.", "RAPOR YENİLENİR"),
    beat("BODY", "Raporu artık SPK lisanslı her kuruluş hazırlayabilir.", "HER SPK KURULUŞU"),
    beat("PAYOFF", "Vatandaşlık dosyanızda tarihi ilk gün kontrol edin.", "TARİHİ KONTROL ET"),
  ]);
  assert.equal(plan.notes.length, 0, plan.notes.join(" | "));
  assert.ok(plan.beats.every((b) => b.flags.length === 0), JSON.stringify(plan.beats.map((b) => b.flags)));
  assert.equal(plan.ready, true);
  assert.equal(plan.beats[1].startSeconds, plan.beats[0].durationSeconds);
});

test("flags a hook past 3s, a long beat, over-long on-screen text, and no loop", () => {
  const plan = reel.analyzeReelBeats([
    beat("HOOK", "Bugün size tapu tarafında son zamanlarda konuşulan ve aslında pek çok kişinin dikkatinden kaçan bir konudan bahsetmek istiyorum."),
    beat("BODY", "Bu konu gerçekten çok önemli çünkü işlemlerinizi doğrudan etkileyebilir ve süreçlerinizi zaman zaman uzatabilir, dikkatli olmak gerekir.", "Bu ekran metni gerçekten de altı kelimeden çok daha uzun"),
    beat("PAYOFF", "Detaylar için bana yazın."),
  ]);
  assert.match(plan.beats[0].flags.join(" "), /3s sınırını aşıyor/);
  assert.match(plan.beats[0].flags.join(" "), /somut/);
  assert.match(plan.beats[1].flags.join(" "), /4s üstü/);
  assert.match(plan.beats[1].flags.join(" "), /ekran metni/);
  assert.ok(plan.notes.some((n) => /Loop yok/.test(n)));
  assert.equal(plan.ready, false);
});

test("three abstract beats in a row are called out", () => {
  const plan = reel.analyzeReelBeats([
    beat("HOOK", "TKGM 2 hafta önce kuralı değiştirdi."),
    beat("BODY", "Bu çok önemli bir konu."),
    beat("BODY", "Herkes bunu bilmeli."),
    beat("BODY", "Dikkatli olmak lazım."),
    beat("PAYOFF", "Kuralı bilin."),
  ]);
  assert.ok(plan.notes.some((n) => /somut hiçbir şey yok/.test(n)));
});

function makePackage() {
  const slide = (index, role, headline, body, facts) => ({ index, role, headline, body, facts, visualBrief: `brief ${index}` });
  return {
    topic: "t",
    source: { name: "TKGM", url: "https://example.com", publishedAt: "29.09.2026" },
    hook: "Vatandaşlık için ev alıyorsanız değerleme raporu kuralı değişti.",
    caption: "c",
    hashtags: ["#Tapu"],
    format: "carousel",
    slides: [
      slide(1, "hook", "Rapor kuralı değişti", "b1", []),
      slide(2, "what-happened", "SPK lisanslı her kuruluş", "b2", ["Rapor SPK lisanslı herhangi bir kuruluşça hazırlanabilir.", "12 ayı geçen raporlar yenilenecek."]),
      slide(3, "why-it-matters", "Kimi etkiliyor", "Vatandaşlık başvurusu yapacak yabancı alıcıları etkiliyor. İkinci cümle.", []),
      slide(4, "what-to-do", "Ne yapmalı", "b4", ["Rapor tarihini kontrol edin.", "Başvuruyu 12 ay içinde yapın."]),
      slide(5, "cta", "Uzman görüşü", "Vatandaşlık dosyasında takvim, fiyat kadar önemli. Sorularınız için yazın.", []),
    ],
    facts: [],
  };
}

test("buildReelDraft seeds beats ONLY from the grounded package, in hook → stake → body → payoff order", () => {
  const pkg = makePackage();
  const plan = reel.buildReelDraft(pkg);
  assert.equal(plan.beats.map((b) => b.label).join(","), "HOOK,STAKE,BODY,BODY,BODY,BODY,PAYOFF");
  assert.equal(plan.beats[0].spoken, pkg.hook);
  assert.equal(plan.beats[1].spoken, "Vatandaşlık başvurusu yapacak yabancı alıcıları etkiliyor.");
  assert.equal(plan.beats[2].spoken, pkg.slides[1].facts[0]);
  assert.equal(plan.beats[6].visualBrief, "brief 5");
  // Every spoken line is text the package already contains — no new claims.
  const packageText = JSON.stringify(pkg);
  for (const b of plan.beats) assert.ok(packageText.includes(b.spoken), b.spoken);
});

test("buildReelDraft refuses a single-image package", () => {
  assert.equal(reel.buildReelDraft({ ...makePackage(), format: "single" }), null);
});

test("Reels logic never generates media, approves, or publishes", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/lib/ai/video/reelPlan.ts"), "utf8");
  assert.doesNotMatch(source, /^import .*(media\/router|publishing|supabase)/m);
  assert.doesNotMatch(source, /generateVideo\(|publishGeneratedPost|status:\s*"(approved|posted)"/);
});
