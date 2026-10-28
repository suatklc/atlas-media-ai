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

const scope = loadTypeScriptModule("src/lib/ai/research/realEstateScope.ts", () => ({}), { URL });
const REGIONS = ["Zekeriyaköy", "Uskumruköy", "Demirciköy", "Gümüşdere", "Kilyos", "Sarıyer"];
const classify = (text) => scope.classifyRealEstateScope(text, REGIONS);

test("scope: real-estate topics across the WHOLE property scope (not villa-only) are 'property'", () => {
  for (const title of [
    "Konut Fiyat Endeksi, Eylül 2026",
    "Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru",
    "Yabancıların Taşınmaz Edinimlerinde Değerleme Raporu",
    "Arsaların değerlemesinde yeni dönem",
    "Tarla ve araziler için hisseli tapu satışlarında yeni kural",
    "Plan notlarında değişiklik: imarlı parsellerde yapılaşma",
    "Kat karşılığı inşaat sözleşmelerinde dikkat edilecekler",
    "Kentsel dönüşümde yeni destek paketi",
    "Kira artışında yeni dönem başladı",
    "Konut kredisi faizleri yükseldi",
    "Villa projelerinde talep kuzeye kaydı",
    "Gayrimenkul yatırım ortaklıkları (GYO) halka arz",
    "Sarıyer'e yeni metro hattı için ihale tamamlandı",
    "Zekeriyaköy yolu genişletme projesi başladı",
  ]) {
    assert.equal(classify(title), "property", title);
  }
});

test("scope: rate/inflation/credit-only and region-only items are 'macro' (fallback material only)", () => {
  for (const title of [
    "Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)",
    "Enflasyon Raporu 2026-IV",
    "Para politikası kurulu toplantı özeti",
    "Sarıyer Belediyesi kültür festivali programı",
  ]) {
    assert.equal(classify(title), "macro", title);
  }
});

test("scope: general/unrelated news and look-alike words are 'out' — never a content opportunity", () => {
  for (const title of [
    "Altın fiyatları güne yükselişle başladı",
    "Otomobil satışlarında rekor",
    "Borsa İstanbul günü yükselişle tamamladı",
    "Yapı Kredi Bankası yeni genel müdürünü atadı",
    "Emlak Katılım ilk çeyrek bilançosunu açıkladı",
    "Kiraz ihracatında rekor",
    "Mülki idare amirleri kararnamesi yayımlandı",
    "Bilgi İşlem Daire Başkanlığı personel alım ilanı",
    "Türkiye turnuvaya ev sahipliği yapacak",
    "Akaryakıt fiyatlarına zam",
  ]) {
    assert.equal(classify(title), "out", title);
  }
});

// ===== discover.ts end to end (router mocked with a mixed candidate pool) =====

function result(title, tier = "official-authority", daysAgo = 2) {
  const publishedAt = new Date(Date.parse("2026-10-28T09:00:00.000Z") - daysAgo * 86400000).toISOString();
  return {
    title,
    url: `https://example.gov.tr/${encodeURIComponent(title)}`,
    publisher: tier === "official-authority" ? "TKGM" : "Dünya",
    publishedAt,
    tier,
    snippet: "",
    retrievedAt: "2026-10-28T09:00:00.000Z",
  };
}

function loadDiscover(pool) {
  const turkishDate = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  return loadTypeScriptModule("src/lib/ai/research/discover.ts", (specifier) => {
    if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => pool };
    if (specifier === "./retrieval/turkishDate") return turkishDate;
    if (specifier === "../context/businessProfile") return businessProfile;
    if (specifier === "./realEstateScope") return scope;
    return {};
  });
}

const NOW = new Date("2026-10-28T09:00:00.000Z");

test("discover: general news never enters the shortlist; property topics do", async () => {
  const discover = loadDiscover([
    result("Altın fiyatları güne yükselişle başladı", "financial-news"),
    result("Otomobil satışlarında rekor", "financial-news"),
    result("Yapı Kredi Bankası yeni genel müdürünü atadı", "financial-news"),
    result("Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru"),
    result("Arsaların değerlemesinde yeni dönem", "financial-news"),
    result("Konut Fiyat Endeksi, Eylül 2026", "primary-data"),
  ]);
  const list = await discover.discoverCurrentContentOpportunities({ now: NOW, limit: 5, maxAgeDays: 30 });
  const titles = list.map((o) => o.topic).join(" | ");
  assert.doesNotMatch(titles, /Altın|Otomobil|Yapı Kredi/);
  assert.match(titles, /Deprem Sigortası/);
  assert.match(titles, /Arsaların/);
  assert.match(titles, /Konut Fiyat Endeksi/);
});

test("discover: a macro item only fills a short list (max 1), only from an official/primary source — never ahead of property topics", async () => {
  const discover = loadDiscover([
    result("Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)", "official-authority"),
    result("Enflasyon Raporu 2026-IV", "primary-data"),
    result("Kredi kartı harcamaları arttı", "financial-news"),
    result("Kira artışında yeni dönem başladı", "financial-news"),
  ]);
  const list = await discover.discoverCurrentContentOpportunities({ now: NOW, limit: 5, maxAgeDays: 30 });
  assert.equal(list.length, 2, "1 property topic + at most 1 macro fill");
  assert.match(list[0].topic, /Kira/);
  assert.match(list[1].topic, /Faiz|Enflasyon/);
  assert.ok(!list.some((o) => /Kredi kartı/.test(o.topic)), "a news-tier macro item never fills");

  const full = loadDiscover([
    result("Faiz Oranlarına İlişkin Basın Duyurusu (2026-28)"),
    ...["Kira artışında yeni dönem", "Arsalarda hisseli satış kuralı", "Konut satışları Eylül", "İmar planı askıya çıktı", "Kentsel dönüşüm desteği"].map((t) => result(t)),
  ]);
  const fullList = await full.discoverCurrentContentOpportunities({ now: NOW, limit: 5, maxAgeDays: 30 });
  assert.ok(!fullList.some((o) => /Faiz Oranlarına/.test(o.topic)), "no macro item when property topics fill the list");
});

// ===== Expert content scope: not villa-locked =====

test("expert brief covers the whole property scope and never assumes villa", () => {
  const source = fs.readFileSync(path.join(projectRoot, "src/app/api/content-package/route.ts"), "utf8");
  assert.ok(source.includes("Talimat villa demiyorsa villa varsayma"));
  for (const type of ['"villa / konut"', '"arsa / arazi"', '"imar / yatırım / inşaat-yapılaşma"', '"piyasa / bölgesel gelişmeler"']) {
    assert.ok(source.includes(type), type);
  }
  assert.ok(!source.includes("VİLLADA KONUMLANDIRMA"), "slide roles are no longer villa-specific");
});

test("expert cover image: villa art direction only for home topics; land/zoning topics never get a villa cover", () => {
  const prompt = loadTypeScriptModule("src/lib/ai/creative/goldStandardImagePrompt.ts", (s) => (s === "./image-prompt" ? {} : {}));
  assert.equal(prompt.prefersVillaArtDirection("Zekeriyaköy'de villanızı satarken"), true);
  assert.equal(prompt.prefersVillaArtDirection("Evinizin değerini doğru belirlemek"), true);
  assert.equal(prompt.prefersVillaArtDirection("Arsa alırken imar durumuna bakın"), false);
  assert.equal(prompt.prefersVillaArtDirection("Villa yapılabilir arsa seçerken"), false, "land wins over residential");
  assert.equal(prompt.prefersVillaArtDirection("TAKS ve KAKS nedir"), false);
});

test("scope: a property-domain source (TKGM) is in scope without property wording — but its administrative notices are not (live-observed titles)", () => {
  const tkgm = "https://www.tkgm.gov.tr/duyurular/2024-4-sayili-genelge";
  assert.equal(scope.classifyRealEstateScope("2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru", REGIONS, tkgm), "property");
  assert.equal(scope.classifyRealEstateScope("Tapu ve Kadastro Genel Müdürlüğü Sözleşmeli Bilişim Personel Alım İlanı", REGIONS, tkgm), "out");
  assert.equal(
    scope.classifyRealEstateScope("Çevre, Şehircilik ve İklim Değişikliği Bakanımız Sayın Murat Kurum, Cenevre’de", REGIONS, tkgm),
    "out",
  );
  assert.equal(scope.classifyRealEstateScope("2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru", REGIONS, "https://www.aa.com.tr/x"), "out", "only the property-domain host gets this");
  assert.equal(
    scope.classifyRealEstateScope("Ödemeler Dengesi İstatistikleri Finans Hesabında Yapılacak Revizyona İlişkin Basın Duyurusu", REGIONS, "https://www.tcmb.gov.tr/x"),
    "out",
  );
});
