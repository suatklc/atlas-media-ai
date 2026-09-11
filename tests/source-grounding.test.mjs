import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same sandboxed loader convention as every other tests/*.test.mjs file.
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

const sourceQuality = loadTypeScriptModule("src/lib/ai/research/retrieval/sourceQuality.ts", () => ({}), { URL });
const evidenceExtraction = loadTypeScriptModule("src/lib/ai/research/retrieval/evidenceExtraction.ts");

function makeMultiUrlMockFetch(responsesByUrl, contentType) {
  return async (url) => {
    const entry = responsesByUrl[String(url)];
    if (!entry) throw new Error(`no mock configured for ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === "content-type" ? contentType : null) },
      arrayBuffer: async () => new TextEncoder().encode(entry).buffer,
    };
  };
}

// ============================================================
// 1. evidenceExtraction.ts — the shared cleanup/cap utility.
// ============================================================

test("evidenceExtraction.stripHtmlToText strips scripts/nav/tags and collapses whitespace", () => {
  const html = `<html><body><nav>menu</nav><script>evil()</script><p>Gerçek   duyuru   metni burada.</p></body></html>`;
  const text = evidenceExtraction.stripHtmlToText(html);
  assert.doesNotMatch(text, /menu|evil/);
  assert.match(text, /Gerçek duyuru metni burada\./);
});

test("evidenceExtraction.capEvidenceText enforces the deterministic character cap", () => {
  const long = "a".repeat(5000);
  const capped = evidenceExtraction.capEvidenceText(long, 100);
  assert.equal(capped.length, 100);
});

test("evidenceExtraction.toEvidenceTextOrUndefined returns undefined for boilerplate-length text, never a fake fallback", () => {
  assert.equal(evidenceExtraction.toEvidenceTextOrUndefined("<div>ok</div>"), undefined);
});

test("evidenceExtraction.toEvidenceTextOrUndefined returns real cleaned text once it's long enough", () => {
  const html = "<p>" + "Gerçek kaynak metni burada uzunca bir açıklama içeriyor. ".repeat(2) + "</p>";
  const result = evidenceExtraction.toEvidenceTextOrUndefined(html);
  assert.ok(result && result.length >= 40);
});

// ============================================================
// 1b. Evidence Safety Gate — classifyEvidenceSufficiency. The chrome
// fixture below is the ACTUAL live-observed TKGM defect text (captured
// during the Phase 2C production verification run): mostly the site's
// own project/menu list, ending in a "go download the linked file"
// stub — non-empty, well past the >=40-char toEvidenceTextOrUndefined
// bar, but not remotely meaningful source evidence.
// ============================================================

const REAL_TKGM_CHROME_EVIDENCE =
  "EN ARA Projeler Projeler Güncel Tescil Harici Alanların Tescillerinin Yapılması Güncel 3 Boyutlu Taşınmaz " +
  "Yönetim Bilgi Sistemi Güncel Akıllı Tapu İşlem Asistanı (ATİAS) Projesi Güncel Tapu Arşivleri Dijital " +
  "Dönüşüm (TADD) Projesi Güncel e-Kadastro Projesi Tümünü Gör Tapu ve Kadastro Genel Müdürlüğü (TKGM) Geri " +
  "Dön Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru Duyuru 07 Eylül 2026 Satış İşlemlerinde " +
  "Zorunlu Deprem Sigortası Hakkında Duyuru dosyasına erişmek için aşağıdaki bağlantıya tıklayınız. Satış " +
  "İşlemlerinde Zorunlu Deprem Sigortası";

test("classifyEvidenceSufficiency: the real, live-observed TKGM navigation-chrome text is NEVER classified as meaningful, despite being well over the length floor", () => {
  const result = evidenceExtraction.classifyEvidenceSufficiency(REAL_TKGM_CHROME_EVIDENCE);
  assert.notEqual(result, "meaningful");
  assert.equal(result, "thin");
});

test("classifyEvidenceSufficiency: genuine, clean article prose is classified as meaningful", () => {
  const genuine =
    "Bakanlık, satış işlemlerinde deprem sigortası poliçesinin tapu müdürlüğüne ibraz edilmesinin " +
    "1 Ekim 2026 tarihinden itibaren zorunlu olacağını, poliçesi bulunmayan başvuruların ise işleme " +
    "alınmayacağını açıkladı. Uygulama tüm il ve ilçelerde geçerli olacak.";
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(genuine), "meaningful");
});

test("classifyEvidenceSufficiency: missing evidence classifies as none, and short-but-clean text classifies as thin (conservative, never promoted to meaningful)", () => {
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(undefined), "none");
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency("Kısa ve gerçek ama yetersiz bir açıklama."), "thin");
});

// ============================================================
// 2. tcmb.ts — evidence from the Atom feed's own <summary>, no second
// fetch. Title-only entries stay evidence-absent, never backfilled.
// ============================================================

const TCMB_ATOM_WITH_SUMMARY = `<?xml version="1.0"?><feed>
<entry>
  <title>TCMB Faiz Kararı Açıklandı</title>
  <link href="https://www.tcmb.gov.tr/x/faiz-karari" />
  <published>11 Eyl 2026 14:00:00</published>
  <summary>Kurul, politika faizini değiştirmeme kararı aldı ve bu kararın gerekçelerini kamuoyuyla paylaştı.</summary>
</entry>
<entry>
  <title>TCMB Basın Duyurusu</title>
  <link href="https://www.tcmb.gov.tr/x/basin-duyurusu" />
  <published>10 Eyl 2026 09:00:00</published>
</entry>
</feed>`;

test("tcmb.ts: an Atom entry with a real <summary> gets genuine evidenceText, distinct from its title, with no second network fetch", async () => {
  const tcmb = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/tcmb.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "application/atom+xml" : null) },
        arrayBuffer: async () => new TextEncoder().encode(TCMB_ATOM_WITH_SUMMARY).buffer,
      }),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await tcmb.fetchTcmbAnnouncements();
  const withSummary = results.find((r) => r.title === "TCMB Faiz Kararı Açıklandı");
  const withoutSummary = results.find((r) => r.title === "TCMB Basın Duyurusu");

  assert.ok(withSummary.evidenceText, "expected the <summary> text to become evidenceText");
  assert.notEqual(withSummary.evidenceText, withSummary.title);
  assert.match(withSummary.evidenceText, /gerekçelerini kamuoyuyla paylaştı/);
  // No <summary> in the feed for this entry — never backfilled from title.
  assert.equal(withoutSummary.evidenceText, undefined);
});

// ============================================================
// 3. economyNews.ts — evidence from the RSS feed's own <description>, no
// second fetch. Items with no <description> stay evidence-absent.
// ============================================================

const AA_URL = "https://www.aa.com.tr/tr/rss/default?cat=ekonomi";
const DUNYA_URL = "https://www.dunya.com/rss";

const AA_RSS_WITH_DESCRIPTION = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Kira Artışlarında Yeni Dönem</title>
  <link>https://www.aa.com.tr/x/kira-yeni-donem</link>
  <pubDate>Fri, 11 Sep 2026 10:00:00 +0300</pubDate>
  <description>Haberde, kira sözleşmelerinde uygulanacak yeni oranların detayları ve geçerlilik tarihleri ayrıntılı biçimde aktarılıyor.</description>
</item>
</channel></rss>`;

const DUNYA_RSS_NO_DESCRIPTION = `<?xml version="1.0"?><rss><channel>
<item>
  <title>Kira Sözleşmelerinde Yeni Dönem</title>
  <link>https://www.dunya.com/x/kira-sozlesme</link>
  <pubDate>Fri, 11 Sep 2026 09:00:00 +0300</pubDate>
</item>
</channel></rss>`;

test("economyNews.ts: an RSS item with a real <description> gets genuine evidenceText, distinct from its title, with no second network fetch", async () => {
  const relevance = loadTypeScriptModule("src/lib/ai/research/retrieval/relevance.ts");
  const economyNews = loadTypeScriptModule(
    "src/lib/ai/research/retrieval/providers/economyNews.ts",
    (specifier) => {
      if (specifier === "../sourceQuality") return sourceQuality;
      if (specifier === "../relevance") return relevance;
      if (specifier === "../evidenceExtraction") return evidenceExtraction;
      return {};
    },
    {
      fetch: makeMultiUrlMockFetch(
        { [AA_URL]: AA_RSS_WITH_DESCRIPTION, [DUNYA_URL]: DUNYA_RSS_NO_DESCRIPTION },
        "application/rss+xml",
      ),
      URL,
      TextEncoder,
      Buffer,
      AbortController,
      setTimeout,
      clearTimeout,
      console: { error: () => {}, log: () => {}, warn: () => {} },
    },
  );

  const results = await economyNews.fetchEconomyNewsAnnouncements();
  const aaResult = results.find((r) => r.publisher === "Anadolu Ajansı (AA)");
  const dunyaResult = results.find((r) => r.publisher === "Dünya Gazetesi");

  assert.ok(aaResult.evidenceText, "expected the <description> text to become evidenceText");
  assert.notEqual(aaResult.evidenceText, aaResult.title);
  assert.match(aaResult.evidenceText, /geçerlilik tarihleri ayrıntılı biçimde aktarılıyor/);
  // No <description> in the feed for this item — never backfilled from title.
  assert.equal(dunyaResult.evidenceText, undefined);
});

// ============================================================
// 4. resmiGazete.ts — deliberately never attempts detail-page evidence
// (per-item entries are commonly PDFs; see the provider's own comment).
// A structural/source check, not a fetch-driven functional one: proves
// the deliberate decision, not an accidental omission.
// ============================================================

test("resmiGazete.ts never sets evidenceText — the deliberate, documented safe-fallback decision, not an oversight", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "src/lib/ai/research/retrieval/providers/resmiGazete.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /evidenceText:/);
  assert.match(source, /deliberately NOT fetching each item's own/);
  assert.match(source, /commonly a PDF/);
});

// ============================================================
// 5. discover.ts — evidenceText propagates from a retrieval result into
// the ContentOpportunity's source, never derived from title/url/publisher.
// ============================================================

test("discover.ts's buildContentOpportunities propagates a real evidenceText into the opportunity's source, unmodified", () => {
  const businessProfile = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
  const discover = loadTypeScriptModule(
    "src/lib/ai/research/discover.ts",
    (specifier) => {
      if (specifier === "../context/businessProfile") return businessProfile;
      if (specifier === "./retrieval/router") return { retrieveCurrentInformation: async () => [] };
      return {};
    },
    { URL },
  );

  const withEvidence = {
    title: "Zorunlu Deprem Sigortası Duyurusu",
    publisher: "TKGM",
    url: "https://www.tkgm.gov.tr/duyurular/x",
    publishedAt: "2026-09-01T00:00:00.000Z",
    tier: "official-authority",
    snippet: "Zorunlu Deprem Sigortası Duyurusu",
    retrievedAt: "2026-09-11T00:00:00.000Z",
    evidenceText: "Duyuruya göre, satış işlemlerinde deprem sigortası poliçesinin ibrazı gerekmektedir.",
  };
  const withoutEvidence = {
    title: "İkinci Bir Duyuru",
    publisher: "TKGM",
    url: "https://www.tkgm.gov.tr/duyurular/y",
    publishedAt: "2026-09-02T00:00:00.000Z",
    tier: "official-authority",
    snippet: "İkinci Bir Duyuru",
    retrievedAt: "2026-09-11T00:00:00.000Z",
  };

  const opportunities = discover.buildContentOpportunities([withEvidence, withoutEvidence]);
  const opp1 = opportunities.find((o) => o.topic === withEvidence.title);
  const opp2 = opportunities.find((o) => o.topic === withoutEvidence.title);

  assert.equal(opp1.sources[0].evidenceText, withEvidence.evidenceText);
  assert.equal(opp2.sources[0].evidenceText, undefined);
});
