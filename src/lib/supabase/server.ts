import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Automation V1: the scheduled run (/api/cron/daily-content) reuses the
// existing content-plan / content-package / generate-visual handlers
// unchanged. Inside runAsAutomationUser — entered only by that cron route
// after its CRON_SECRET check — createClient() returns the given
// server-side client acting as that one user instead of reading the
// (absent) browser session. Every other request is unaffected.
// `client` must be a client created for this run only (createAdminClient):
// its auth.getUser is pinned to the automation user.
const automationSession = new AsyncLocalStorage<{ client: SupabaseClient; userId: string }>();

export function runAsAutomationUser<T>(client: SupabaseClient, userId: string, fn: () => Promise<T>): Promise<T> {
  const user = { id: userId };
  client.auth.getUser = (async () => ({ data: { user }, error: null })) as unknown as typeof client.auth.getUser;
  return automationSession.run({ client, userId }, fn);
}

// The automation user's id while inside runAsAutomationUser (cron or the
// Telegram webhook, both after their own authorization), otherwise
// undefined. Used where a database function needs the owner id explicitly
// because the server client has no auth.uid() (connections/credentials.ts).
export function currentAutomationUserId(): string | undefined {
  return automationSession.getStore()?.userId;
}

export async function createClient(): Promise<ReturnType<typeof createCookieClient>> {
  const automation = automationSession.getStore();
  if (automation) {
    return automation.client as unknown as ReturnType<typeof createCookieClient>;
  }
  return createCookieClient(await cookies());
}

function createCookieClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component during render — safe to ignore
            // because middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
