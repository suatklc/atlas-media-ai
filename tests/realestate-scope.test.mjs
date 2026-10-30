import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same sandboxed loader convention used throughout tests/*.test.mjs.
let cachedRadarDiagnostics;
function radarDiagnosticsModule() {
  if (!cachedRadarDiagnostics) {
    cachedRadarDiagnostics = loadTypeScriptModule("src/lib/ai/research/retrieval/diagnostics.ts", () => ({}), {
      console: { log: () => {} },
    });
  }
  return cachedRadarDiagnostics;
}

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  // Temporary Radar diagnostics (retrieval/diagnostics.ts) resolve to the
  // real, silent module in every loader, so adapters under test keep their
  // exact behavior without each loader having to list it.
  const withDiagnostics = (specifier) =>
    (specifier === "diagnostics" || specifier.endsWith("/diagnostics")) ? radarDiagnosticsModule() : dependencyLoader(specifier);
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader: withDiagnostics, ...globals };
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

// ===== TKGM source-specific evaluation (live titles + "Konu:" lines, 2026-10-30) =====

const TKGM_DUYURU = "https://www.tkgm.gov.tr/duyurular/x";
const TKGM_HABER = "https://www.tkgm.gov.tr/haberler/x";
const tkgmScope = (text, url = TKGM_DUYURU) => scope.classifyRealEstateScope(text, REGIONS, url);

test("TKGM: 'Vakıf Kültür Varlıklarının Tespiti' is in scope — with its Konu line and title-only", () => {
  assert.equal(tkgmScope("Vakıf Kültür Varlıklarının Tespiti Konulu Duyuru — Konu: Vakıf kültür varlıklarının tespiti hk."), "property");
  assert.equal(tkgmScope("Vakıf Kültür Varlıklarının Tespiti Konulu Duyuru"), "property");
});

test("TKGM: 'Duyuru Değişikliği' is in scope — via its Konu line (yapılaşma) and, title-only, as a /duyurular amendment", () => {
  assert.equal(
    tkgmScope("Duyuru Değişikliği — Konu: 7452 sayılı Olağanüstü Hal Kapsamında Yerleşme ve Yapılaşmaya İlişkin Cumhurbaşkanlığı Kararnamesinin Kabul Edilmesine Dair Kanun’un Ek Madde 1 Uygulamaları Hk."),
    "property",
  );
  assert.equal(tkgmScope("Duyuru Değişikliği"), "property");
  assert.equal(tkgmScope("Duyuru Değişikliği", TKGM_HABER), "out", "the amendment rule is scoped to the announcements section");
});

test("TKGM: '29 Ekim Cumhuriyet Bayramı' and other ceremonial/administrative items are out — TKGM is not accepted unconditionally", () => {
  for (const [title, url] of [
    ["29 Ekim Cumhuriyet Bayramı", TKGM_HABER],
    ["Kurban Bayramı Tebrik Mesajı", TKGM_HABER],
    ["Yeni Yıl Kutlaması", TKGM_HABER],
    ["Genel Müdürümüz Hakan Gedikli, St. Petersburg Uluslararası Ekonomik Forumu’nda Konuştu", TKGM_HABER],
    ["Tapu ve Kadastro Genel Müdürlüğü Sözleşmeli Bilişim Personel Alım İlanı", TKGM_DUYURU],
    ["3713 Sayılı Kanun Kapsamında Kurumumuz Emrine Yerleştirilen Adaylar Hakkında Duyuru", TKGM_DUYURU],
    ["Çevre, Şehircilik ve İklim Değişikliği Bakanımız Sayın Murat Kurum, Cenevre’de Türkiye’nin Şehircilik ve Konut Politikalarındaki Tecrübesini Anlattı", TKGM_HABER],
  ]) {
    assert.equal(tkgmScope(title, url), "out", title);
  }
});

test("TKGM: genuine tapu/kadastro/taşınmaz/imar/mülkiyet notices stay in scope", () => {
  for (const title of [
    "2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru — Konu: Türk Vatandaşlığı Kanununun Uygulanmasına İlişkin Yönetmelik Hk",
    "2024/2 Sayılı Genelge Güncellemesi Hakkında Duyuru — Konu: Yabancıların Taşınmaz Edinimlerinde ve Bazı İşlemlerde Kullanılacak Değerleme Raporlarına İlişkin Usul ve Esaslar",
    "Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru",
    "Kadastro çalışmaları hakkında duyuru",
    "Kat mülkiyeti tesisinde yeni uygulama",
    "İmar uygulamalarına ilişkin tescil işlemleri",
  ]) {
    assert.equal(tkgmScope(title), "property", title);
  }
});

test("discover: TKGM items skip the router keyword pre-filter (scope gate decides); other sources do not", async () => {
  let captured;
  const turkishDate = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  const discover = loadTypeScriptModule("src/lib/ai/research/discover.ts", (specifier) => {
    if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async (query) => ((captured = query), []) };
    if (specifier === "./retrieval/turkishDate") return turkishDate;
    if (specifier === "../context/businessProfile") return businessProfile;
    if (specifier === "./realEstateScope") return scope;
    return {};
  });
  await discover.discoverCurrentContentOpportunities({ now: NOW, limit: 5, maxAgeDays: 30 });
  assert.equal(captured.keywordFilterExempt({ url: "https://www.tkgm.gov.tr/duyurular/x" }), true);
  assert.equal(captured.keywordFilterExempt({ url: "https://www.resmigazete.gov.tr/eskiler/x.htm" }), false);
  assert.equal(captured.keywordFilterExempt({ url: "https://www.aa.com.tr/tr/ekonomi/x" }), false);
});

test("discover: TKGM end to end — Vakıf + Duyuru Değişikliği shortlisted title-only, Bayram excluded, 30-day cutoff kept", async () => {
  const tkgmItem = (title, path, daysAgo) => ({
    ...result(title, "official-authority", daysAgo),
    url: `https://www.tkgm.gov.tr/${path}/${encodeURIComponent(title)}`,
    publisher: "TKGM",
    snippet: title,
  });
  const discover = loadDiscover([
    tkgmItem("Vakıf Kültür Varlıklarının Tespiti Konulu Duyuru", "duyurular", 9),
    tkgmItem("Duyuru Değişikliği", "duyurular", 10),
    tkgmItem("29 Ekim Cumhuriyet Bayramı", "haberler", 1),
    tkgmItem("2024/4 Sayılı Genelge Değişikliği Hakkında Duyuru", "duyurular", 31),
  ]);
  const titles = (await discover.discoverCurrentContentOpportunities({ now: NOW, limit: 5, maxAgeDays: 30 })).map((o) => o.topic).join(" | ");
  assert.match(titles, /Vakıf Kültür/);
  assert.match(titles, /Duyuru Değişikliği/);
  assert.doesNotMatch(titles, /Bayram/);
  assert.doesNotMatch(titles, /2024\/4/, "older than 30 days stays out");
});

test("discover: the retrieval query includes 'yapı denetim' and still never bare 'yapı'", () => {
  const discover = loadDiscover([]);
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  const keywords = discover.buildRetrievalQuery(businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE).keywords;
  assert.ok(keywords.includes("yapı denetim"));
  assert.ok(!keywords.includes("yapı"));
});

test("discover: the retrieval query includes 'yapılaşma' (TKGM's live 'Yerleşme ve Yapılaşmaya İlişkin' notice was dropped without it)", () => {
  const discover = loadDiscover([]);
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  assert.ok(discover.buildRetrievalQuery(businessProfile.ATLAS_DEFAULT_BUSINESS_PROFILE).keywords.includes("yapılaşma"));
});
