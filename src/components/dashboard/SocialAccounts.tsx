import { createClient } from "@/lib/supabase/server";
import { listConnectedMetaAccounts } from "@/lib/publishing/connections/query";
import { PLATFORM_CONFIGS } from "@/lib/ai/platform/config";
import { getConnectedAccountCredential } from "@/lib/publishing/connections/credentials";
import {
  classifyInstagramToken,
  ensureFreshInstagramToken,
  needsInstagramReconnect,
} from "@/lib/publishing/connections/tokenLifecycle";
import type { ConnectedAccountSummary } from "@/lib/publishing/connections/types";
import { FacebookCheckButton, FacebookSelectPageButton } from "./FacebookActions";

type SocialAccountsProps = {
  connectionStatus?: string;
  // facebook_connection status from /api/facebook/callback (non-sensitive code).
  facebookStatus?: string;
};

// Server Component, self-contained like GenerationHistory — fetches its own
// user + rows rather than receiving them from dashboard/page.tsx. Reads
// connected_accounts ONLY through listConnectedMetaAccounts (query.ts), the
// one sanctioned safe-summary query — never a second/raw select here. Must
// never throw — a load failure renders the same quiet "no accounts" state
// rather than breaking the rest of the dashboard.
export default async function SocialAccounts({ connectionStatus, facebookStatus }: SocialAccountsProps) {
  let accounts: Awaited<ReturnType<typeof listConnectedMetaAccounts>> = [];

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      accounts = await listConnectedMetaAccounts(supabase, user.id);
      // Refresh-on-use: a dashboard visit refreshes an Instagram token that
      // is within its refresh window (see tokenLifecycle.ts). The credential
      // is only decrypted when a refresh is actually due.
      for (const account of accounts) {
        if (account.platform !== "instagram" || classifyInstagramToken(account.tokenExpiresAt) !== "refresh-due") continue;
        const token = await getConnectedAccountCredential(supabase, account.id);
        const fresh = await ensureFreshInstagramToken(supabase, account, token);
        account.tokenExpiresAt = fresh.tokenExpiresAt;
      }
    }
  } catch (error) {
    console.error("Social accounts load exception:", error);
  }

  return (
    <section className="animate-fade-up rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Bağlı Hesaplar</h2>
        <a
          href="/api/meta/connect"
          className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-4 py-2 text-sm font-medium text-indigo-300 transition-colors hover:border-indigo-500/70 hover:bg-indigo-500/20"
        >
          Instagram Bağla
        </a>
      </div>

      {connectionStatus === "success" && (
        <p className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
          Meta hesabınız başarıyla bağlandı.
        </p>
      )}

      {accounts.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400">Bağlı hesap yok.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {/* Facebook Pages are shown once, in FacebookPageBlock below —
              listing them here too rendered the same Page twice. */}
          {accounts.filter((account) => account.platform !== "facebook").map((account) => (
            <li
              key={account.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-3"
            >
              <div className="flex items-center gap-2">
                <span className="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300">
                  {PLATFORM_CONFIGS[account.platform].label}
                </span>
                <span className="text-sm text-zinc-300">
                  {account.externalAccountName ?? account.externalAccountId}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs font-medium">
                {account.platform === "instagram" && needsInstagramReconnect(account.tokenExpiresAt) ? (
                  <a
                    href="/api/meta/connect"
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300 hover:border-amber-500/70"
                  >
                    {classifyInstagramToken(account.tokenExpiresAt) === "expired"
                      ? "Bağlantı süresi doldu — Yeniden Bağla"
                      : "Bağlantı yakında sona eriyor — Yeniden Bağla"}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Bağlı
                  </span>
                )}
                <span className={account.hasCredential ? "text-zinc-400" : "text-amber-400"}>
                  {account.hasCredential ? "Kimlik bilgisi kayıtlı" : "Kimlik bilgisi eksik"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <FacebookPageBlock accounts={accounts} status={facebookStatus} />
    </section>
  );
}

const FACEBOOK_STATUS_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  success: { tone: "ok", text: "Facebook Sayfanız bağlandı." },
  select_page: { tone: "ok", text: "Facebook bağlandı. Paylaşım yapılacak Sayfayı aşağıdan seçin." },
  denied: { tone: "error", text: "Facebook yetkilendirmesi iptal edildi. Instagram bağlantınız etkilenmedi." },
  invalid_state: { tone: "error", text: "Facebook bağlantı isteğinin süresi doldu. Lütfen tekrar deneyin." },
  invalid_callback: { tone: "error", text: "Facebook bağlantısı tamamlanamadı. Lütfen tekrar deneyin." },
  not_configured: { tone: "error", text: "Facebook uygulama bilgileri sunucuda yapılandırılmamış." },
  token_error: { tone: "error", text: "Facebook erişim izni alınamadı. Lütfen tekrar deneyin." },
  no_pages: { tone: "error", text: "Yönettiğiniz ve paylaşım yapabileceğiniz bir Facebook Sayfası bulunamadı." },
  storage_error: { tone: "error", text: "Facebook bağlantısı kaydedilemedi. Lütfen tekrar deneyin." },
};

// Facebook Page destination (Facebook Login for Business) — separate from
// the Instagram connection above. Connect → (select Page) → run the
// non-public multi-photo check → "Facebook'ta Paylaş" on approved posts.
function FacebookPageBlock({ accounts, status }: { accounts: ConnectedAccountSummary[]; status?: string }) {
  const pages = accounts.filter((account) => account.platform === "facebook");
  const selected = pages.find((page) => page.selected && page.hasCredential);
  const message = status ? FACEBOOK_STATUS_MESSAGES[status] : undefined;
  const check = selected?.multiPhotoCheck;

  return (
    <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-300">
            Facebook
          </span>
          <span className="text-sm text-zinc-300">{selected ? selected.externalAccountName ?? selected.externalAccountId : "Sayfa bağlı değil"}</span>
        </div>
        <a
          href="/api/facebook/connect"
          className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-300 hover:border-indigo-500/70"
        >
          {pages.length > 0 ? "Facebook'u Yeniden Bağla" : "Facebook Bağla"}
        </a>
      </div>

      {message && (
        <p className={`mt-3 text-xs ${message.tone === "ok" ? "text-emerald-300" : "text-red-400"}`}>{message.text}</p>
      )}

      {!selected && pages.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pages.map((page) => (
            <li key={page.id} className="flex items-center justify-between gap-2 text-sm text-zinc-300">
              <span>{page.externalAccountName ?? page.externalAccountId}</span>
              {page.hasCredential ? (
                <FacebookSelectPageButton accountId={page.id} />
              ) : (
                <span className="text-xs text-amber-400">Kimlik bilgisi eksik — yeniden bağlayın</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className={check?.ok ? "text-emerald-400" : check ? "text-amber-400" : "text-zinc-400"}>
            {check?.ok
              ? `Çoklu görsel testi geçti (${check.count} görsel, sıra korunuyor)`
              : check
                ? `Çoklu görsel testi başarısız: ${check.error ?? "bilinmeyen hata"}`
                : "Carousel paylaşımı için çoklu görsel testi gerekli (herkese açık gönderi oluşturmaz)"}
          </span>
          <FacebookCheckButton label={check ? "Testi Tekrar Çalıştır" : "Çoklu Görsel Testini Çalıştır"} />
        </div>
      )}
    </div>
  );
}
