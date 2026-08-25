import { createClient } from "@/lib/supabase/server";
import { listConnectedMetaAccounts } from "@/lib/publishing/connections/query";
import { PLATFORM_CONFIGS } from "@/lib/ai/platform/config";

type SocialAccountsProps = {
  connectionStatus?: string;
};

// Server Component, self-contained like GenerationHistory — fetches its own
// user + rows rather than receiving them from dashboard/page.tsx. Reads
// connected_accounts ONLY through listConnectedMetaAccounts (query.ts), the
// one sanctioned safe-summary query — never a second/raw select here. Must
// never throw — a load failure renders the same quiet "no accounts" state
// rather than breaking the rest of the dashboard.
export default async function SocialAccounts({ connectionStatus }: SocialAccountsProps) {
  let accounts: Awaited<ReturnType<typeof listConnectedMetaAccounts>> = [];

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      accounts = await listConnectedMetaAccounts(supabase, user.id);
    }
  } catch (error) {
    console.error("Social accounts load exception:", error);
  }

  return (
    <section className="animate-fade-up rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Bağlı Hesaplar</h2>
        <a
          href="/api/meta/connect"
          className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-500/70 hover:bg-indigo-500/20"
        >
          Instagram / Facebook Bağla
        </a>
      </div>

      {connectionStatus === "success" && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Meta hesabınız başarıyla bağlandı.
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Bağlı hesap yok.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-300">
                  {PLATFORM_CONFIGS[account.platform].label}
                </span>
                <span className="text-xs text-zinc-300">
                  {account.externalAccountName ?? account.externalAccountId}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[10px] font-medium">
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Bağlı
                </span>
                <span className={account.hasCredential ? "text-zinc-500" : "text-amber-400"}>
                  {account.hasCredential ? "Kimlik bilgisi kayıtlı" : "Kimlik bilgisi eksik"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
