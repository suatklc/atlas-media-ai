import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMetaAuthorizationUrl } from "@/lib/publishing/connections/meta-oauth";
import {
  META_OAUTH_STATE_COOKIE,
  createOAuthState,
  oauthStateCookieOptions,
} from "@/lib/publishing/connections/oauth-state";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Starts the Instagram API with Instagram Login ("Instagram Business
// Login") authorization flow for the signed-in Atlas user — see
// meta-oauth.ts for why this is a different product/host from the earlier
// Facebook Login for Business flow. Server-side only — invoked via a plain
// link (SocialAccounts.tsx) rather than a client-side redirect call. No
// request data is needed (the Supabase session comes from cookies read
// internally by createClient()), so the route takes no parameters.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);
  }

  // Checked at request time, never pre-assumed — same "throw/fail if
  // missing" discipline already used for OPENAI_API_KEY/FAL_KEY. No live
  // OAuth request is made without this; no credential is invented. This is
  // the Instagram-specific App ID (App Dashboard > Instagram > API setup
  // with Instagram login), NOT the top-level META_APP_ID — see meta-oauth.ts.
  const appId = process.env.INSTAGRAM_APP_ID;
  if (!appId) {
    return jsonError(
      "Instagram uygulama kimliği yapılandırılmadı. Bağlantı şu anda kullanılamıyor.",
      501,
    );
  }

  // Same NEXT_PUBLIC_SITE_URL pattern already used for the password-reset
  // redirect link (forgot-password/actions.ts) — the only place the
  // callback's base URL is derived from, so switching from a development
  // URL to the final production domain later is an environment-variable
  // change only, never an edit to this route.
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const redirectUri = `${siteUrl}/api/meta/callback`;

  // A random per-request value, persisted in a short-lived httpOnly cookie
  // and re-verified against the callback's `state` query param in
  // callback/route.ts — the CSRF defense for this redirect round-trip. See
  // oauth-state.ts for why a plain stored/compared value is sufficient.
  const state = createOAuthState();

  const authorizationUrl = buildMetaAuthorizationUrl({ appId, redirectUri, state });

  const response = NextResponse.redirect(authorizationUrl, 302);
  response.cookies.set(META_OAUTH_STATE_COOKIE, state, oauthStateCookieOptions());
  return response;
}
