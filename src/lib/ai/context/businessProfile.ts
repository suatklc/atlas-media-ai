// Phase 1 (Research -> Content Opportunity): a generic, industry-neutral
// business/tenant context layer. This is the ONLY place any geography- or
// industry-specific term (Zekeriyaköy, Sarıyer, "real estate") may live —
// content/*, creative/*, image/*, and publishing/* must never reference
// these names directly. A future non-real-estate tenant, or a second
// region, is just another BusinessProfile value, not a code change
// anywhere else.

export type BusinessProfileGeography = {
  primary: string;
  nearby: string[];
};

// One evergreen content idea: an expert-mode instruction for
// /api/content-package (topic + one audience, no facts or numbers — the
// expert writer forbids them anyway). `signature` holds word-start stems /
// phrases that identify the idea in a recent draft's own package text, so
// the weekly plan can skip ideas used recently.
export type ContentIdea = {
  id: string;
  pillar: string;
  format: string;
  title: string;
  reason: string;
  instruction: string;
  signature: string[];
};

// Weekly plan shape: each slot rotates through its pillars week by week;
// allowCurrent lets a qualifying current (Radar) topic take that slot.
export type ContentStrategy = {
  pillarLabels: Record<string, string>;
  currentLabel: string;
  weeklySlots: { pillars: string[]; allowCurrent?: boolean }[];
  ideas: ContentIdea[];
};

export type BusinessProfile = {
  industry: string;
  geography: BusinessProfileGeography;
  expertiseTopics: string[];
  excludedTopics: string[];
  contentStrategy?: ContentStrategy;
};

// Atlas's first tenant/use-case configuration — not a permanent global
// identity. Not yet consumed by any route/classifier in this phase
// (deliberately: wiring it into topic discovery/ranking is later work);
// exists now as the structural seam that work will read from.
export const ATLAS_DEFAULT_BUSINESS_PROFILE: BusinessProfile = {
  industry: "real-estate",
  geography: {
    primary: "Zekeriyaköy",
    nearby: ["Uskumruköy", "Demirciköy", "Gümüşdere", "Kilyos", "Bahçeköy", "Maden", "Sarıyer"],
  },
  expertiseTopics: [
    "villa",
    "arsa / arazi yatırımı",
    "gayrimenkul yatırımı",
    "mülk satın alma kararları",
    "imar / planlama",
    "tapu ve mülk belgeleri",
    "bölgesel piyasa bilgisi",
  ],
  excludedTopics: [],
  contentStrategy: {
    pillarLabels: {
      regional: "Bölgesel",
      "land-zoning": "Arsa/İmar",
      "villa-home": "Villa/Konut",
      investment: "Yatırım",
      "buyer-seller": "Alıcı/Satıcı",
      evergreen: "Evergreen",
    },
    currentLabel: "Güncel/Trend",
    // 1 regional, 2 land/zoning, 3 buyer-seller or investment, 4 a
    // qualifying current topic, else villa/home or evergreen.
    weeklySlots: [
      { pillars: ["regional"] },
      { pillars: ["land-zoning"] },
      { pillars: ["buyer-seller", "investment"] },
      { pillars: ["evergreen", "villa-home"], allowCurrent: true },
    ],
    ideas: [
      // ===== Bölgesel =====
      {
        id: "regional-micro-location",
        pillar: "regional",
        format: "rehber",
        title: "Zekeriyaköy'de mikro konum farkı",
        reason: "Bölge uzmanlığını gösterir; Zekeriyaköy'de mülk arayan alıcıya ulaşır.",
        instruction:
          "Zekeriyaköy'de villa ya da arsa bakan alıcılara, aynı bölge içinde mikro konumun (sokak, yola erişim, çevre dokusu, manzara ve mahremiyet) bir mülkü nasıl farklılaştırdığını anlatan bir paylaşım hazırla. Bölge hakkında doğrulanamayan bilgi verme.",
        signature: ["mikro konum", "zekeriyaköy"],
      },
      {
        id: "regional-north-villages",
        pillar: "regional",
        format: "karşılaştırma",
        title: "Kuzey Sarıyer köyleri arasında seçim",
        reason: "Bölgeyi tanıyan danışman olarak güven oluşturur; bölge seçimi yapan alıcıya ulaşır.",
        instruction:
          "Sarıyer'in kuzeyinde Zekeriyaköy, Uskumruköy, Demirciköy ve Kilyos arasında karar vermeye çalışan alıcılara, bu bölgeleri karşılaştırırken hangi soruları sormaları gerektiğini (yaşam tarzı, ulaşım, yapı dokusu, arsa yapısı) anlatan bir paylaşım hazırla. Bölgeler hakkında doğrulanamayan bilgi verme.",
        signature: ["uskumruköy", "demirciköy", "kilyos"],
      },
      {
        id: "regional-forest-edge",
        pillar: "regional",
        format: "kontrol listesi",
        title: "Bahçeköy ve Maden'de yeşil dokuya yakın mülk",
        reason: "Bölgeye özgü bir riski açıklar; kaydedilebilir bir kontrol listesi verir.",
        instruction:
          "Bahçeköy ve Maden çevresinde mülk bakan alıcılara, orman ve yeşil alan dokusuna yakın bir mülkü değerlendirirken tapu kaydını, imar durumunu ve yapılaşma koşullarını resmi belgelerden kontrol etmenin neden önemli olduğunu anlatan bir paylaşım hazırla. Mevzuat ayrıntısı verme.",
        signature: ["bahçeköy", "maden"],
      },
      {
        id: "regional-seaside-use",
        pillar: "regional",
        format: "soru-cevap",
        title: "Gümüşdere ve Kilyos'ta sezonluk mu, yıl boyu mu?",
        reason: "Bölgedeki gerçek bir alıcı sorusunu yanıtlar; takip edilme nedeni yaratır.",
        instruction:
          "Gümüşdere ve Kilyos'ta denize yakın bir mülk düşünen alıcılara, mülkü sezonluk kullanmak ile yıl boyu yaşamak arasındaki farkın mülk seçimini nasıl değiştirdiğini anlatan bir paylaşım hazırla.",
        signature: ["gümüşdere", "kilyos", "sezon"],
      },
      {
        id: "regional-seller-local-advisor",
        pillar: "regional",
        format: "danışman görüşü",
        title: "Zekeriyaköy'de satarken bölgeyi bilen danışman",
        reason: "Mülk sahibine ulaşır; Suat'ın bölgesel uzmanlığını güçlendirir.",
        instruction:
          "Zekeriyaköy'de mülkünü satmayı düşünen mülk sahiplerine, bölgeyi bilen bir danışmanın fiyatlandırma ve hedef alıcı profili konusunda neyi farklı değerlendirdiğini anlatan bir paylaşım hazırla.",
        signature: ["zekeriyaköy", "alıcı profil"],
      },
      {
        id: "regional-land-parcels",
        pillar: "regional",
        format: "kısa rehber",
        title: "Uskumruköy ve Demirciköy'de parsel değerlendirme",
        reason: "Arsa/yatırım müşterisine ulaşır; bölgesel arsa uzmanlığını gösterir.",
        instruction:
          "Uskumruköy ve Demirciköy'de arsa bakan yatırımcılara, bir parseli değerlendirirken yola cephe, eğim ve altyapıya erişimin neden ilk bakılması gereken konular olduğunu anlatan bir paylaşım hazırla.",
        signature: ["uskumruköy", "demirciköy", "parsel"],
      },
      {
        id: "regional-moving-north",
        pillar: "regional",
        format: "karar rehberi",
        title: "Şehirden Zekeriyaköy'e taşınmak",
        reason: "Taşınmayı düşünen aileye ulaşır; paylaşılabilir bir karar rehberi verir.",
        instruction:
          "Şehir merkezinden Sarıyer'in kuzeyine, Zekeriyaköy çevresine taşınmayı düşünen ailelere, bu kararı verirken günlük yaşamda (ulaşım, okul, sosyal hayat, ev bakımı) neleri önceden düşünmeleri gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["taşınmay", "zekeriyaköy"],
      },
      // ===== Arsa / İmar / Yapılaşma =====
      {
        id: "land-taks-kaks",
        pillar: "land-zoning",
        format: "kavram açıklama",
        title: "TAKS ve KAKS (emsal) sade dille",
        reason: "Kaydedilebilir eğitici bilgi; arsa alıcısına uzmanlık gösterir.",
        instruction:
          "Arsa almayı düşünen alıcılara TAKS ve KAKS (emsal) kavramlarını sade bir dille açıklayan; bir arsada ne kadar yapı yapılabileceğinin bu kavramlara ve plan notlarına bağlı olduğunu, kesin bilginin belediyeden alınan imar durumu belgesinde yer aldığını anlatan bir paylaşım hazırla. Oran veya sayı verme.",
        signature: ["taks", "kaks"],
      },
      {
        id: "land-zoning-certificate",
        pillar: "land-zoning",
        format: "kontrol listesi",
        title: "İmar durumu belgesinde nelere bakılır?",
        reason: "Arsa alıcısına kaydedilebilir bir kontrol listesi verir; güven oluşturur.",
        instruction:
          "Arsa almaya hazırlanan alıcılara, imar durumu belgesini nasıl okuyacaklarını ve satın almadan önce bu belgede hangi bilgilere bakmaları gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["imar durumu", "belge"],
      },
      {
        id: "land-shared-title",
        pillar: "land-zoning",
        format: "risk analizi",
        title: "Hisseli tapu ile müstakil tapu farkı",
        reason: "Alıcıyı yaygın bir riskten korur; paylaşılabilir bilgi verir.",
        instruction:
          "Hisseli tapulu bir arsa ya da tarla almayı düşünen alıcılara, hisseli mülkiyet ile müstakil tapu arasındaki farkı ve hisseli alımda dikkat edilmesi gereken riskleri anlatan bir paylaşım hazırla.",
        signature: ["hisseli", "müstakil tapu"],
      },
      {
        id: "land-setbacks",
        pillar: "land-zoning",
        format: "hesap mantığı",
        title: "Çekme mesafeleri kullanılabilir alanı nasıl değiştirir?",
        reason: "Arsa sahibine teknik uzmanlık gösterir; ev yaptırmayı planlayana ulaşır.",
        instruction:
          "Arsasına ev yaptırmayı planlayan arsa sahiplerine, çekme mesafelerinin ve plan notlarının arsanın gerçekten kullanılabilir alanını nasıl değiştirdiğini anlatan bir paylaşım hazırla. Ölçü veya sayı verme.",
        signature: ["çekme mesafe", "plan not"],
      },
      {
        id: "land-title-quality",
        pillar: "land-zoning",
        format: "soru-cevap",
        title: "Tapudaki nitelik ne anlama gelir?",
        reason: "Arazi alıcısının temel bir sorusunu yanıtlar; eğitici değer taşır.",
        instruction:
          "Arsa veya arazi bakan alıcılara, tapudaki niteliğin (arsa, tarla, bağ, bahçe gibi) ne anlama geldiğini ve bu niteliğin yapılaşma beklentisini nasıl etkilediğini anlatan bir paylaşım hazırla.",
        signature: ["nitelik", "tarla"],
      },
      {
        id: "land-buildable-area",
        pillar: "land-zoning",
        format: "kavram açıklama",
        title: "Arsa büyüklüğü ile inşaat alanı aynı şey değil",
        reason: "Villa yaptıracak alıcıya teknik uzmanlık gösterir.",
        instruction:
          "Villa yaptırmak için arsa alacak alıcılara, arsanın büyüklüğü ile üzerine yapılabilecek inşaat alanının neden aynı şey olmadığını; emsal, TAKS ve plan notlarının bu hesaba nasıl girdiğini rakam vermeden anlatan bir paylaşım hazırla.",
        signature: ["inşaat alan", "arsa büyüklüğ"],
      },
      {
        id: "land-frontage-infrastructure",
        pillar: "land-zoning",
        format: "kontrol listesi",
        title: "Yola cephe, altyapı ve topografya",
        reason: "Arsa yatırımcısına ulaşır; kaydedilebilir değerlendirme kriterleri verir.",
        instruction:
          "Arsa yatırımı düşünen yatırımcılara, bir arazinin yola cephesinin, altyapıya erişiminin ve topografyasının değerlendirmede neden belirleyici olduğunu anlatan bir paylaşım hazırla.",
        signature: ["yola cephe", "topografya"],
      },
      // ===== Alıcı / Satıcı =====
      {
        id: "seller-initial-price",
        pillar: "buyer-seller",
        format: "hata",
        title: "Satışta ilk fiyatı yüksek belirlemek",
        reason: "Mülk sahibine ulaşır; satış danışmanlığı uzmanlığını gösterir.",
        instruction:
          "Mülkünü satışa çıkarmak isteyen ev sahiplerine, ilk fiyatı piyasanın üzerinde belirlemenin satış sürecini nasıl etkileyebileceğini ve doğru fiyatlandırmanın nasıl yapılması gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["ilk fiyat", "fiyatlandır"],
      },
      {
        id: "seller-interest-no-offer",
        pillar: "buyer-seller",
        format: "teşhis",
        title: "İlgi var ama teklif yok",
        reason: "Satamayan mülk sahibinin gerçek sorununu teşhis eder; danışmanlık talebi yaratır.",
        instruction:
          "Villasını satışa çıkarmış, ilgi görmesine rağmen teklif alamayan mülk sahiplerine, bu durumun olası nedenlerini (fiyat, sunum, hedef alıcı) ve satış stratejisinde neyin değişmesi gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["teklif alama", "ilgi gör"],
      },
      {
        id: "buyer-first-viewing",
        pillar: "buyer-seller",
        format: "kontrol listesi",
        title: "İlk gezmede gözden kaçmaması gerekenler",
        reason: "Alıcıya kaydedilebilir bir kontrol listesi verir.",
        instruction:
          "Villa ya da müstakil ev bakan alıcılara, ilk gezmede gözden kaçırılmaması gereken noktaları (yapının fiziksel durumu, bahçe ve arsa ilişkisi, mahremiyet, gerçekten kullanılabilir alan) anlatan bir paylaşım hazırla.",
        signature: ["gezme", "fiziksel durum"],
      },
      {
        id: "buyer-documents",
        pillar: "buyer-seller",
        format: "hata",
        title: "Belgeleri kontrol etmeden karar vermek",
        reason: "Alıcıyı riskten korur; güven oluşturur.",
        instruction:
          "Ev almaya hazırlanan alıcılara, tapu kaydı, iskân durumu ve imar uygunluğu gibi belgeleri satın alma kararından önce kontrol etmemenin hangi sorunlara yol açabileceğini anlatan bir paylaşım hazırla.",
        signature: ["iskân", "tapu kayd"],
      },
      {
        id: "seller-presentation",
        pillar: "buyer-seller",
        format: "danışman görüşü",
        title: "Fotoğraf, ilan metni ve gösterim",
        reason: "Mülk sahibine ulaşır; satış sürecindeki profesyonel farkı gösterir.",
        instruction:
          "Mülkünü satmak isteyen sahiplere, fotoğraf, ilan metni ve gösterim düzeninin alıcının mülke bakışını nasıl etkilediğini anlatan bir paylaşım hazırla.",
        signature: ["ilan metn", "gösterim"],
      },
      {
        id: "buyer-negotiation",
        pillar: "buyer-seller",
        format: "soru-cevap",
        title: "Teklif vermeden önce sorulacak sorular",
        reason: "Karar aşamasındaki alıcıya ulaşır; danışmanlık ihtiyacını gösterir.",
        instruction:
          "Villa satın almak üzere pazarlık aşamasına gelmiş alıcılara, teklif vermeden önce mülkün gerçek değerini nasıl değerlendirmeleri ve hangi soruları sormaları gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["pazarlık", "teklif ver"],
      },
      // ===== Yatırım =====
      {
        id: "invest-land-vs-villa",
        pillar: "investment",
        format: "karşılaştırma",
        title: "Arsa mı, hazır villa mı?",
        reason: "Yatırımcının temel sorusunu yanıtlar; paylaşılabilir karar kriterleri verir.",
        instruction:
          "Gayrimenkule yatırım yapmayı düşünen yatırımcılara, arsa yatırımı ile hazır villa yatırımını likidite, bakım, süre ve risk açısından karşılaştıran; rakam vermeden karar kriterlerini anlatan bir paylaşım hazırla.",
        signature: ["arsa yatırım", "villa yatırım"],
      },
      {
        id: "invest-exit-scenario",
        pillar: "investment",
        format: "risk analizi",
        title: "Arsa alırken çıkış senaryosu",
        reason: "Uzun vadeli yatırımcıya ulaşır; profesyonel bakışı gösterir.",
        instruction:
          "Arsa ya da arazi alarak uzun vadeli yatırım yapmak isteyen yatırımcılara, alım yapmadan önce çıkış senaryosunu (ne zaman, kime, hangi koşulda satılabileceğini) düşünmenin neden önemli olduğunu anlatan bir paylaşım hazırla.",
        signature: ["çıkış senaryo"],
      },
      {
        id: "invest-hidden-costs",
        pillar: "investment",
        format: "kontrol listesi",
        title: "Alım fiyatının dışındaki maliyetler",
        reason: "İlk kez yatırım yapana kaydedilebilir bir liste verir.",
        instruction:
          "İlk kez gayrimenkul yatırımı yapacak yatırımcılara, alım fiyatının dışında hesaba katılması gereken maliyet kalemlerini (vergi ve harçlar, bakım, tadilat, boş kalma süresi) rakam ve oran vermeden anlatan bir paylaşım hazırla.",
        signature: ["maliyet kalem", "harç"],
      },
      {
        id: "invest-rent-vs-appreciation",
        pillar: "investment",
        format: "karşılaştırma",
        title: "Kira geliri mi, değer artışı mı?",
        reason: "Yatırımcıya kendi hedefini netleştirme imkânı verir.",
        instruction:
          "Konut ya da villa yatırımı düşünen yatırımcılara, kira geliri odaklı yatırım ile değer artışı odaklı yatırım arasındaki farkı ve hangisinin kime uygun olduğunu rakam vermeden anlatan bir paylaşım hazırla.",
        signature: ["kira gelir", "değer artış"],
      },
      {
        id: "invest-rumour-risk",
        pillar: "investment",
        format: "uyarı",
        title: "\"Değerlenecek\" denilen arsalar",
        reason: "Yatırımcıyı riskten korur; güvenilir danışman algısı oluşturur.",
        instruction:
          "Bir bölgede değerleneceği söylenen arsalara yatırım yapmayı düşünen yatırımcılara, söylentiye değil resmi plan ve belgelere dayanmanın neden önemli olduğunu anlatan bir paylaşım hazırla.",
        signature: ["söylenti", "resmi plan"],
      },
      {
        id: "invest-due-diligence",
        pillar: "investment",
        format: "adım adım",
        title: "Arsa yatırımından önce ön inceleme",
        reason: "Arsa yatırımcısına adım adım uygulanabilir bir rehber verir.",
        instruction:
          "Arsa yatırımına başlamadan önce yatırımcılara yapmaları gereken ön inceleme adımlarını (tapu kaydı, imar durumu, yerinde inceleme, çevre ve ulaşım) sırasıyla anlatan bir paylaşım hazırla.",
        signature: ["ön inceleme"],
      },
      // ===== Villa / Konut =====
      {
        id: "home-detached-vs-site",
        pillar: "villa-home",
        format: "karşılaştırma",
        title: "Müstakil villa mı, site içi villa mı?",
        reason: "Villa alıcısının temel karar sorusunu yanıtlar.",
        instruction:
          "Villa almayı düşünen ailelere, müstakil villa ile site içindeki villa arasındaki yaşam, mahremiyet, ortak giderler ve bakım farklarını rakam vermeden anlatan bir paylaşım hazırla.",
        signature: ["müstakil", "site"],
      },
      {
        id: "home-garden-upkeep",
        pillar: "villa-home",
        format: "gerçekçi beklenti",
        title: "Bahçeli eve geçmenin sorumlulukları",
        reason: "Gerçekçi beklenti oluşturarak güven kazandırır.",
        instruction:
          "Bahçeli bir villaya geçmeyi düşünen ailelere, bahçe ve müstakil ev bakımının günlük yaşama getirdiği sorumlulukları rakam vermeden anlatan bir paylaşım hazırla.",
        signature: ["bahçe", "bakım"],
      },
      {
        id: "home-usable-space",
        pillar: "villa-home",
        format: "kavram açıklama",
        title: "İlandaki metrekare ile kullanılabilir alan",
        reason: "Alıcıya kaydedilebilir, pratik bir ayrım öğretir.",
        instruction:
          "Villa bakan alıcılara, ilandaki metrekare ile gerçekten kullanılabilir yaşam alanının neden farklı olabileceğini anlatan bir paylaşım hazırla. Sayı verme.",
        signature: ["metrekare", "kullanılabilir"],
      },
      {
        id: "home-renovate-vs-new",
        pillar: "villa-home",
        format: "karar rehberi",
        title: "Eski villayı yenilemek mi, yeni villa almak mı?",
        reason: "Karar aşamasındaki alıcıya yol gösterir.",
        instruction:
          "Konut alacak alıcılara, eski bir villayı yenilemek ile yeni yapılmış bir villa almak arasında karar verirken değerlendirmeleri gereken noktaları anlatan bir paylaşım hazırla.",
        signature: ["yenile", "eski villa"],
      },
      {
        id: "home-family-priorities",
        pillar: "villa-home",
        format: "soru-cevap",
        title: "Çocuklu aileler ev seçerken",
        reason: "Aile alıcı profiline doğrudan hitap eder.",
        instruction:
          "Çocuklu ailelere, villa ya da müstakil ev seçerken yaşam ihtiyaçlarını (okul yolu, oyun alanı, güvenlik, komşuluk) nasıl önceliklendirmeleri gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["çocuk", "aile"],
      },
      {
        id: "home-building-safety",
        pillar: "villa-home",
        format: "kontrol listesi",
        title: "Yapının sağlamlığını ve belgelerini sorgulamak",
        reason: "Alıcının en önemli güvenlik sorusuna rehberlik eder.",
        instruction:
          "Konut alacak alıcılara, yapının deprem dayanıklılığını, yapım dönemini ve ruhsat ile iskân belgelerini satın almadan önce nasıl sorgulamaları gerektiğini anlatan bir paylaşım hazırla. Mevzuat ayrıntısı veya tarih verme.",
        signature: ["deprem", "dayanıklı"],
      },
      // ===== Evergreen =====
      {
        id: "evergreen-title-transfer",
        pillar: "evergreen",
        format: "adım adım",
        title: "Tapu devri sürecine hazırlık",
        reason: "İlk kez alım yapana kaydedilebilir bir süreç rehberi verir.",
        instruction:
          "İlk kez ev ya da arsa alacak alıcılara, tapu devri sürecinde nelerle karşılaşacaklarını ve hangi belgeleri önceden hazırlamaları gerektiğini genel hatlarıyla anlatan bir paylaşım hazırla. Harç oranı, ücret veya tarih verme.",
        signature: ["tapu devr"],
      },
      {
        id: "evergreen-records-difference",
        pillar: "evergreen",
        format: "kavram açıklama",
        title: "Tapu, kadastro ve imar kaydı farkı",
        reason: "Karıştırılabilen kavramları sadeleştirir; uzmanlık gösterir.",
        instruction:
          "Mülk sahiplerine ve alıcılara, tapu, kadastro ve imar kayıtlarının neyi gösterdiğini ve aralarındaki farkı sade bir dille anlatan bir paylaşım hazırla.",
        signature: ["kadastro", "kayıt"],
      },
      {
        id: "evergreen-value-vs-price",
        pillar: "evergreen",
        format: "danışman görüşü",
        title: "Değer ile ilan fiyatı arasındaki fark",
        reason: "Mülk sahibine ulaşır; değerleme uzmanlığını gösterir.",
        instruction:
          "Mülk sahiplerine, bir mülkün değeri ile ilan fiyatı arasındaki farkı ve değerin nelere göre şekillendiğini anlatan bir paylaşım hazırla.",
        signature: ["ilan fiyat", "değer"],
      },
      {
        id: "evergreen-decision-questions",
        pillar: "evergreen",
        format: "soru listesi",
        title: "Alım-satım kararından önce sorulacak sorular",
        reason: "Kaydedilebilir, paylaşılabilir bir soru listesi verir.",
        instruction:
          "Gayrimenkul alım ya da satım kararı vermeye hazırlanan kişilere, karar öncesinde kendilerine sormaları gereken temel soruları anlatan bir paylaşım hazırla.",
        signature: ["karar öncesi", "temel soru"],
      },
      {
        id: "evergreen-misconceptions",
        pillar: "evergreen",
        format: "doğru bilinen yanlışlar",
        title: "Gayrimenkulde doğru bilinen yanlışlar",
        reason: "Takip edilme nedeni yaratır; paylaşılabilir bilgi verir.",
        instruction:
          "Ev ya da arsa alacak alıcılara, gayrimenkul alımında doğru bilinen yanlışları ve doğrularını anlatan bir paylaşım hazırla. Doğrulanamayan olgu, oran veya istatistik verme.",
        signature: ["doğru bilinen", "yanlış"],
      },
      {
        id: "evergreen-title-annotations",
        pillar: "evergreen",
        format: "kontrol listesi",
        title: "Tapudaki ipotek, şerh ve beyanlar",
        reason: "Alıcıyı riskten korur; kaydedilebilir bilgi verir.",
        instruction:
          "Mülk alacak alıcılara, tapu kaydındaki ipotek, şerh ve beyan gibi kayıtların ne anlama geldiğini ve satın almadan önce neden kontrol edilmesi gerektiğini anlatan bir paylaşım hazırla.",
        signature: ["şerh", "beyan"],
      },
    ],
  },
};
