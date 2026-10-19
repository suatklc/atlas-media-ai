import type { ContentPackage } from "./contentPackage";

// Facebook Page post text, derived ONLY from the approved ContentPackage —
// no model call, so it can never introduce a claim Suat didn't approve.
// Instagram's caption is already conversational prose + signature; what is
// Instagram-specific about it is the hashtag stack. Facebook gets:
//   - the caption paragraphs with every inline/standalone hashtag removed
//   - at most MAX_FACEBOOK_HASHTAGS of the package's own hashtags, the
//     region tag first when present
// Suat can rewrite it freely in Draft Edit ("Facebook metni"); that stored
// text (metadata.platformText.facebook) always wins over this default.

const MAX_FACEBOOK_HASHTAGS = 2;

export function buildFacebookText(contentPackage: ContentPackage, region?: string): string {
  const body = contentPackage.caption
    .split("\n")
    .map((line) => line.replace(/(^|\s)#[^\s#]+/gu, "$1").replace(/[ \t]{2,}/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const normalizedRegion = region?.toLocaleLowerCase("tr-TR");
  const all = contentPackage.hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
  const isRegionTag = (tag: string) => Boolean(normalizedRegion) && tag.toLocaleLowerCase("tr-TR").includes(normalizedRegion as string);
  const tags = [...all.filter(isRegionTag), ...all.filter((tag) => !isRegionTag(tag))].slice(0, MAX_FACEBOOK_HASHTAGS);

  return tags.length > 0 ? `${body}\n\n${tags.join(" ")}` : body;
}

// The text that will actually be published to Facebook for a post row:
// Suat's edited version when present, otherwise the deterministic default.
export function resolveFacebookText(metadata: unknown, fallbackCaption: string, region?: string): string {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const platformText = meta.platformText as { facebook?: unknown } | undefined;
  if (platformText && typeof platformText.facebook === "string" && platformText.facebook.trim()) {
    return platformText.facebook.trim();
  }
  const pkg = meta.contentPackage as ContentPackage | undefined;
  if (pkg && typeof pkg.caption === "string" && Array.isArray(pkg.hashtags)) return buildFacebookText(pkg, region);
  return fallbackCaption;
}
