import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectedAccountSummary } from "./types";
import { refreshInstagramLongLivedToken } from "./meta-graph";

// Instagram (Instagram API with Instagram Login) token lifecycle. Server-only.
//
// Atlas stores a long-lived Instagram User token (60 days). Meta lets it be
// refreshed once it is at least 24 hours old and still unexpired; a token
// not refreshed within its 60 days expires and can only be replaced by
// reconnecting. No background job: the token is refreshed on USE — when the
// dashboard loads or a post is published — once fewer than
// REFRESH_WHEN_REMAINING_MS remain. At that point the token is ~30 days old
// (far past the 24 h minimum), and Suat has a whole month of dashboard
// visits before expiry for a refresh to succeed.
//
// Safety: a refresh failure never touches the stored credential — the
// existing token is still valid and keeps being used. The new token is
// written to Vault first and the expiry second; if the expiry write fails
// the stored expiry is merely earlier than reality, so the next use simply
// refreshes again. Tokens are never logged.

const DAY_MS = 24 * 60 * 60 * 1000;
export const REFRESH_WHEN_REMAINING_MS = 30 * DAY_MS;
// Inside this window a token that could not be refreshed is shown as
// needing a reconnect, before it actually expires.
export const RECONNECT_WARNING_MS = 7 * DAY_MS;

export type InstagramTokenState = "valid" | "refresh-due" | "expired" | "unknown";

export function classifyInstagramToken(tokenExpiresAt: string | null, now: number = Date.now()): InstagramTokenState {
  if (!tokenExpiresAt) return "unknown";
  const expiresAt = Date.parse(tokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return "unknown";
  if (expiresAt <= now) return "expired";
  if (expiresAt - now <= REFRESH_WHEN_REMAINING_MS) return "refresh-due";
  return "valid";
}

export type EnsureFreshResult = {
  state: InstagramTokenState | "refreshed" | "refresh-failed";
  // Expiry after this call (the new one when refreshed).
  tokenExpiresAt: string | null;
  // The credential to publish with — null only when expired or unavailable.
  accessToken: string | null;
};

// currentToken comes from the caller (getConnectedAccountCredential, the
// one sanctioned Vault read). Instagram accounts only; any other platform
// is returned untouched.
export async function ensureFreshInstagramToken(
  supabase: SupabaseClient,
  account: ConnectedAccountSummary,
  currentToken: string | null,
  now: number = Date.now(),
): Promise<EnsureFreshResult> {
  const state = classifyInstagramToken(account.tokenExpiresAt, now);
  if (state === "expired") return { state, tokenExpiresAt: account.tokenExpiresAt, accessToken: null };

  if (account.platform !== "instagram" || state !== "refresh-due" || !currentToken) {
    return { state, tokenExpiresAt: account.tokenExpiresAt, accessToken: currentToken };
  }

  const keepExisting: EnsureFreshResult = {
    state: "refresh-failed",
    tokenExpiresAt: account.tokenExpiresAt,
    accessToken: currentToken,
  };

  let refreshed;
  try {
    refreshed = await refreshInstagramLongLivedToken(currentToken);
  } catch {
    // meta-graph has already logged Meta's structured error (no token).
    console.error("Instagram token refresh failed — keeping the existing, still-valid token.");
    return keepExisting;
  }

  const { error: storeError } = await supabase.rpc("store_connected_account_credential", {
    p_connected_account_id: account.id,
    p_secret: refreshed.accessToken,
  });
  if (storeError) {
    console.error("Instagram token refresh: storing the new credential failed — keeping the existing token.");
    return keepExisting;
  }

  const newExpiresAt =
    refreshed.expiresInSeconds !== null ? new Date(now + refreshed.expiresInSeconds * 1000).toISOString() : null;
  if (newExpiresAt) {
    const { error: expiryError } = await supabase
      .from("connected_accounts")
      .update({ token_expires_at: newExpiresAt, updated_at: new Date(now).toISOString() })
      .eq("id", account.id);
    if (expiryError) {
      // The new token is stored; the old (earlier) expiry only causes one
      // more harmless refresh on the next use.
      console.error("Instagram token refresh: expiry update failed — a later use will refresh again.");
      return { state: "refreshed", tokenExpiresAt: account.tokenExpiresAt, accessToken: refreshed.accessToken };
    }
  }

  return { state: "refreshed", tokenExpiresAt: newExpiresAt ?? account.tokenExpiresAt, accessToken: refreshed.accessToken };
}

// Reconnect only when actually necessary: already expired, or refresh kept
// failing and expiry is close.
export function needsInstagramReconnect(tokenExpiresAt: string | null, now: number = Date.now()): boolean {
  const state = classifyInstagramToken(tokenExpiresAt, now);
  if (state === "expired") return true;
  return state === "refresh-due" && Date.parse(tokenExpiresAt as string) - now <= RECONNECT_WARNING_MS;
}
