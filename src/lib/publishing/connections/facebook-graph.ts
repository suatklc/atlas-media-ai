import { META_GRAPH_API_VERSION } from "./meta-oauth";
import { MetaGraphApiError, handleGraphResponse } from "./meta-graph";

// Facebook Page publishing (Facebook Login for Business + Pages API).
// Server-only. A DIFFERENT Meta product from Instagram's connection
// (Instagram API with Instagram Login, meta-oauth.ts / meta-graph.ts): this
// flow logs the user in with their Facebook account through the Atlas AI
// app's Facebook Login for Business configuration, discovers the Pages they
// manage, and publishes with a Page access token. The two credentials are
// never mixed (separate connected_accounts rows, separate Vault secrets).
//
// Verified against Meta's current docs (2026-10-19):
//   - Facebook Login for Business: business-type apps invoke the login
//     dialog with config_id (which replaces scope); permissions live in
//     the configuration: pages_show_list, pages_manage_posts,
//     pages_read_engagement.
//   - code -> user token: GET graph.facebook.com/{v}/oauth/access_token;
//     long-lived user token: grant_type=fb_exchange_token (~60 days).
//   - Pages + Page tokens: GET /me/accounts. A Page token obtained with a
//     long-lived user token has no expiration date.
//   - Multi-photo post: POST /{page-id}/photos with published=false per
//     photo, then POST /{page-id}/feed with attached_media[i]={"media_fbid"}.
//     PNG is accepted (<= 10MB; Meta recommends PNG <= 1MB for quality).
//
// Tokens: the app secret / code go only in the documented OAuth query
// string; Page/user tokens go only in an Authorization: Bearer header.
// Nothing here logs a URL, body or token — only Meta's structured error
// fields via handleGraphResponse.

const GRAPH = `https://graph.facebook.com/${META_GRAPH_API_VERSION}`;
const FACEBOOK_LOGIN_DIALOG_URL = `https://www.facebook.com/${META_GRAPH_API_VERSION}/dialog/oauth`;

// "Atlas Facebook Publishing" configuration in the Atlas AI Meta app
// (Facebook Login for Business, General, User access token). Not a secret;
// overridable for another environment.
export const FACEBOOK_LOGIN_CONFIG_ID = process.env.FACEBOOK_LOGIN_CONFIG_ID ?? "2981606105549106";

export function buildFacebookAuthorizationUrl(input: { appId: string; redirectUri: string; state: string; configId: string }): string {
  const params = new URLSearchParams({
    client_id: input.appId,
    redirect_uri: input.redirectUri,
    state: input.state,
    config_id: input.configId,
    response_type: "code",
  });
  return `${FACEBOOK_LOGIN_DIALOG_URL}?${params.toString()}`;
}

async function request<T>(url: string, init: RequestInit, stage: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    console.error(`Meta Graph API network error (${stage}).`);
    throw new MetaGraphApiError(`${stage}: Meta API isteğine ulaşılamadı.`, { stage });
  }
  return handleGraphResponse<T>(response, stage);
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

type TokenResponse = { access_token?: unknown };

function requireToken(body: TokenResponse, stage: string): string {
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new MetaGraphApiError(`${stage}: Meta API beklenen erişim jetonunu döndürmedi.`, { stage });
  }
  return body.access_token;
}

export async function exchangeFacebookCode(input: { appId: string; appSecret: string; redirectUri: string; code: string }): Promise<string> {
  const stage = "facebook code exchange";
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);
  return requireToken(await request<TokenResponse>(url.toString(), { method: "GET" }, stage), stage);
}

export async function exchangeFacebookLongLivedUserToken(input: { appId: string; appSecret: string; userToken: string }): Promise<string> {
  const stage = "facebook long-lived token exchange";
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("fb_exchange_token", input.userToken);
  return requireToken(await request<TokenResponse>(url.toString(), { method: "GET" }, stage), stage);
}

export type ManagedPage = { id: string; name: string; accessToken: string; canCreateContent: boolean };

type AccountsResponse = { data?: Array<{ id?: unknown; name?: unknown; access_token?: unknown; tasks?: unknown }> };

// GET /me/accounts — the Pages the logged-in user manages, each with its
// Page access token. Only Pages where the user can CREATE_CONTENT (or
// whose tasks Meta omits) are usable for publishing.
export async function listManagedFacebookPages(userToken: string): Promise<ManagedPage[]> {
  const stage = "facebook page discovery";
  const body = await request<AccountsResponse>(
    `${GRAPH}/me/accounts?fields=id,name,access_token,tasks&limit=100`,
    { method: "GET", headers: bearer(userToken) },
    stage,
  );
  return (body.data ?? []).flatMap((page) => {
    if (typeof page.id !== "string" || typeof page.access_token !== "string" || !page.access_token) return [];
    const tasks = Array.isArray(page.tasks) ? page.tasks.filter((t): t is string => typeof t === "string") : null;
    return [
      {
        id: page.id,
        name: typeof page.name === "string" && page.name ? page.name : page.id,
        accessToken: page.access_token,
        canCreateContent: tasks === null || tasks.includes("CREATE_CONTENT"),
      },
    ];
  });
}

type IdResponse = { id?: unknown; post_id?: unknown };

function requireId(body: IdResponse, stage: string): string {
  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new MetaGraphApiError(`${stage}: Meta API beklenen kimliği döndürmedi.`, { stage });
  }
  return body.id;
}

// POST /{page-id}/photos with published=false — uploads one image by public
// URL without creating any post; returns the photo id for attached_media.
export async function uploadUnpublishedPagePhoto(input: { pageId: string; pageToken: string; imageUrl: string }): Promise<string> {
  const stage = "facebook fotoğraf yükleme";
  const form = new URLSearchParams({ url: input.imageUrl, published: "false" });
  return requireId(
    await request<IdResponse>(
      `${GRAPH}/${encodeURIComponent(input.pageId)}/photos`,
      { method: "POST", headers: bearer(input.pageToken), body: form },
      stage,
    ),
    stage,
  );
}

// POST /{page-id}/feed — one Page post with the given photos attached in
// order. published=false creates an unpublished post that never appears in
// the Page's feed (used only by the capability check below).
export async function createPageFeedPost(input: {
  pageId: string;
  pageToken: string;
  message: string;
  photoIds: string[];
  published: boolean;
}): Promise<string> {
  const stage = input.published ? "facebook gönderi yayınlama" : "facebook yayınlanmamış test gönderisi";
  const form = new URLSearchParams({ message: input.message, published: String(input.published) });
  input.photoIds.forEach((id, index) => form.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id })));
  return requireId(
    await request<IdResponse>(
      `${GRAPH}/${encodeURIComponent(input.pageId)}/feed`,
      { method: "POST", headers: bearer(input.pageToken), body: form },
      stage,
    ),
    stage,
  );
}

type AttachmentsResponse = {
  attachments?: { data?: Array<{ target?: { id?: unknown }; subattachments?: { data?: Array<{ target?: { id?: unknown } }> } }> };
};

// The photo ids attached to a post, in display order.
export async function getPostPhotoIds(input: { postId: string; pageToken: string }): Promise<string[]> {
  const stage = "facebook gönderi eklerini okuma";
  const body = await request<AttachmentsResponse>(
    `${GRAPH}/${encodeURIComponent(input.postId)}?fields=attachments{target{id},subattachments.limit(20){target{id}}}`,
    { method: "GET", headers: bearer(input.pageToken) },
    stage,
  );
  const first = body.attachments?.data?.[0];
  const sub = first?.subattachments?.data;
  const targets = sub && sub.length > 0 ? sub.map((item) => item.target?.id) : [first?.target?.id];
  return targets.filter((id): id is string => typeof id === "string");
}

export async function deleteGraphObject(input: { id: string; pageToken: string }): Promise<void> {
  await request<unknown>(
    `${GRAPH}/${encodeURIComponent(input.id)}`,
    { method: "DELETE", headers: bearer(input.pageToken) },
    "facebook test içeriğini silme",
  );
}

// Full public publish: every image uploaded unpublished (in parallel),
// then ONE Page post attaching them in the given order. Returns the post id.
export async function publishFacebookPagePhotos(input: {
  pageId: string;
  pageToken: string;
  message: string;
  imageUrls: string[];
}): Promise<string> {
  const photoIds = await Promise.all(
    input.imageUrls.map((imageUrl) => uploadUnpublishedPagePhoto({ pageId: input.pageId, pageToken: input.pageToken, imageUrl })),
  );
  return createPageFeedPost({ pageId: input.pageId, pageToken: input.pageToken, message: input.message, photoIds, published: true });
}
