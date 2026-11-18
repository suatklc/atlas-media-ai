import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// Owner proposals (content/ownerProposals.ts) + the contact line
// (content/contactLine.ts). Atlas goal: owners who want to sell reach the
// advisor — "Güncel Konuları Bul" proposes one topic per owner theme, never
// fills the list with other cities' decisions or institutional promotion,
// never presents an evergreen topic as news, and invents no address.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const { ATLAS_DEFAULT_BUSINESS_PROFILE: profile } = loadTypeScriptModule("src/lib/ai/context/businessProfile.ts");
const places = loadTypeScriptModule("src/lib/ai/research/turkishPlaces.ts");
const { buildOwnerProposals, isInstitutionalPromo } = loadTypeScriptModule("src/lib/ai/content/ownerProposals.ts", (specifier) =>
  specifier === "../research/turkishPlaces" ? places : {},
);
const { buildContactLine } = loadTypeScriptModule("src/lib/ai/content/contactLine.ts");

const opportunity = (topic, geoKind = "general", place, url = `https://www.resmigazete.gov.tr/x/${encodeURIComponent(topic)}`) => ({
  topic,
  angle: `Mülk sahipleri açısından: ${topic}`,
  whyNow: "w",
  keyFacts: [topic],
  sources: [{ title: topic, publisher: "T.C. Resmî Gazete", url, publishedAt: "2026-10-19T21:00:00.000Z", tier: "official-authority" }],
  freshness: "recent",
  topicFamily: "regulation-property",
  geoScope: geoKind === "elsewhere" ? { kind: "elsewhere", place } : { kind: geoKind },
});

// Live 2026-11-17 Radar shortlist (real titles).
const LIVE = [
  opportunity("BAKAN KURUM, COP31'DE ASRIN İNŞA SEFERBERLİĞİNİ VE TÜRKİYE'NİN SOSYAL KONUT BAŞARISINI DÜNYAYA ANLATTI"),
  opportunity("RUSYA BASININDAN ASRIN İNŞA SEFERBERLİĞİNE ÖVGÜ “15. GÜNDE İLK KALICI KONUTLARIN TEMELLERİ ATILDI”"),
  opportunity("22 Şubat 2024 Tarihli ve 8189 Sayılı Cumhurbaşkanı Kararı ile Yürürlüğe Konulan İstanbul İlinde Yürütülecek Kentsel Dönüşüm Uygulamaları Kapsamında Yapım İçin Yardım Verilmesine İlişkin Kararın 3 üncü Maddesinin On Üçüncü Fıkrasında Yer Alan Sürenin 31/12/2027 Tarihine Kadar Uzatılması Hakkında Karar (Karar Sayısı: 11902)"),
  opportunity("Duyuru Değişikliği"),
  opportunity("Konya İli, Halkapınar İlçesine Doğal Gaz Arzının Sağlanabilmesi Amacıyla Kurulacak Dağıtım Hattı", "elsewhere", "Konya"),
  opportunity("Van İli, İpekyolu İlçesi, Eskişehir Mahallesi Sınırları İçerisinde Belirlenen Rezerv Yapı Alanı", "elsewhere", "Van"),
  opportunity("BAKAN KURUM, PENDİK’TE KENTSEL DÖNÜŞÜM KURA TÖRENİNDE KONUŞTU", "elsewhere", "Pendik"),
];

test("profile: 5 owner themes, every evergreen fallback idea exists, references are https official pages, contact is the existing channel set", () => {
  const themes = profile.contentStrategy.ownerThemes;
  assert.deepEqual([...themes.map((t) => t.id)], ["pricing", "sale-delay", "sale-prep", "villa-land", "regional"]);
  const ideaIds = new Set(profile.contentStrategy.ideas.map((idea) => idea.id));
  for (const theme of themes) {
    assert.ok(theme.ideaIds.some((id) => ideaIds.has(id)), `${theme.id} needs an existing evergreen idea`);
    // No invented outcome claims in the fixed benefit text.
    assert.doesNotMatch(theme.benefit, /garanti|kesin|hızlı sat|%|\d/i);
  }
  // Every idea reference is an https official page (verified live when added).
  const referenced = profile.contentStrategy.ideas.filter((idea) => idea.reference);
  assert.ok(referenced.length >= 2);
  for (const idea of referenced) {
    assert.match(idea.reference.url, /^https:\/\/(spk\.gov\.tr|www\.tkgm\.gov\.tr)\//, idea.id);
  }
  assert.equal(profile.brand.name, "Suat Kılıç");
  assert.equal(profile.contact.whatsappUrl, "https://wa.me/905425087828");
  assert.equal(profile.contact.leadFormUrl, "https://talep.suatkilic.net");
});

const NOW = new Date("2026-11-18T10:00:00.000Z");
const feedItem = (topic, publishedAt, publisher = "Gayrimenkul Gündemi", evidenceText = "", url) => ({
  topic,
  angle: `Mülk sahipleri açısından: ${topic}`,
  whyNow: "w",
  keyFacts: [topic],
  sources: [{ title: topic, publisher, url: url ?? `https://www.example-news.com/${encodeURIComponent(topic)}`, publishedAt, tier: "commentary", evidenceText }],
  freshness: "recent",
  topicFamily: "market-data",
});

// Real titles from 2026-11-16..18 (Gayrimenkul Gündemi + Sarıyer Posta RSS).
const FEEDS = [
  feedItem("Konut Piyasasında Bekleme Dönemi: Satışlar Düştü, Reel Fiyat Kaybı Hızlandı", "2026-11-18T04:25:00.000Z"),
  feedItem("Konut Fiyat Endeksi Ekim Ayında Yüzde 0,7 Arttı", "2026-11-17T12:19:00.000Z"),
  feedItem("Miras Kalan Ev Satılırsa Vergi Çıkar mı?", "2026-11-16T23:29:00.000Z"),
  feedItem("Kredi Faizleri Düşmeden Harekete Geçen Nakit Alıcılar Kazanacak", "2026-11-18T00:55:00.000Z"),
  feedItem("Şaşkına Çeviren Emlak Satışı: 68 Metrekarelik Daire Yaklaşık 85 TL’ye Alıcı Buldu", "2026-11-17T06:17:00.000Z"),
  feedItem("Köye Dönüş Hayali Kuranlara Arsa Desteği: 2 Bin Metrekareye Kadar Arsa Satışında Şartlar Neler?", "2026-11-16T12:22:00.000Z"),
  feedItem("Kiralık Konut Piyasasında Rüzgar Tersine Döndü: Kiracısını Tutan Kazançlı Çıktı", "2026-11-18T06:19:00.000Z"),
  feedItem("Poligon’da 40 ailenin dönüşüm çağrısı!", "2026-11-16T18:25:00.000Z", "Sarıyer Posta", "Sarıyer Poligon Mahallesi’nde evleri yaklaşık 1,5 yıl önce yıkılan 40’a yakın aile, kentsel dönüşüm projesinin başlamasını bekliyor."),
  feedItem("Sarıyerli judocular Sofya’dan 8 madalyayla döndü", "2026-11-16T13:33:00.000Z", "Sarıyer Posta"),
];

test("selection (live titles): benefit, own area and recency decide — an official source alone gives no priority", () => {
  const proposals = buildOwnerProposals(profile, [...LIVE, ...FEEDS], [], NOW);
  const news = proposals.filter((p) => p.kind === "current");
  assert.deepEqual([...news.map((p) => p.themeId)], ["regional", "sale-delay", "pricing", "sale-prep"]);
  const regional = news[0];
  // The card title is an owner-facing proposal; the raw headline stays in the source block.
  assert.equal(regional.title, "Kentsel dönüşüm sürecinde mülk sahipleri neleri takip etmeli?");
  assert.equal(regional.source.title, "Poligon’da 40 ailenin dönüşüm çağrısı!");
  assert.equal(regional.source.publishedAt, "2026-11-16T18:25:00.000Z");
  assert.match(regional.source.url, /^https:\/\//);
  // Poligon is another Sarıyer neighbourhood: district context, not the seller's own area.
  assert.equal(regional.score.locality, 1, "district (Sarıyer) only — not a neighbourhood match");
  assert.equal(regional.scopeNote, "Kapsam: Sarıyer · Poligon Mahallesi — Zekeriyaköy için doğrudan değil, ilçe geneli bağlam");
  assert.ok(!news.some((p) => (p.source.title ?? "").includes("8189")), "the official decision (29 days old, province-wide) scored lower — no official bonus");
  for (const proposal of news) {
    assert.doesNotMatch(proposal.source.title, /Konya|Van İli|PENDİK|BAKAN|ÖVGÜ|Nakit Alıcılar|Şaşkına|Köye Dönüş|Kiralık|judocular|Duyuru Değişikliği/);
    assert.notEqual(proposal.title, proposal.source.title, "never the raw headline as the card title");
    assert.doesNotMatch(proposal.title, /\d/, "no figure in the proposal headline");
  }
  // National data is labelled national, never presented as Sarıyer or one property's price.
  const pricing = news.find((p) => p.themeId === "pricing");
  assert.equal(pricing.title, "Ulusal fiyat verisi mülkünüzün değeri hakkında ne söyler, ne söylemez?");
  assert.equal(pricing.scopeNote, "Kapsam: Türkiye geneli veri — bölgenize veya tek bir mülkün fiyatına doğrudan uygulanmaz");
  assert.equal(news.find((p) => p.themeId === "sale-prep").title, "Miras kalan evi satmadan önce netleştirilmesi gereken sorular");
  // Themes without a useful news item get evergreen ideas — separate, never news.
  const evergreen = proposals.filter((p) => p.kind === "evergreen");
  assert.deepEqual([...evergreen.map((p) => p.themeId)], ["villa-land"]);
  assert.equal(evergreen[0].opportunity, undefined);
});

test("old (>30 days) or undated news is dropped — never relabelled as an evergreen topic", () => {
  const old = feedItem("Konut satışları eylülde geriledi", "2026-09-30T08:00:00.000Z");
  const undated = feedItem("Konut fiyat endeksi açıklandı", "");
  const proposals = buildOwnerProposals(profile, [old, undated], [], NOW);
  assert.equal(proposals.filter((p) => p.kind === "current").length, 0);
  assert.ok(!proposals.some((p) => p.title === old.topic || p.title === undated.topic), "not shown anywhere, not as evergreen either");
});

test("few useful items: the news list is not padded; evergreen ideas stay a separate group", () => {
  const proposals = buildOwnerProposals(profile, [FEEDS[0], FEEDS[3], FEEDS[4], FEEDS[8]], [], NOW);
  const news = proposals.filter((p) => p.kind === "current");
  assert.equal(news.length, 1, "only the sales-slowdown item is useful to an owner");
  assert.equal(proposals.filter((p) => p.kind === "evergreen").length, 4, "the other four themes as evergreen topics, not weaker news");
});

test("a national story is not dropped because its body lists other cities; a title local to elsewhere is", () => {
  const national = feedItem("Konut satışları ekimde geriledi", "2026-11-17T09:00:00.000Z", "Gayrimenkul Gündemi", "Satışlarda İstanbul'u Ankara ve İzmir izledi.");
  const elsewhere = feedItem("Ankara'da konut satışları geriledi", "2026-11-17T09:00:00.000Z");
  const news = buildOwnerProposals(profile, [national, elsewhere], [], NOW).filter((p) => p.kind === "current");
  assert.deepEqual([...news.map((p) => p.source.title)], [national.topic]);
  assert.equal(news[0].score.locality, 0, "cities listed in the body do not make it local");
  assert.match(news[0].scopeNote, /Türkiye geneli/);
});

test("locality: own neighbourhood +3, district only +1, province (title) and national 0", () => {
  const item = (title, body) => feedItem(title, "2026-11-17T09:00:00.000Z", "Sarıyer Posta", body);
  const score = (title, body = "") => buildOwnerProposals(profile, [item(title, body)], [], NOW).find((p) => p.kind === "current");
  const own = score("Zekeriyaköy'de imar planı değişikliği askıya çıktı");
  assert.equal(own.score.locality, 3);
  assert.equal(own.scopeNote, "Kapsam: Zekeriyaköy");
  assert.equal(score("Sarıyer'de imar planı değişikliği askıya çıktı").score.locality, 1);
  const istanbul = score("İstanbul'da konut satışları geriledi");
  assert.equal(istanbul.score.locality, 0);
  assert.equal(istanbul.scopeNote, "Kapsam: İstanbul geneli — tek bir mahalleye veya mülke doğrudan uygulanmaz");
});

test("routing: a non-official news item drives the expert flow with the news as context only; an official one keeps the grounded news flow", () => {
  const proposals = buildOwnerProposals(profile, [...LIVE, ...FEEDS], [], NOW).filter((p) => p.kind === "current");
  for (const proposal of proposals) {
    assert.equal(proposal.sourceRole, "context");
    assert.equal(proposal.opportunity, undefined, "commentary-tier news never reaches the fact-grounded flow");
    assert.equal(proposal.format, "Carousel");
    assert.ok(proposal.instruction.length <= 700);
    assert.ok(proposal.instruction.includes(proposal.title));
    assert.match(proposal.instruction, /rakamları, oranları, tarihleri ve vergi\/hukuk hükümlerini aktarma/);
    assert.match(proposal.instruction, /tek bir mülkün fiyatına uyarlanmış bir sonuç gibi sunma/);
  }
  const official = { ...opportunity("Kentsel Dönüşüm Uygulamalarında Hak Sahiplerine Yeni Düzenleme"), sources: [{ ...LIVE[2].sources[0], url: "https://www.resmigazete.gov.tr/x/hak", publishedAt: "2026-11-17T00:00:00.000Z" }] };
  const [fact] = buildOwnerProposals(profile, [official], [], NOW).filter((p) => p.kind === "current");
  assert.equal(fact.sourceRole, "fact");
  assert.ok(fact.opportunity, "official source → existing grounded news flow");
  assert.equal(fact.instruction, undefined);
});

test("the same URL arriving twice (Radar + feed) is scored once", () => {
  const a = feedItem("Konut satışları ekimde geriledi", "2026-11-17T09:00:00.000Z", "A", "", "https://same.example/x");
  const b = { ...a, topic: "Konut satışları ekimde geriledi (kopya)" };
  const news = buildOwnerProposals(profile, [a, b], [], NOW).filter((p) => p.kind === "current");
  assert.equal(news.length, 1);
});

test("buildOwnerProposals: an evergreen proposal is labelled evergreen, carries the expert instruction and only a verified reference (or none) — never a news date", () => {
  const proposals = buildOwnerProposals(profile, []);
  assert.equal(proposals.length, 5, "with no current item every theme falls back to an existing idea");
  for (const proposal of proposals) {
    assert.equal(proposal.kind, "evergreen");
    assert.equal(proposal.format, "Carousel");
    assert.ok(proposal.instruction && proposal.instruction.length > 30);
    assert.equal(proposal.opportunity, undefined);
    if (proposal.source) assert.equal(proposal.source.publishedAt, undefined, "a reference page is not dated news");
  }
  const pricing = proposals.find((p) => p.themeId === "pricing");
  assert.match(pricing.source.url, /^https:\/\/spk\.gov\.tr\//);
  const prep = proposals.find((p) => p.themeId === "sale-prep");
  assert.equal(prep.title, "Satıştan önce hazırlanacak belgeler", "the reference belongs to the idea it describes");
  assert.equal(prep.source.url, "https://www.tkgm.gov.tr/sss");
  const villa = proposals.find((p) => p.themeId === "villa-land");
  assert.equal(villa.source, undefined, "no verified reference → shown as expert view, no invented address");
  assert.equal(new Set(proposals.map((p) => p.title)).size, 5, "no idea used twice");
});

test("isInstitutionalPromo: minister/ceremony/summit/praise stories are promotion; regulatory titles are not", () => {
  assert.equal(isInstitutionalPromo("BAKAN KURUM: 500 BİN SOSYAL KONUTUN YAKLAŞIK 80 BİNİ BİTME AŞAMASINA GELDİ"), true);
  assert.equal(isInstitutionalPromo("MALTEPE’DE VATANDAŞLAR SAĞLAM KONUTLARINA KAVUŞUYOR TÖRENİ"), true);
  assert.equal(isInstitutionalPromo("Satış İşlemlerinde Zorunlu Deprem Sigortası Hakkında Duyuru"), false);
  assert.equal(isInstitutionalPromo(LIVE[2].topic), false);
});

test("buildContactLine: only the profile's existing channels, readable, no promise; absent without channels", () => {
  assert.equal(
    buildContactLine(profile.contact),
    "İletişim — WhatsApp: wa.me/905425087828 · Talep formu: talep.suatkilic.net",
  );
  assert.equal(buildContactLine({ leadFormUrl: "https://talep.suatkilic.net/" }), "İletişim — Talep formu: talep.suatkilic.net");
  assert.equal(buildContactLine(undefined), null);
  assert.equal(buildContactLine({}), null);
});

test("dashboard: proposals are picked into the existing flows — picking never calls generation, evergreen and current are shown apart", () => {
  const ui = fs.readFileSync(path.join(projectRoot, "src/components/dashboard/CurrentOpportunities.tsx"), "utf8");
  const pick = ui.slice(ui.indexOf("function handlePickProposal"), ui.indexOf("function handleSelect("));
  assert.ok(pick.length > 0);
  assert.doesNotMatch(pick, /handleGenerate|fetch\(/, "a pick only prepares the flow");
  assert.match(ui, /Zamansız uzmanlık konuları/);
  assert.match(ui, /Güncel gelişmelere dayalı öneriler/);
  assert.match(ui, /Kaynak: uzman değerlendirmesi \(dış kaynak yok\)/);
});
