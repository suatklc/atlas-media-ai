// Instagram OAuth (Instagram API with Instagram Login, a.k.a. "Instagram
// Business Login") authorization-URL construction — pure string assembly
// only, no network call, no credential reading.
//
// This is a DIFFERENT Meta product from the earlier "Facebook Login for
// Business" flow this file used to target: there is no Facebook Page
// involved at any step. The user authorizes directly against their
// Instagram professional account, and the resulting access token represents
// that Instagram account on its own. Do not reintroduce Facebook Page
// scopes (pages_show_list, pages_read_engagement, pages_manage_posts) or
// the old instagram_basic/instagram_content_publish scope names — Meta
// rejects them as invalid under this product.
//
// Verified against developers.facebook.com's live "Instagram API with
// Instagram Login" documentation (Handoff 6 Step 5D).
export const META_GRAPH_API_VERSION = "v25.0";
const INSTAGRAM_OAUTH_DIALOG_URL = "https://www.instagram.com/oauth/authorize";

// instagram_business_basic: read the connected professional account's own
// profile/media. instagram_business_content_publish: publish to it. Only
// these two are requested — instagram_business_manage_comments/_messages
// are enabled in the Meta App dashboard but not requested here, since
// Atlas's first connection needs neither yet.
export const META_OAUTH_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

export type MetaAuthorizationUrlInput = {
  // The app's Instagram App ID — App Dashboard > Instagram > API setup with
  // Instagram login > Business login settings > Instagram App ID. This is a
  // DIFFERENT value from the top-level Meta/Facebook App ID; using the
  // wrong one causes Meta to reject the authorization request.
  appId: string;
  redirectUri: string;
  state: string;
};

export function buildMetaAuthorizationUrl({ appId, redirectUri, state }: MetaAuthorizationUrlInput): string {
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: META_OAUTH_SCOPES.join(","),
    response_type: "code",
  });
  return `${INSTAGRAM_OAUTH_DIALOG_URL}?${params.toString()}`;
}
