import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { MetaGraphApiError } from "@/lib/publishing/connections/meta-graph";
import {
  exchangeFacebookCode,
  exchangeFacebookLongLivedUserToken,
  listManagedFacebookPages,
} from "@/lib/publishing/connections/facebook-graph";
import { mergeConnectedAccountMetadata, upsertConnectedMetaAccount } from "@/lib/publishing/connections/query";
import { FACEBOOK_OAUTH_STATE_COOKIE, isValidOAuthState } from "@/lib/publishing/connections/oauth-state";

// Facebook Login for Business callback: code -> user token -> long-lived
// user token -> the Pages the user manages, each stored as its own
// connected_accounts row (platform "facebook") with its Page token in
// Vault. Exactly one usable Page = selected automatically; several = Suat
// selects one in Bağlı Hesaplar (the others are then removed). The
// Instagram connection is never read or written here. Every failure
// redirects back with a non-sensitive reason code and creates nothing.
function backToDashboard(siteUrl: string, status: string) {
  const url = new URL("/dashboard", siteUrl);
  url.searchParams.set("facebook_connection", status);
  return NextResponse.redirect(url, 302);
}

export async function GET(request: NextRequest) {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Bu işlem için giriş yapmanız gerekiyor." }, { status: 401 });

  const url = new URL(request.url);
  const cookieStore = await cookies();
  const storedState = cookieStore.get(FACEBOOK_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(FACEBOOK_OAUTH_STATE_COOKIE);
  if (!isValidOAuthState(storedState, url.searchParams.get("state"))) return backToDashboard(siteUrl, "invalid_state");
  if (url.searchParams.get("error")) return backToDashboard(siteUrl, "denied");
  const code = url.searchParams.get("code");
  if (!code) return backToDashboard(siteUrl, "invalid_callback");

  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return backToDashboard(siteUrl, "not_configured");

  let pages;
  try {
    const shortLived = await exchangeFacebookCode({ appId, appSecret, redirectUri: `${siteUrl}/api/facebook/callback`, code });
    // Page tokens obtained with a long-lived user token do not expire.
    const longLived = await exchangeFacebookLongLivedUserToken({ appId, appSecret, userToken: shortLived });
    pages = (await listManagedFacebookPages(longLived)).filter((page) => page.canCreateContent);
  } catch (error) {
    console.error(
      "Facebook connection failed:",
      error instanceof MetaGraphApiError ? `${error.details?.stage ?? ""} ${error.message}` : "unknown error",
    );
    return backToDashboard(siteUrl, "token_error");
  }

  if (pages.length === 0) return backToDashboard(siteUrl, "no_pages");

  const storedIds: string[] = [];
  for (const page of pages) {
    const result = await upsertConnectedMetaAccount(supabase, {
      userId: user.id,
      platform: "facebook",
      externalAccountId: page.id,
      externalAccountName: page.name,
      accessToken: page.accessToken,
      tokenExpiresAt: null,
    });
    if (result.success && result.id) storedIds.push(result.id);
  }
  if (storedIds.length === 0) return backToDashboard(siteUrl, "storage_error");

  if (storedIds.length === 1) {
    await mergeConnectedAccountMetadata(supabase, user.id, storedIds[0], { selected: true });
    return backToDashboard(siteUrl, "success");
  }
  return backToDashboard(siteUrl, "select_page");
}
