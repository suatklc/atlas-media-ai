import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// research/ownerFeeds.ts — the free RSS path (Gayrimenkul Gündemi, Sarıyer
// Posta). Stub fetch only; no network.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadTypeScriptModule(relativePath, dependencyLoader = () => ({}), globals = {}) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  const context = { loadedModule, exports: loadedModule.exports, dependencyLoader, URL, ...globals };
  vm.runInNewContext(
    `(function (exports, dependencyLoader) { const require = dependencyLoader; ${output}\n})(exports, dependencyLoader);`,
    context,
  );
  return loadedModule.exports;
}

const SILENT = { log: () => {}, error: () => {} };
const diagnostics = loadTypeScriptModule("src/lib/ai/research/retrieval/diagnostics.ts", () => ({}), { console: SILENT });
const coverage = loadTypeScriptModule("src/lib/ai/research/retrieval/coverage.ts");
const evidenceExtraction = loadTypeScriptModule("src/lib/ai/research/retrieval/evidenceExtraction.ts");
const sourceQuality = loadTypeScriptModule("src/lib/ai/research/retrieval/sourceQuality.ts");
const places = loadTypeScriptModule("src/lib/ai/research/turkishPlaces.ts");
const ownerProposals = loadTypeScriptModule("src/lib/ai/content/ownerProposals.ts", (s) => (s === "../research/turkishPlaces" ? places : {}));
const { ATLAS_DEFAULT_BUSINESS_PROFILE: profile } = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");

// discover.ts's buildContentOpportunities is exercised elsewhere; a minimal
// stand-in keeps this test about the feed path itself.
const discoverStub = {
  buildContentOpportunities: (results) =>
    results.map((r) => ({ topic: r.title, angle: r.editorialAngle, whyNow: "w", keyFacts: [r.title], sources: [{ title: r.title, publisher: r.publisher, url: r.url, publishedAt: r.publishedAt, tier: r.tier, evidenceText: r.evidenceText }], freshness: "recent", topicFamily: "market-data" })),
};

function loadFeeds(routes, requested = []) {
  return loadTypeScriptModule(
    "src/lib/ai/research/ownerFeeds.ts",
    (s) =>
      ({
        "./retrieval/coverage": coverage,
        "./retrieval/evidenceExtraction": evidenceExtraction,
        "./retrieval/sourceQuality": sourceQuality,
        "./retrieval/diagnostics": diagnostics,
        "./discover": discoverStub,
        "../content/ownerProposals": ownerProposals,
      })[s] ?? {},
    {
      console: SILENT,
      TextDecoder,
      AbortSignal,
      fetch: async (url) => {
        requested.push(String(url));
        const body = routes[String(url)];
        if (body === undefined) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
      },
    },
  );
}

const rssItem = (title, link, pubDate, description = "", category = "Emlak Gündemi") =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${pubDate}</pubDate><category><![CDATA[${category}]]></category><description><![CDATA[${description}]]></description></item>`;

const GG_FEED = `<rss><channel>${[
  rssItem("Konut Piyasasında Bekleme Dönemi: Satışlar Düştü, Reel Fiyat Kaybı Hızlandı", "https://www.gayrimenkulgundemi.com/konut-piyasasinda-bekleme-donemi/", "Wed, 18 Nov 2026 04:25:00 +0000", "<p>Ekim ayında konut satışları geriledi&#8230;</p>"),
  rssItem("Kredi Faizleri Düşmeden Harekete Geçen Nakit Alıcılar Kazanacak", "https://www.gayrimenkulgundemi.com/nakit-alicilar/", "Wed, 18 Nov 2026 00:55:00 +0000"),
  rssItem("Miras Kalan Ev Satılırsa Vergi Çıkar mı?", "https://www.gayrimenkulgundemi.com/miras/", "Mon, 16 Nov 2026 12:22:00 +0000", "Miras yoluyla edinilen konutun satışında değer artış kazancı vergisi ve muafiyet koşulları anlatılıyor."),
].join("")}</channel></rss>`;

const SP_FEED = `<rss><channel>${[
  rssItem("Poligon’da 40 ailenin dönüşüm çağrısı!", "https://www.sariyerposta.com/poligonda-40-ailenin-donusum-cagrisi", "Mon, 16 Nov 2026 18:25:00 +0000", "Poligon'da aileler bekliyor.", "SARIYER HABERLERİ"),
  rssItem("Rumeli Kavağı’nda ölü yunus karaya vurdu", "https://www.sariyerposta.com/olu-yunus", "Mon, 16 Nov 2026 17:47:00 +0000"),
  rssItem("Sarıyer'de ilk haber", "https://www.sariyerposta.com/ilk", "Mon, 09 Nov 2026 16:29:00 +0000"),
  // Old gallery/video entries the feed appends — not articles.
  rssItem("Kefeliköy/SARIYER", "https://www.sariyerposta.com/foto-galeri/kefelikoysariyer", "Fri, 02 Jan 2026 19:30:00 +0000", "", "GENEL"),
  rssItem("ŞÜKRÜ GENÇ İLE RÖPORTAJ", "https://www.sariyerposta.com/video/sukru-genc-ile-roportaj", "Tue, 12 Mar 2019 12:00:00 +0000", "", "GENEL"),
].join("")}</channel></rss>`;

const POLIGON_ARTICLE = `<html><head><meta property="og:description" content="Kısa özet" /></head><body><nav><p>Menü bağlantıları ve site gezinme metni burada yer alır.</p></nav>
<div class="article-text" property="articleBody"><p><img src="x.jpg"/></p><p><strong>Sarıyer Poligon Mahallesi’nde evleri yaklaşık 1,5 yıl önce yıkılan 40’a yakın aile, kentsel dönüşüm projesinin başlamasını bekliyor.</strong></p><p>Aileler sürecin uzamasının kendilerini mağdur ettiğini belirterek yetkililere çağrıda bulundu.</p></div></body></html>`;
const GG_ARTICLE = `<html><body><div class="entry-content clearfix"><p>Türkiye genelinde ekim ayında gerçekleşen konut satışları, geçen yılın aynı dönemine kıyasla azaldı.</p><p>İkinci el satışlarda düşüş daha belirgin oldu ve piyasada bekleme eğilimi öne çıktı.</p></div></body></html>`;

const NOW = new Date("2026-11-18T10:00:00.000Z");
const WINDOW = { notBefore: new Date(NOW.getTime() - 30 * 86400000) };

test("profile: the two named feeds", () => {
  assert.deepEqual([...profile.newsFeeds.map((f) => f.url)], ["https://www.gayrimenkulgundemi.com/feed", "https://sariyerposta.com/rss"]);
});

test("parseFeed: CDATA/entities decoded, HTML stripped, gallery/video entries are not articles", () => {
  const feeds = loadFeeds({});
  const items = feeds.parseFeed(SP_FEED, "sariyer-posta", "Sarıyer Posta");
  assert.deepEqual([...items.map((i) => i.title)], ["Poligon’da 40 ailenin dönüşüm çağrısı!", "Rumeli Kavağı’nda ölü yunus karaya vurdu", "Sarıyer'de ilk haber"]);
  const gg = feeds.parseFeed(GG_FEED, "gayrimenkul-gundemi", "Gayrimenkul Gündemi");
  assert.equal(gg[0].description, "Ekim ayında konut satışları geriledi…");
  assert.equal(gg[0].publishedAt, "2026-11-18T04:25:00.000Z");
  const undated = feeds.parseFeed(`<item><title>T</title><link>https://a.example/t</link><pubDate>yok</pubDate></item>`, "x", "X");
  assert.equal(undated[0].publishedAt, "", "unparsable date stays empty, never guessed");
});

test("extractArticleText: only the article body paragraphs (not the page chrome); og:description fallback", () => {
  const feeds = loadFeeds({});
  const sp = feeds.extractArticleText(POLIGON_ARTICLE);
  assert.match(sp, /^Sarıyer Poligon Mahallesi’nde/);
  assert.doesNotMatch(sp, /Menü bağlantıları/);
  assert.match(feeds.extractArticleText(GG_ARTICLE), /konut satışları/);
  assert.equal(feeds.extractArticleText(`<meta property="og:description" content="Yeterince uzun bir özet metni burada yer alıyor ve okunuyor." />`), "Yeterince uzun bir özet metni burada yer alıyor ve okunuyor.");
  assert.equal(feeds.extractArticleText("<html></html>"), undefined);
});

test("coverage: only what the feed spans (articles only), reported as incomplete against a 30-day window; a failing feed is an access error", async () => {
  const feeds = loadFeeds({ "https://www.gayrimenkulgundemi.com/feed": GG_FEED });
  const { items, reports } = await feeds.fetchOwnerFeeds(profile, WINDOW);
  assert.equal(items.length, 3);
  assert.equal(reports["gayrimenkul-gundemi"].status, "ok");
  assert.equal(reports["gayrimenkul-gundemi"].coverage.since, "2026-11-16T12:22:00.000Z");
  assert.equal(reports["gayrimenkul-gundemi"].coverage.complete, false);
  assert.equal(reports["sariyer-posta"].status, "error");

  const sp = loadFeeds({ "https://sariyerposta.com/rss": SP_FEED });
  const spReports = (await sp.fetchOwnerFeeds(profile, WINDOW)).reports;
  assert.equal(spReports["sariyer-posta"].coverage.since, "2026-11-09T16:29:00.000Z", "the 2019/2026-01 gallery/video entries do not stretch coverage");
});

test("collectOwnerFeedOpportunities: title screen first (only plausible owner items cost an article fetch), article text as evidence, description fallback", async () => {
  const requested = [];
  const feeds = loadFeeds(
    {
      "https://www.gayrimenkulgundemi.com/feed": GG_FEED,
      "https://sariyerposta.com/rss": SP_FEED,
      "https://www.sariyerposta.com/poligonda-40-ailenin-donusum-cagrisi": POLIGON_ARTICLE,
      "https://www.gayrimenkulgundemi.com/konut-piyasasinda-bekleme-donemi/": GG_ARTICLE,
      // miras article unreachable → RSS description as evidence
    },
    requested,
  );
  const { opportunities } = await feeds.collectOwnerFeedOpportunities(profile, WINDOW, NOW);
  assert.deepEqual([...opportunities.map((o) => o.topic)].sort(), [
    "Konut Piyasasında Bekleme Dönemi: Satışlar Düştü, Reel Fiyat Kaybı Hızlandı",
    "Miras Kalan Ev Satılırsa Vergi Çıkar mı?",
    "Poligon’da 40 ailenin dönüşüm çağrısı!",
  ].sort());
  const articleFetches = requested.filter((u) => !u.endsWith("/feed") && !u.endsWith("/rss"));
  assert.equal(articleFetches.length, 3, "no article fetch for the buyer-only, dolphin or old items");
  const poligon = opportunities.find((o) => o.topic.startsWith("Poligon"));
  assert.match(poligon.sources[0].evidenceText, /^Sarıyer Poligon Mahallesi’nde/);
  const miras = opportunities.find((o) => o.topic.startsWith("Miras"));
  assert.match(miras.sources[0].evidenceText, /değer artış kazancı/, "RSS description used when the article cannot be read");

  // Feeding the selector: the district-level item ranks first; its raw
  // headline is kept in the source block, the card shows the owner proposal.
  const proposals = ownerProposals.buildOwnerProposals(profile, opportunities, [], NOW).filter((p) => p.kind === "current");
  assert.equal(proposals[0].source.title, "Poligon’da 40 ailenin dönüşüm çağrısı!");
  assert.equal(proposals[0].title, "Kentsel dönüşüm sürecinde mülk sahipleri neleri takip etmeli?");
});
