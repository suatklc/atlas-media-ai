import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { FACEBOOK_LOGIN_CONFIG_ID, buildFacebookAuthorizationUrl } from "@/lib/publishing/connections/facebook-graph";
import {
  FACEBOOK_OAUTH_STATE_COOKIE,
  createOAuthState,
  oauthStateCookieOptions,
} from "@/lib/publishing/connections/oauth-state";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Starts Facebook Login for Business for Facebook Page publishing — the
// Atlas AI Meta app's top-level App ID (META_APP_ID), NOT the Instagram
// App ID used by /api/meta/connect. Separate route, cookie and callback
// from the Instagram connection, so neither flow can affect the other.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);

  const appId = process.env.META_APP_ID;
  if (!appId) {
    return jsonError("Facebook uygulama kimliği (META_APP_ID) yapılandırılmadı. Bağlantı şu anda kullanılamıyor.", 501);
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const state = createOAuthState();
  const authorizationUrl = buildFacebookAuthorizationUrl({
    appId,
    redirectUri: `${siteUrl}/api/facebook/callback`,
    state,
    configId: FACEBOOK_LOGIN_CONFIG_ID,
  });

  const response = NextResponse.redirect(authorizationUrl, 302);
  response.cookies.set(FACEBOOK_OAUTH_STATE_COOKIE, state, oauthStateCookieOptions("/api/facebook"));
  return response;
}
