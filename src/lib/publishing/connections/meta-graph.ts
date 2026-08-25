import { META_GRAPH_API_VERSION } from "./meta-oauth";

// Real Instagram API (Instagram API with Instagram Login) calls for the
// OAuth callback's token exchange and account-discovery steps. Server-only.
//
// This targets three distinct hosts, exactly as Meta's current
// documentation specifies for this product — none of them are
// interchangeable, and none of them is graph.facebook.com (the old
// Facebook Login for Business host this file used to call):
//   - api.instagram.com   — authorization-code exchange
//   - graph.instagram.com — long-lived token exchange, account lookup
//
// Every function that accepts a token or app secret places it in a request
// exactly as documented (query string for GETs, multipart form body for the
// one documented POST) — never an unconfirmed header-based alternative.
// The constructed request/body is never logged or included in a thrown
// error message; only Meta's own structured error-response fields
// (type/code/message) are logged.

export class MetaGraphApiError extends Error {}

type GraphErrorBody = { error?: { message?: unknown; type?: unknown; code?: unknown } };

function isGraphErrorBody(value: unknown): value is GraphErrorBody {
  return typeof value === "object" && value !== null;
}

// Coerces one Meta error-response field (type/code/message — never a
// secret; these are Meta's own documented structured-error fields) to a
// short, log-safe string. Meta always documents these as strings/numbers,
// but the response is untyped JSON — this guards against a future/unusual
// response shaping an object/array into these fields and breaking the log
// line, without ever printing that value's contents.
function sanitizeErrorField(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value === undefined || value === null ? "yok" : "tanınmayan biçim";
}

// Single-line, single-argument console.error calls only — a prior version
// of this function split the message across two console.error arguments
// (a template string + a separate object), which turned out to be
// invisible to the production log search used to diagnose a real HTTP 502
// (Handoff 6 Step 5D follow-up): the object argument's fields apparently
// weren't indexed/matched by that search. Every diagnostic line in this
// file is now one plain string, containing only the exchange stage, HTTP
// status, and Meta's own type/code/message fields — never a token, code,
// secret, or raw response body.
function logGraphError(context: string, status: number, body: unknown): void {
  if (isGraphErrorBody(body) && body.error) {
    const { message, type, code } = body.error;
    console.error(
      `Meta Graph API error — stage=${context} status=${status} type=${sanitizeErrorField(type)} code=${sanitizeErrorField(code)} message=${sanitizeErrorField(message)}`,
    );
  } else {
    console.error(`Meta Graph API error — stage=${context} status=${status}: no structured error body.`);
  }
}

async function handleGraphResponse<T>(response: Response, context: string): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // This branch previously threw with NO log call at all — if Meta's
    // error response isn't valid JSON (an HTML error page, an empty body,
    // or an edge/CDN block page are all plausible for a failing POST),
    // nothing was ever written to the runtime log before the exception
    // propagated. That silent gap is what made a real production 502
    // invisible to log search. The body's actual content is never logged
    // (it may not even be safe/parseable text) — only that parsing failed.
    console.error(`Meta Graph API error — stage=${context} status=${response.status}: non-JSON error response.`);
    throw new MetaGraphApiError(`${context}: Meta API yanıtı ayrıştırılamadı.`);
  }

  if (!response.ok) {
    logGraphError(context, response.status, body);
    throw new MetaGraphApiError(`${context}: Meta API isteği başarısız oldu.`);
  }

  return body as T;
}

async function graphGet<T>(url: URL, context: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: "GET" });
  } catch {
    console.error(`Meta Graph API network error (${context}).`);
    throw new MetaGraphApiError(`${context}: Meta API isteğine ulaşılamadı.`);
  }
  return handleGraphResponse<T>(response, context);
}

async function graphPostForm<T>(url: string, form: FormData, context: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form });
  } catch {
    console.error(`Meta Graph API network error (${context}).`);
    throw new MetaGraphApiError(`${context}: Meta API isteğine ulaşılamadı.`);
  }
  return handleGraphResponse<T>(response, context);
}

// Distinct from graphPostForm: the content-publishing endpoints (media,
// media_publish) are documented with a JSON body and the access token in
// an Authorization: Bearer header — a different, endpoint-specific request
// shape from the multipart/no-header token-exchange POST above. Verified
// against Meta's current "Instagram API with Instagram Login" content-
// publishing documentation, not assumed to match the OAuth endpoints'
// pattern. The access token is placed only in the header, exactly as
// documented — never logged, never part of any thrown error message.
async function graphPostJson<T>(
  url: string,
  jsonBody: Record<string, string>,
  accessToken: string,
  context: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(jsonBody),
    });
  } catch {
    console.error(`Meta Graph API network error (${context}).`);
    throw new MetaGraphApiError(`${context}: Meta API isteğine ulaşılamadı.`);
  }
  return handleGraphResponse<T>(response, context);
}

export type ExchangeCodeInput = { appId: string; appSecret: string; redirectUri: string; code: string };

export type InstagramShortLivedTokenResult = {
  accessToken: string;
  // The Instagram professional account's own id — returned directly by this
  // step, so no separate account-discovery call is needed to know WHICH
  // account was just connected (unlike the old Facebook Page flow, where
  // this required a follow-up /me/accounts call).
  userId: string;
};

type InstagramTokenExchangeEntry = { access_token?: unknown; user_id?: unknown; permissions?: unknown };

type InstagramTokenExchangeResponse = InstagramTokenExchangeEntry & {
  data?: Array<InstagramTokenExchangeEntry>;
};

// Describes a field's PRESENCE/TYPE/EMPTINESS only — NEVER its value.
// "missing" (key absent), "null", "empty-string", "non-empty-string", or a
// bare typeof (e.g. "number", "object", "boolean") for anything present
// that isn't a usable non-empty string. This is what topLevelKeys alone
// could never distinguish: a key can be present (and so appear in
// topLevelKeys) while its value is null, the wrong type, or an empty
// string — all three look identical from key names alone.
function describeFieldValidity(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string") return value.length === 0 ? "empty-string" : "non-empty-string";
  return typeof value;
}

// Instagram account ids are a confirmed real-world Graph API inconsistency:
// a live production response (Handoff 6 Step 5D follow-up —
// accessTokenField=non-empty-string, userIdField=number) returned user_id
// as a JSON number, not the string Meta's own documentation shows. Every
// downstream use of this id (externalAccountId, Vault lookups, the
// connected_accounts row) treats it as a string, so it is normalized here,
// once, at the boundary — never left as a number to ripple through the
// rest of the codebase. access_token is deliberately NOT given the same
// treatment: a token is never legitimately anything but a string, so
// widening that check would accept genuinely malformed data instead of
// correctly rejecting it. NaN is excluded by the finite check even though
// typeof NaN === "number".
function normalizeUserId(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  return null;
}

// Logs the STRUCTURE (top-level key names, whether "data" is an array and
// its length) AND, once an `entry` has been resolved, the VALIDITY
// (present/type/emptiness only, never the value) of the two fields the
// parser actually requires — access_token and user_id. This is the only
// place a successful response's shape is ever logged; previously it logged
// only key names, which proved a key was present but not whether its value
// was actually usable. A real production log matching this exact key set
// (access_token,permissions,user_id, dataShape=undefined) was confirmed
// (Handoff 6 Step 5D follow-up, verified here by running the exact shape
// through this real function with valid string values, which succeeds) to
// still be reachable only when access_token's VALUE — not its presence —
// fails validation; the previous log had no way to show that distinction.
function logUnexpectedTokenShape(context: string, body: unknown, entry: unknown): void {
  const isObject = typeof body === "object" && body !== null;
  const topLevelKeys = isObject ? Object.keys(body as Record<string, unknown>).sort().join(",") : "n/a";
  const dataValue = isObject ? (body as Record<string, unknown>).data : undefined;
  const dataShape = Array.isArray(dataValue) ? `array(length=${dataValue.length})` : typeof dataValue;
  const entryIsObject = typeof entry === "object" && entry !== null;
  const accessTokenField = entryIsObject
    ? describeFieldValidity((entry as Record<string, unknown>).access_token)
    : "n/a";
  const userIdField = entryIsObject ? describeFieldValidity((entry as Record<string, unknown>).user_id) : "n/a";
  console.error(
    `Meta Graph API unexpected success shape — stage=${context} topLevelKeys=${topLevelKeys || "none"} dataShape=${dataShape} accessTokenField=${accessTokenField} userIdField=${userIdField}`,
  );
}

// POST https://api.instagram.com/oauth/access_token (multipart/form-data:
// client_id, client_secret, grant_type=authorization_code, redirect_uri,
// code) — step 1 of Meta's documented Instagram API with Instagram Login
// flow: exchange the one-time authorization code for a short-lived user
// token.
//
// Meta's own documentation shows this response wrapped in a "data" array.
// A real production HTTP 200 was confirmed (by elimination — see
// logUnexpectedTokenShape's comment) to NOT satisfy that shape, which
// matches a known docs/reality mismatch reported for this exact endpoint:
// the live API has been observed to return the token/user_id/permissions
// flat instead, with no wrapper. Rather than guessing which one is
// "correct", both are accepted — the wrapped entry if present, otherwise
// the top-level body itself.
export async function exchangeCodeForUserToken(input: ExchangeCodeInput): Promise<InstagramShortLivedTokenResult> {
  const form = new FormData();
  form.set("client_id", input.appId);
  form.set("client_secret", input.appSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", input.redirectUri);
  form.set("code", input.code);

  const body = await graphPostForm<InstagramTokenExchangeResponse>(
    "https://api.instagram.com/oauth/access_token",
    form,
    "code exchange",
  );

  const entry: InstagramTokenExchangeEntry = body.data?.[0] ?? body;

  if (!entry || typeof entry.access_token !== "string" || entry.access_token.length === 0) {
    logUnexpectedTokenShape("code exchange", body, entry);
    throw new MetaGraphApiError("code exchange: Meta API beklenen erişim jetonunu döndürmedi.");
  }

  const userId = normalizeUserId(entry.user_id);
  if (userId === null) {
    logUnexpectedTokenShape("code exchange", body, entry);
    throw new MetaGraphApiError("code exchange: Meta API beklenen hesap kimliğini döndürmedi.");
  }

  return { accessToken: entry.access_token, userId };
}

export type ExchangeLongLivedInput = { appSecret: string; shortLivedToken: string };

export type MetaTokenResult = {
  accessToken: string;
  // Always taken directly from the API's own expires_in field — never a
  // hardcoded/assumed duration, since Meta documents long-lived tokens as
  // "generally about 60 days" without guaranteeing an exact figure.
  expiresInSeconds: number | null;
};

type OAuthAccessTokenResponse = { access_token?: unknown; expires_in?: unknown };

// GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token
// &client_secret&access_token — step 2: exchange the short-lived token
// (1 hour) for a long-lived one ("generally about 60 days"). Flat response
// shape, per Meta's documentation for this specific endpoint — no client_id
// parameter here (the app secret alone identifies the app).
export async function exchangeForLongLivedUserToken(input: ExchangeLongLivedInput): Promise<MetaTokenResult> {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", input.appSecret);
  url.searchParams.set("access_token", input.shortLivedToken);

  const body = await graphGet<OAuthAccessTokenResponse>(url, "long-lived token exchange");
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new MetaGraphApiError("long-lived token exchange: Meta API beklenen erişim jetonunu döndürmedi.");
  }
  const expiresInSeconds = typeof body.expires_in === "number" ? body.expires_in : null;
  return { accessToken: body.access_token, expiresInSeconds };
}

type InstagramMeResponse = { data?: Array<{ user_id?: unknown; username?: unknown }> };

// GET https://graph.instagram.com/{version}/me?fields=user_id,username
// &access_token — display-name lookup only; the account id itself already
// came back from the code-exchange step. Best-effort: a failed or empty
// result must never fail the connection, since the account id is always
// available as a fallback label (see callback/route.ts).
export async function fetchInstagramUsername(accessToken: string): Promise<string | null> {
  const url = new URL(`https://graph.instagram.com/${META_GRAPH_API_VERSION}/me`);
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);

  try {
    const body = await graphGet<InstagramMeResponse>(url, "Instagram username lookup");
    const username = body.data?.[0]?.username;
    return typeof username === "string" && username.length > 0 ? username : null;
  } catch {
    return null;
  }
}

export type CreateInstagramMediaContainerInput = {
  igUserId: string;
  accessToken: string;
  imageUrl: string;
  caption: string;
};

type MediaContainerResponse = { id?: unknown };

// POST https://graph.instagram.com/{version}/{ig-user-id}/media (JSON body,
// Authorization: Bearer header) — step 1 of Meta's documented Instagram API
// with Instagram Login content-publishing flow: create a media container
// from a public image URL + caption. Image posts only (image_url) — a
// future video/Reels container would add video_url/media_type fields to
// this same jsonBody without needing a different function shape or a new
// response-parsing path, since the response here is already the generic
// { id } every container type returns.
export async function createInstagramMediaContainer(
  input: CreateInstagramMediaContainerInput,
): Promise<string> {
  const url = `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(input.igUserId)}/media`;
  const body = await graphPostJson<MediaContainerResponse>(
    url,
    { image_url: input.imageUrl, caption: input.caption },
    input.accessToken,
    "medya konteyneri oluşturma",
  );

  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new MetaGraphApiError("medya konteyneri oluşturma: Meta API beklenen konteyner kimliğini döndürmedi.");
  }
  return body.id;
}

export type PublishInstagramMediaContainerInput = {
  igUserId: string;
  accessToken: string;
  containerId: string;
};

// POST https://graph.instagram.com/{version}/{ig-user-id}/media_publish
// (JSON body, Authorization: Bearer header) — step 2: publish a
// previously-created container by id. Returns the real, live Instagram
// media id — never a fabricated/assumed one.
export async function publishInstagramMediaContainer(
  input: PublishInstagramMediaContainerInput,
): Promise<string> {
  const url = `https://graph.instagram.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(input.igUserId)}/media_publish`;
  const body = await graphPostJson<MediaContainerResponse>(
    url,
    { creation_id: input.containerId },
    input.accessToken,
    "medya yayınlama",
  );

  if (typeof body.id !== "string" || body.id.length === 0) {
    throw new MetaGraphApiError("medya yayınlama: Meta API beklenen medya kimliğini döndürmedi.");
  }
  return body.id;
}
