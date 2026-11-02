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
const PLACES = new Set([...ISTANBUL_DISTRICTS, ...PROVINCES].map(lower));

function words(text: string): string[] {
  return lower(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

// True when the text names a Turkish district/province outside homeNames
// (the business's own area) and names none of homeNames itself.
export function isLocalToElsewhere(text: string, homeNames: string[]): boolean {
  const home = new Set(homeNames.map(lower));
  const tokens = words(text);
  if (tokens.some((token) => home.has(token))) return false;
  return tokens.some((token) => PLACES.has(token) && !home.has(token));
}
