import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectedAccountSummary, MetaConnectionPlatform } from "./types";

// Server-only. Takes the caller's own authenticated Supabase client (the
// same request-scoped session pattern used everywhere else in this
// pipeline — see src/lib/supabase/server.ts, storage.ts) — deliberately no
// service-role key, RLS enforces ownership the same way it does for every
// other table.

// Explicit column allowlist — credential_secret_id is selected only to
// derive the boolean hasCredential below, then discarded; it is never
// included in the returned summary. access_token_plaintext no longer
// exists in the schema at all (see 0003_connected_accounts.sql). This is
// meant to be the ONLY function that ever reads connected_accounts for
// anything that could reach client-rendered UI; any future UI must go
// through this function, never a raw select("*").
export async function listConnectedMetaAccounts(
  supabase: SupabaseClient,
  userId: string,
): Promise<ConnectedAccountSummary[]> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id, provider, platform, external_account_id, external_account_name, token_expires_at, credential_secret_id")
    .eq("user_id", userId)
    .eq("provider", "meta");

  if (error) {
    console.error("Connected accounts query error:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    platform: row.platform,
    externalAccountId: row.external_account_id,
    externalAccountName: row.external_account_name,
    tokenExpiresAt: row.token_expires_at,
    hasCredential: row.credential_secret_id !== null,
  }));
}

export type UpsertConnectedMetaAccountInput = {
  userId: string;
  platform: MetaConnectionPlatform;
  externalAccountId: string;
  externalAccountName?: string | null;
  // Transient — held in server memory for the duration of this call only.
  // Never written directly into connected_accounts; passed through to the
  // Vault-backed store_connected_account_credential() RPC in the second
  // step below, and never logged.
  accessToken: string;
  tokenExpiresAt?: string | null;
};

export type UpsertConnectedMetaAccountResult =
  | { success: true }
  | { success: false; error: string };

// Not called from anywhere live yet — the OAuth callback that would call
// this (src/app/api/meta/callback/route.ts) intentionally stops before
// ever reaching a real token, per Handoff 6 Step 5's scope. Two-step by
// design: (1) upsert only the non-secret identity/metadata fields into
// connected_accounts, (2) store the credential itself exclusively through
// the store_connected_account_credential() Vault RPC — never merged into a
// single write, so the raw token is never part of the row payload at any
// point. No plaintext fallback: if step 2 fails, the function returns
// success:false rather than ever writing the token anywhere else.
export async function upsertConnectedMetaAccount(
  supabase: SupabaseClient,
  input: UpsertConnectedMetaAccountInput,
): Promise<UpsertConnectedMetaAccountResult> {
  const { data, error } = await supabase
    .from("connected_accounts")
    .upsert(
      {
        user_id: input.userId,
        provider: "meta",
        platform: input.platform,
        external_account_id: input.externalAccountId,
        external_account_name: input.externalAccountName ?? null,
        token_expires_at: input.tokenExpiresAt ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider,platform,external_account_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    console.error("Connected account upsert error:", error);
    return { success: false, error: "Bağlı hesap kaydedilemedi." };
  }

  const { error: credentialError } = await supabase.rpc("store_connected_account_credential", {
    p_connected_account_id: data.id,
    p_secret: input.accessToken,
  });

  if (credentialError) {
    console.error("Connected account credential storage error:", credentialError);
    return { success: false, error: "Kimlik bilgisi güvenli şekilde saklanamadı." };
  }

  return { success: true };
}

export type DisconnectAccountResult = { success: true } | { success: false; error: string };

// Removes both the connected_accounts row and its Vault secret (via the
// disconnect_connected_account() RPC, which performs both deletions
// together, ownership-checked). Not wired into any UI in this task — ready
// for a future "Disconnect" control.
export async function disconnectAccount(
  supabase: SupabaseClient,
  connectedAccountId: string,
): Promise<DisconnectAccountResult> {
  const { error } = await supabase.rpc("disconnect_connected_account", {
    p_connected_account_id: connectedAccountId,
  });

  if (error) {
    console.error("Disconnect account error:", error);
    return { success: false, error: "Bağlantı kaldırılamadı." };
  }
  return { success: true };
}
