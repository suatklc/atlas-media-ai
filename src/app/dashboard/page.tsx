import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/layout/DashboardShell";
import WelcomeSection from "@/components/dashboard/WelcomeSection";
import AIAssistantPanel from "@/components/dashboard/AIAssistantPanel";
import CurrentOpportunities from "@/components/dashboard/CurrentOpportunities";
import GenerationHistory from "@/components/dashboard/GenerationHistory";
import SocialAccounts from "@/components/dashboard/SocialAccounts";

// Welcome/profile display-name fix: the dashboard was showing the raw
// email-local-part fallback ("suatklc3625") because the resolution logic
// only ever checked the separate `profiles.full_name` column, which is
// empty for this account — it never looked at Supabase Auth's OWN
// user_metadata (populated at signup: see register/actions.ts's
// `signUp({ ..., options: { data: { full_name: fullName } } })`), which is
// the real source of truth for "the name the user typed when they signed
// up." Priority, per the Gold Standard brief: (1) auth user_metadata
// full_name/name, (2) the separate profiles table's full_name, (3) a
// small, explicit, single-account fallback (NOT a blind hardcode — scoped
// to this one known production account, only reached if neither of the
// above resolved anything), (4) the previous generic email-prefix
// fallback, unchanged as the final safety net for any other account.
// The "Instagram'da Paylaş" server action runs in this route: a carousel
// publish creates 5 child containers + 1 carousel container and waits for
// Meta to finish processing each before media_publish (~10-30 s live).
// 60 s is within every Vercel plan's limit.
export const maxDuration = 60;

const KNOWN_ACCOUNT_DISPLAY_NAMES: Record<string, string> = {
  "suatklc3625@gmail.com": "Suat Kılıç",
};

function resolveDisplayName(user: User, profileFullName: string | null | undefined): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metadataFullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const metadataName = typeof metadata.name === "string" ? metadata.name.trim() : "";
  const trimmedProfileName = typeof profileFullName === "string" ? profileFullName.trim() : "";
  const knownAccountName = user.email ? KNOWN_ACCOUNT_DISPLAY_NAMES[user.email] : undefined;

  return metadataFullName || metadataName || trimmedProfileName || knownAccountName || user.email?.split("@")[0] || "Kullanıcı";
}

type DashboardPageProps = {
  // Next 15 async searchParams — same pattern as verify-email/page.tsx.
  // meta_connection is the one non-sensitive status param the Meta OAuth
  // callback (src/app/api/meta/callback/route.ts) actually sets today; no
  // other value is invented here.
  searchParams: Promise<{ meta_connection?: string; facebook_connection?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { meta_connection: metaConnection, facebook_connection: facebookConnection } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  const authUser = {
    name: resolveDisplayName(user, profile?.full_name),
    email: user.email ?? "",
  };

  return (
    <DashboardShell user={authUser}>
      <div className="mx-auto max-w-5xl">
        <WelcomeSection name={authUser.name} />
        <div className="space-y-6">
          <CurrentOpportunities />
          <AIAssistantPanel />
          <SocialAccounts connectionStatus={metaConnection} facebookStatus={facebookConnection} />
          <GenerationHistory />
        </div>
      </div>
    </DashboardShell>
  );
}
