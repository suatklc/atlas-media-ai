import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only. NEVER import this from a "use client" component, and never
// serialize its return value into any response a browser can read.
//
// The ONLY sanctioned way anywhere in this codebase to obtain a decrypted
// publishing credential. Takes a connected_accounts id, never a raw Vault
// secret id — the actual enforcement boundary is the database function
// itself (get_connected_account_credential() in
// 0003_connected_accounts.sql), a SECURITY DEFINER function that
// re-verifies auth.uid() = user_id on the target row before ever touching
// vault.decrypted_secrets. This wrapper adds a clean, typed call site; it
// adds no security beyond what the RPC already guarantees, and removes
// none of it either.
//
// Returns null uniformly for "not found", "not owned by the current
// session", and "no credential stored yet" — the database function itself
// already collapses these into one outcome so this boundary can't be used
// to probe whether an id belongs to someone else.
//
// Not called from anywhere yet — this is the retrieval boundary a future
// live-publishing task will use when it actually calls the Meta Graph API.
// Wiring it into a real publish call is explicitly out of scope here.
export async function getConnectedAccountCredential(
  supabase: SupabaseClient,
  connectedAccountId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_connected_account_credential", {
    p_connected_account_id: connectedAccountId,
  });

  if (error) {
    // Never logs connectedAccountId's associated secret (it was never
    // retrieved) or any part of the Supabase error payload that could
    // contain row data — only a fixed message.
    console.error("Credential retrieval error.");
    return null;
  }

  return typeof data === "string" && data.length > 0 ? data : null;
}
