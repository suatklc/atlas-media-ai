import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import Module from "node:module";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);

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

// Real-execution loader (real fs/network-free real deps, real `unpdf`) —
// same convention already established in tests/content-package.test.mjs
// and tests/carousel.test.mjs. Used for the TKGM linked-PDF tests below
// so `evidenceExtraction.ts`'s own `await import("unpdf")` resolves to
// the REAL installed package — genuine end-to-end proof, not a mock of
// the one thing these tests exist to verify.
const realModuleCache = new Map();
function loadRealTsModule(absPath) {
  const normalized = path.resolve(absPath);
  if (realModuleCache.has(normalized)) return realModuleCache.get(normalized);
  const source = fs.readFileSync(normalized, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exportsObj = {};
  realModuleCache.set(normalized, exportsObj);
  const dir = path.dirname(normalized);
  const localRequire = (specifier) => {
    if (specifier.startsWith(".")) {
      const resolvedBase = path.resolve(dir, specifier);
      const candidate = fs.existsSync(`${resolvedBase}.ts`) ? `${resolvedBase}.ts` : resolvedBase;
      return loadRealTsModule(candidate);
    }
    return nodeRequire(specifier);
  };
  const wrapped = Module.wrap(js);
  const compiledWrapper = vm.runInThisContext(wrapped, { filename: normalized });
  const moduleObj = { exports: exportsObj };
  compiledWrapper(exportsObj, localRequire, moduleObj, normalized, dir);
  realModuleCache.set(normalized, moduleObj.exports);
  return moduleObj.exports;
}

// Real module — discover.ts renders whyNow in Turkey-local time through it.
const turkishDateForDiscover = loadTypeScriptModule("src/lib/ai/research/retrieval/turkishDate.ts");
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
      if (specifier === "./retrieval/turkishDate") return turkishDateForDiscover;
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

// ============================================================
// 6. TKGM Linked-PDF Evidence Extraction — the actual TKGM announcement
// detail page is a thin stub; the real content lives in a linked PDF on
// TKGM's own CMS media host. These tests use a REAL, valid, minimal PDF
// fixture (built and verified once against the real `unpdf` package —
// not a giant embedded binary; ~750 bytes) run through the REAL
// evidenceExtraction.ts + tkgm.ts via loadRealTsModule, with only the
// global `fetch` monkey-patched for the test's duration. This proves
// genuine end-to-end PDF text extraction, not a mocked stand-in for the
// one thing these tests exist to verify.
// ============================================================

// A minimal, valid, single-page PDF (built + verified via the real
// `unpdf` package before being embedded here) whose only content is one
// Tj text-showing operator — deliberately tiny rather than a real
// multi-KB document, per the "avoid a huge binary fixture" guidance.
const MINIMAL_PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAwIDE1MF0gL0NvbnRlbnRzIDQgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDUgMCBSID4+ID4+ID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggMjAyID4+CnN0cmVhbQpCVCAvRjEgMTAgVGYgMTAgMTAwIFRkIChCYWthbmxpayBzYXRpcyBpc2xlbWxlcmluZGUgZGVwcmVtIHNpZ29ydGFzaSBpYnJhemluaW4gem9ydW5sdSBvbGR1Z3VudSB2ZSBwb2xpY2VzaSBidWx1bm1heWFuIGJhc3Z1cnVsYXJpbiBpc2xlbm1leWVjZWdpbmkgYmlsZGlybWlzdGlyIHRlc2NpbCBvbmNlc2kga29udHJvbCBlZGlsZWNla3Rpci4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MiAwMDAwMCBuIAowMDAwMDAwNDk1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNTY1CiUlRU9G";

const REAL_PDF_EXPECTED_TEXT =
  "Bakanlik satis islemlerinde deprem sigortasi ibrazinin zorunlu oldugunu ve policesi bulunmayan basvurularin islenmeyecegini bildirmistir tescil oncesi kontrol edilecektir.";

const PDF_LINK_PATH = "/media-library/testfixture0000pdfhash.pdf";
const PDF_URL = `https://cms-api.tkgm.gov.tr${PDF_LINK_PATH}`;
const TKGM_ORIGIN = "https://www.tkgm.gov.tr";
const DETAIL_SLUG = "satis-islemlerinde-zorunlu-deprem-sigortasi-hakkinda-duyuru";
const DETAIL_URL = `${TKGM_ORIGIN}/duyurular/${DETAIL_SLUG}`;

const LISTING_HTML_WITH_ONE_ITEM = `<a class="group block border-[#E4E4E7] rounded-[10px] border  p-4" href="/duyurular/${DETAIL_SLUG}"><div class="flex flex-col gap-4"><h3 class="line-clamp-2 text-lg font-semibold">Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru</h3><div class="flex items-center justify-between"><span class="rounded-full">Duyuru</span><p class="text-[15px] font-medium text-gray-500">07 Eylül 2026</p></div></div></a>`;

// A realistic thin stub, matching the real, live-observed TKGM detail
// page shape: chrome text plus the "go download the file" sentence,
// with a PDF link discoverable in it (the exact pattern the real page
// embeds, minus the surrounding JSON-escaping noise, which the
// discovery regex deliberately ignores).
function detailHtmlWithPdfLink(pdfPath) {
  return `<html><body><nav>Projeler Güncel Tescil Harici Alanların Güncel</nav>
    <p>Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru dosyasına erişmek için aşağıdaki bağlantıya tıklayınız.</p>
    <a href="${pdfPath}">indir</a></body></html>`;
}

const DETAIL_HTML_NO_PDF_LINK = `<html><body><nav>Projeler Güncel Tescil Harici Alanların Güncel</nav>
  <p>Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru dosyasına erişmek için aşağıdaki bağlantıya tıklayınız.</p>
  </body></html>`;

function makeTkgmMockFetch(pdfResponse) {
  return async (url) => {
    const key = String(url);
    if (key === `${TKGM_ORIGIN}/duyurular` || key === `${TKGM_ORIGIN}/haberler`) {
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
        arrayBuffer: async () => new TextEncoder().encode(key.endsWith("/haberler") ? "<html></html>" : LISTING_HTML_WITH_ONE_ITEM).buffer,
      };
    }
    if (key === DETAIL_URL) {
      return {
        ok: true,
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
        arrayBuffer: async () => new TextEncoder().encode(pdfResponse.detailHtml).buffer,
      };
    }
    if (key === PDF_URL) {
      if (pdfResponse.pdfError) throw pdfResponse.pdfError;
      return {
        ok: pdfResponse.pdfOk ?? true,
        status: pdfResponse.pdfStatus ?? 200,
        headers: { get: (n) => (n.toLowerCase() === "content-type" ? (pdfResponse.pdfContentType ?? "application/pdf") : null) },
        arrayBuffer: async () => new Uint8Array(pdfResponse.pdfBytes).buffer,
      };
    }
    throw new Error(`no mock configured for ${key}`);
  };
}

async function runTkgmWithMockFetch(pdfResponse) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeTkgmMockFetch(pdfResponse);
  try {
    const tkgm = loadRealTsModule(
      path.join(projectRoot, "src/lib/ai/research/retrieval/providers/tkgm.ts"),
    );
    return await tkgm.fetchTkgmAnnouncements();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("tkgm.ts: discovers the linked PDF on the detail page and extracts its real text as evidenceText", async () => {
  const pdfBytes = Buffer.from(MINIMAL_PDF_BASE64, "base64");
  const results = await runTkgmWithMockFetch({
    detailHtml: detailHtmlWithPdfLink(PDF_LINK_PATH),
    pdfBytes,
  });

  const item = results.find((r) => r.url === DETAIL_URL);
  assert.ok(item, "expected the DASK announcement to be discovered");
  assert.equal(item.evidenceText, REAL_PDF_EXPECTED_TEXT);
  assert.notEqual(item.evidenceText, item.title, "PDF evidence must never equal the title");
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(item.evidenceText), "meaningful");
});

test("tkgm.ts: a non-PDF response at the linked URL safely falls back to the existing thin detail-page evidence — never the title", async () => {
  const results = await runTkgmWithMockFetch({
    detailHtml: detailHtmlWithPdfLink(PDF_LINK_PATH),
    pdfBytes: Buffer.from("not a pdf"),
    pdfContentType: "text/html",
  });

  const item = results.find((r) => r.url === DETAIL_URL);
  assert.notEqual(item.evidenceText, item.title);
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(item.evidenceText), "thin");
});

test("tkgm.ts: a malformed PDF (wrong signature despite application/pdf content-type) safely falls back to thin evidence", async () => {
  const results = await runTkgmWithMockFetch({
    detailHtml: detailHtmlWithPdfLink(PDF_LINK_PATH),
    pdfBytes: Buffer.from("NOTPDF-this-is-not-a-real-pdf-signature-at-all"),
  });

  const item = results.find((r) => r.url === DETAIL_URL);
  assert.notEqual(item.evidenceText, item.title);
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(item.evidenceText), "thin");
});

test("tkgm.ts: a PDF fetch network failure safely falls back to thin evidence, never crashes discovery", async () => {
  const results = await runTkgmWithMockFetch({
    detailHtml: detailHtmlWithPdfLink(PDF_LINK_PATH),
    pdfBytes: Buffer.from(""),
    pdfError: new Error("simulated network failure"),
  });

  const item = results.find((r) => r.url === DETAIL_URL);
  assert.ok(item, "discovery must not crash even when the PDF fetch fails");
  assert.notEqual(item.evidenceText, item.title);
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(item.evidenceText), "thin");
});

test("tkgm.ts: no linked PDF found on the detail page leaves the existing HTML-stub evidence path completely unchanged", async () => {
  const results = await runTkgmWithMockFetch({
    detailHtml: DETAIL_HTML_NO_PDF_LINK,
    pdfBytes: Buffer.from(""),
  });

  const item = results.find((r) => r.url === DETAIL_URL);
  assert.notEqual(item.evidenceText, item.title);
  assert.equal(evidenceExtraction.classifyEvidenceSufficiency(item.evidenceText), "thin");
});

test("evidenceExtraction.ts: extractPdfTextOrUndefined applies the existing deterministic evidence cap (capEvidenceText), not an unbounded pass-through", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "src/lib/ai/research/retrieval/evidenceExtraction.ts"),
    "utf8",
  );
  const fnMatch = source.match(/export async function extractPdfTextOrUndefined[\s\S]*?\n}/);
  assert.ok(fnMatch, "extractPdfTextOrUndefined not found");
  assert.match(fnMatch[0], /capEvidenceText\(/);
});

test("extractPdfTextOrUndefined returns undefined (never fabricates evidence) when given bytes that are not a parseable PDF", async () => {
  const evidenceExtractionReal = loadRealTsModule(
    path.join(projectRoot, "src/lib/ai/research/retrieval/evidenceExtraction.ts"),
  );
  const result = await evidenceExtractionReal.extractPdfTextOrUndefined(
    new Uint8Array(Buffer.from("this is definitely not a pdf")),
  );
  assert.equal(result, undefined);
});

// ============================================================
// 7. Context-Safe Evidence Blocks — a proven source document can
// contain multiple TRUE provisions for genuinely different scenarios;
// markScenarioBoundaries marks (never removes/rewrites) the boundary a
// generic Turkish legal-branch connective already signals in the
// source, so the model sees the boundary instead of inferring it from
// dense, topically-overlapping prose alone.
// ============================================================

test("markScenarioBoundaries inserts the neutral marker immediately before a known branch connective, leaving the connective itself untouched", () => {
  const text = "Birinci durumda kural A gecerlidir. Aksi takdirde kural B gecerlidir.";
  const result = evidenceExtraction.markScenarioBoundaries(text);
  assert.match(result, /Birinci durumda kural A gecerlidir\. \[AYRI KOŞUL \/ SENARYO BLOĞU\] Aksi takdirde kural B gecerlidir\./);
});

test("markScenarioBoundaries's marker is neutral — it never states irrelevance, falsity, or that content should be discarded", () => {
  assert.equal(evidenceExtraction.SCENARIO_BOUNDARY_MARKER, "[AYRI KOŞUL / SENARYO BLOĞU]");
  const forbiddenWords = /irrelevant|ilgisiz|yanlış|false|discard|yoksay|geçersiz/i;
  assert.doesNotMatch(evidenceExtraction.SCENARIO_BOUNDARY_MARKER, forbiddenWords);
});

test("markScenarioBoundaries preserves the original source text exactly — removing only the inserted markers reconstructs the original", () => {
  const text = "Bir metin burada. Diğer hâllerde ise farklı bir kural uygulanır. Devamı burada.";
  const result = evidenceExtraction.markScenarioBoundaries(text);
  const reconstructed = result.split(`${evidenceExtraction.SCENARIO_BOUNDARY_MARKER} `).join("");
  assert.equal(reconstructed, text);
});

test("markScenarioBoundaries leaves ordinary prose with no branch connective completely unchanged", () => {
  const text = "Bu tamamen sıradan bir cümledir ve hiçbir senaryo geçişi içermez.";
  assert.equal(evidenceExtraction.markScenarioBoundaries(text), text);
});

test("markScenarioBoundaries's connective list contains no TKGM/DASK/real-estate-domain vocabulary — it stays source/domain generic", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "src/lib/ai/research/retrieval/evidenceExtraction.ts"),
    "utf8",
  );
  const listMatch = source.match(/const SCENARIO_BRANCH_CONNECTIVES = \[([\s\S]*?)\];/);
  assert.ok(listMatch, "SCENARIO_BRANCH_CONNECTIVES not found");
  const forbiddenDomainTerms = /dask|tkgm|tapu|satış|satis|poliçe|police|malik|deprem|sigorta/i;
  assert.doesNotMatch(listMatch[1], forbiddenDomainTerms);
});

test("extractPdfTextOrUndefined applies scenario boundary marking to real PDF text before capping — the marker reaches the final evidenceText", async () => {
  // A minimal, valid PDF (built + verified via the real `unpdf` package)
  // reproducing the proven regression pattern: a first-scenario
  // statement, a generic branch connective ("Aksi takdirde"), then a
  // second-scenario rule containing a number — the exact shape of the
  // live DASK defect, without needing a large real-document fixture.
  const BOUNDARY_FIXTURE_PDF_BASE64 =
    "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MDAwIDE1MF0gL0NvbnRlbnRzIDQgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgL0YxIDUgMCBSID4+ID4+ID4+CmVuZG9iago0IDAgb2JqCjw8IC9MZW5ndGggMTYyID4+CnN0cmVhbQpCVCAvRjEgMTAgVGYgMTAgMTAwIFRkIChCaXJpbmNpIGR1cnVtZGEgdGFyYWYgYmlyIGlzbGVtaSB0YW1hbWxhci4gQWtzaSB0YWtkaXJkZSBpbGdpbGkgdGFyYWYsIGJpbGRpcmltIHRhcmloaW5kZW4gaXRpYmFyZW4gMjQgc2FhdCBpY2luZGUgaXNsZW1pIHRhbWFtbGFyLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQyIDAwMDAwIG4gCjAwMDAwMDA0NTUgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo1MjUKJSVFT0Y=";

  const evidenceExtractionReal = loadRealTsModule(
    path.join(projectRoot, "src/lib/ai/research/retrieval/evidenceExtraction.ts"),
  );
  const pdfBytes = new Uint8Array(Buffer.from(BOUNDARY_FIXTURE_PDF_BASE64, "base64"));
  const evidenceText = await evidenceExtractionReal.extractPdfTextOrUndefined(pdfBytes);

  assert.ok(evidenceText, "expected real evidence text to be extracted");
  assert.match(evidenceText, /\[AYRI KOŞUL \/ SENARYO BLOĞU\] Aksi takdirde/);
  // The first-scenario statement and the second-scenario rule (with its
  // real number) both remain fully readable — nothing was deleted.
  assert.match(evidenceText, /Birinci durumda taraf bir islemi tamamlar/);
  assert.match(evidenceText, /24 saat icinde islemi tamamlar/);
  // The existing deterministic cap still applies.
  assert.ok(evidenceText.length <= evidenceExtractionReal.EVIDENCE_TEXT_MAX_CHARS);
  // The existing evidence sufficiency gate is unaffected by the marker.
  assert.equal(evidenceExtractionReal.classifyEvidenceSufficiency(evidenceText), "meaningful");
});

test("content-package prompt forbids transferring a number, deadline, obligation, procedure, or consequence across a scenario boundary marker", () => {
  const routeSource = fs.readFileSync(
    path.join(projectRoot, "src/app/api/content-package/route.ts"),
    "utf8",
  );
  assert.match(routeSource, /AYRI KOŞUL \/ SENARYO BLOĞU/);
  assert.match(routeSource, /sayı, süre, yükümlülük, prosedür veya sonucu/);
});
