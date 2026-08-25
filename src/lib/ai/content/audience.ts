import type { AudienceType } from "./types";

function normalize(text: string): string {
  return text.toLocaleLowerCase("tr-TR").trim().replace(/\s+/g, " ");
}

function hasAnyMatch(normalizedMessage: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalizedMessage.includes(normalize(phrase)));
}

// Local, self-contained signal lists. Deliberately independent of the
// Knowledge Layer's runtime matches (no import from knowledge/*), so
// audience resolution stays testable in isolation.
const FIRST_TIME_SIGNALS = ["ilk evim", "ilk kez ev alıyorum", "ilk kez ev alacağım", "ilk defa ev alıyorum"];
const PROPERTY_OWNER_SIGNALS = ["mülk sahibiyim", "kiracım var", "elimdeki daire", "elimdeki ev", "sahibi olduğum"];
const COMMERCIAL_INVESTOR_SIGNALS = [
  "ticari yatırım",
  "ofis yatırımı",
  "depo yatırımı",
  "sanayi yatırımı",
  "ticari mülk yatırımı",
];
const LAND_INVESTOR_SIGNALS = ["arsa yatırımı", "arazi yatırımı", "yatırım amaçlı arsa"];
const VILLA_SIGNALS = ["villa"];

// Luxury two-of-four categories. The property-type category deliberately
// excludes "villa" — that has its own higher-priority category above, so a
// plain villa mention resolves to villa-buyer, not luxury-home-buyer. A
// villa mentioned alongside independent luxury language/context/price
// signals still only reaches villa-buyer, since that check runs first in
// the priority order; this is treated as acceptable (villas are already a
// premium segment) rather than a defect — noted for verification.
const LUXURY_LANGUAGE_SIGNALS = ["lüks", "prestijli", "ayrıcalıklı", "üst segment"];
const LUXURY_PROPERTY_TYPE_SIGNALS = ["rezidans", "premium konut", "lüks daire"];
const LUXURY_CONTEXT_SIGNALS = ["üst segment müşteri", "lüks segment", "yüksek bütçeli"];
// "milyon" (million) scale is used as the luxury-tier price proxy, as
// opposed to "bin" (thousand) scale which is typical of rental amounts —
// deliberately not a hardcoded price threshold, which would be an
// arbitrary business decision this layer shouldn't make unilaterally.
const LUXURY_PRICE_PATTERN = /\d[\d.,]*\s*milyon\s*(tl|dolar|euro|\$|€)?/i;

export function resolveAudience(message: string): AudienceType {
  const normalizedMessage = normalize(message);

  if (hasAnyMatch(normalizedMessage, FIRST_TIME_SIGNALS)) return "first-time-home-buyer";
  if (hasAnyMatch(normalizedMessage, PROPERTY_OWNER_SIGNALS)) return "property-owner";
  if (hasAnyMatch(normalizedMessage, COMMERCIAL_INVESTOR_SIGNALS)) return "commercial-investor";
  if (hasAnyMatch(normalizedMessage, LAND_INVESTOR_SIGNALS)) return "land-investor";
  if (hasAnyMatch(normalizedMessage, VILLA_SIGNALS)) return "villa-buyer";

  const luxuryCategoryHits = [
    hasAnyMatch(normalizedMessage, LUXURY_LANGUAGE_SIGNALS),
    hasAnyMatch(normalizedMessage, LUXURY_PROPERTY_TYPE_SIGNALS),
    hasAnyMatch(normalizedMessage, LUXURY_CONTEXT_SIGNALS),
    LUXURY_PRICE_PATTERN.test(normalizedMessage),
  ].filter(Boolean).length;

  if (luxuryCategoryHits >= 2) return "luxury-home-buyer";

  return "general-buyer";
}
