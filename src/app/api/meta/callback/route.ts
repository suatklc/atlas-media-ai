import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  MetaGraphApiError,
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchInstagramUsername,
} from "@/lib/publishing/connections/meta-graph";
import { upsertConnectedMetaAccount } from "@/lib/publishing/connections/query";
import { META_OAUTH_STATE_COOKIE, isValidOAuthState } from "@/lib/publishing/connections/oauth-state";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function secondsToIsoExpiry(expiresInSeconds: number | null): string | null {
  if (expiresInSeconds === null) return null;
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

// Receives Instagram's OAuth redirect (Instagram API with Instagram Login)
// and completes the real connection: token exchange, then persistence
// through the existing Vault-backed connected-account architecture
// (query.ts's upsertConnectedMetaAccount, which itself only ever stores a
// token via the store_connected_account_credential Vault RPC — never a
// plaintext column). Never reports success unless a real exchange + a real
// persisted connection completed.
//
// No Facebook Page discovery step exists in this flow (Handoff 6 Step 5D
// removed it) — this product's access token represents the authorizing
// Instagram professional account directly, with the account id returned by
// the code-exchange step itself. There is exactly one connection to persist
// per callback, never a list of Pages to loop over.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return jsonError("Bu işlem için giriş yapmanız gerekiyor.", 401);
  }

  const url = new URL(request.url);
  const metaError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  // State is verified before ANY other callback parameter (including
  // `error`) is trusted — "do not accept a callback merely because it
  // contains a valid-looking code" extends to not interpreting anything
  // else in an unverified callback either. Single-use: deleted here
  // regardless of outcome.
  const cookieStore = await cookies();
  const storedState = cookieStore.get(META_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(META_OAUTH_STATE_COOKIE);

  if (!isValidOAuthState(storedState, stateParam)) {
    return jsonError("Geçersiz veya süresi dolmuş bağlantı isteği. Lütfen tekrar deneyin.", 400);
  }

  if (metaError) {
    return jsonError("Meta yetkilendirmesi reddedildi veya iptal edildi.", 400);
  }

  if (!code) {
    return jsonError("Geçersiz geri çağırma isteği.", 400);
  }

  // Both required for the token-exchange call — checked explicitly rather
  // than assumed, same pattern as connect/route.ts. These are the
  // Instagram-specific App ID/Secret (App Dashboard > Instagram > API setup
  // with Instagram login), not the top-level META_APP_ID/META_APP_SECRET —
  // see meta-oauth.ts.
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) {
    return jsonError(
      "Instagram uygulama kimlik bilgileri yapılandırılmadı. Bağlantı tamamlanamıyor.",
      501,
    );
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const redirectUri = `${siteUrl}/api/meta/callback`;

  let instagramUserId: string;
  let longLivedToken: string;
  let tokenExpiresAt: string | null;
  try {
    const shortLived = await exchangeCodeForUserToken({ appId, appSecret, redirectUri, code });
    const longLived = await exchangeForLongLivedUserToken({
      appSecret,
      shortLivedToken: shortLived.accessToken,
    });
    instagramUserId = shortLived.userId;
    longLivedToken = longLived.accessToken;
    tokenExpiresAt = secondsToIsoExpiry(longLived.expiresInSeconds);
  } catch (error) {
    console.error(
      "Instagram token exchange failed:",
      error instanceof MetaGraphApiError ? error.message : "unknown error",
    );
    return jsonError("Instagram erişim jetonu alınamadı.", 502);
  }

  // Best-effort display name only — the account id above is already known
  // and sufficient to persist the connection, so a failed/empty username
  // lookup falls back to the id rather than failing the whole connection.
  const username = await fetchInstagramUsername(longLivedToken);

  const result = await upsertConnectedMetaAccount(supabase, {
    userId: user.id,
    platform: "instagram",
    externalAccountId: instagramUserId,
    externalAccountName: username ?? instagramUserId,
    accessToken: longLivedToken,
    tokenExpiresAt,
  });

  if (!result.success) {
    console.error("Instagram account persistence failed.");
    return jsonError("Bağlantı kaydedilemedi. Lütfen tekrar deneyin.", 502);
  }

  // Minimal, non-sensitive status only — no account ids, names, or counts
  // that would need their own trust boundary; the dashboard's own
  // connected-accounts query (query.ts's listConnectedMetaAccounts, wired
  // into SocialAccounts.tsx) is the sanctioned way to show real connection
  // state.
  const dashboardUrl = new URL("/dashboard", siteUrl);
  dashboardUrl.searchParams.set("meta_connection", "success");
  return NextResponse.redirect(dashboardUrl, 302);
}
