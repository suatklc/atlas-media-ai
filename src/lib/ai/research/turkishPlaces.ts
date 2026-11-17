// Turkish place names (İstanbul's districts + the other provinces), used to
// tell a development that is local to somewhere else ("MALTEPE'DE ...")
// from a national or İstanbul-wide one. Locale data, not business data:
// the business's own area comes from BusinessProfile.geography and always
// wins. Matched as whole words only (an apostrophe suffix splits off);
// names that are also everyday words ("Ordu" = army, "Van" = van) are left
// out on purpose.

const ISTANBUL_DISTRICTS = [
  "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler", "Bakırköy", "Başakşehir",
  "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü", "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy",
  "Esenler", "Esenyurt", "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane",
  "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer", "Silivri", "Sultanbeyli",
  "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye", "Üsküdar", "Zeytinburnu",
];

const PROVINCES = [
  "Adana", "Adıyaman", "Afyonkarahisar", "Ağrı", "Aksaray", "Amasya", "Ankara", "Antalya", "Ardahan",
  "Artvin", "Aydın", "Balıkesir", "Bartın", "Batman", "Bayburt", "Bilecik", "Bingöl", "Bitlis", "Bolu",
  "Burdur", "Bursa", "Çanakkale", "Çankırı", "Çorum", "Denizli", "Diyarbakır", "Düzce", "Edirne", "Elazığ",
  "Erzincan", "Erzurum", "Eskişehir", "Gaziantep", "Giresun", "Gümüşhane", "Hakkari", "Hatay", "Iğdır",
  "Isparta", "İzmir", "Kahramanmaraş", "Karabük", "Karaman", "Kars", "Kastamonu", "Kayseri", "Kilis",
  "Kırıkkale", "Kırklareli", "Kırşehir", "Kocaeli", "Konya", "Kütahya", "Malatya", "Manisa", "Mardin",
  "Mersin", "Muğla", "Muş", "Nevşehir", "Niğde", "Osmaniye", "Rize", "Sakarya", "Samsun", "Şanlıurfa",
  "Siirt", "Sinop", "Sivas", "Şırnak", "Tekirdağ", "Tokat", "Trabzon", "Tunceli", "Uşak", "Yalova",
  "Yozgat", "Zonguldak",
];

const lower = (text: string) => text.toLocaleLowerCase("tr-TR");

function words(text: string): string[] {
  return lower(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const PROVINCE_SET = new Set([...PROVINCES, "İstanbul"].map(lower));
const DISTRICT_SET = new Set(ISTANBUL_DISTRICTS.map(lower));

// Administrative wording that pins a decision to one place even when the
// name is not in the lists above ("Van İli", "İpekyolu İlçesi") — Resmî
// Gazete parcel/reserve-area decisions are written this way.
// The suffix must end the word: JS \b is ASCII-only even with /u, so
// "İlişkin" would otherwise match "ili" (live false positive, 2026-11-17).
const ADMIN_PLACE_PATTERN = /(\p{L}+)\s+(?:ili|ilinde|ilindeki|ilçesi|ilçesinde|ilçesindeki|ilçesine)(?!\p{L})/giu;
const ADMIN_PATTERN_STOPWORDS = new Set(["bu", "her", "tüm", "aynı", "söz", "konu", "ilgili", "o"].map(lower));

export type GeoScope =
  | { kind: "home" }
  | { kind: "general" }
  | { kind: "elsewhere"; place: string };

const display = (name: string) => name.charAt(0).toLocaleUpperCase("tr-TR") + name.slice(1);

// Where a development applies, from its own title/snippet:
// - "home": names the business's own area (a homeNames entry that is not
//   just the province, e.g. a district or village) — always wins.
// - "elsewhere": names another province, another İstanbul district, or
//   another "<X> İli/İlçesi" — local to somewhere else, even if the province
//   (e.g. "İstanbul İli, Kartal İlçesi") is shared.
// - "general": no place named, or only a home province ("İstanbul
//   genelinde") — national or province-wide.
export function classifyGeoScope(text: string, homeNames: string[]): GeoScope {
  const home = new Set(homeNames.map(lower));
  const specificHome = new Set([...home].filter((name) => !PROVINCE_SET.has(name)));
  const tokens = words(text);
  if (tokens.some((token) => specificHome.has(token))) return { kind: "home" };

  for (const match of lower(text).matchAll(ADMIN_PLACE_PATTERN)) {
    const place = match[1];
    if (!home.has(place) && !ADMIN_PATTERN_STOPWORDS.has(place)) return { kind: "elsewhere", place: display(place) };
  }
  const elsewhere = tokens.find((token) => (PROVINCE_SET.has(token) || DISTRICT_SET.has(token)) && !home.has(token));
  return elsewhere ? { kind: "elsewhere", place: display(elsewhere) } : { kind: "general" };
}

// The business's own area as classifyGeoScope expects it: its province (if
// set in BusinessProfile.geography), primary area and nearby places.
export function homeAreaNames(geography: { primary: string; nearby: string[]; province?: string }): string[] {
  return [...(geography.province ? [geography.province] : []), geography.primary, ...geography.nearby];
}

// True when the text is local to a district/province outside homeNames (the
// business's own area) — see classifyGeoScope.
export function isLocalToElsewhere(text: string, homeNames: string[]): boolean {
  return classifyGeoScope(text, homeNames).kind === "elsewhere";
}
