import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/layout/DashboardShell";
import WelcomeSection from "@/components/dashboard/WelcomeSection";
import AIAssistantPanel from "@/components/dashboard/AIAssistantPanel";
import CurrentOpportunities from "@/components/dashboard/CurrentOpportunities";
import GenerationHistory from "@/components/dashboard/GenerationHistory";
import SocialAccounts from "@/components/dashboard/SocialAccounts";

type DashboardPageProps = {
  // Next 15 async searchParams — same pattern as verify-email/page.tsx.
  // meta_connection is the one non-sensitive status param the Meta OAuth
  // callback (src/app/api/meta/callback/route.ts) actually sets today; no
  // other value is invented here.
  searchParams: Promise<{ meta_connection?: string }>;
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { meta_connection: metaConnection } = await searchParams;

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
    name: profile?.full_name || user.email?.split("@")[0] || "Kullanıcı",
    email: user.email ?? "",
  };

  return (
    <DashboardShell user={authUser}>
      <WelcomeSection name={authUser.name} />
      <div className="mx-auto max-w-5xl space-y-8">
        <CurrentOpportunities />
        <AIAssistantPanel />
        <SocialAccounts connectionStatus={metaConnection} />
        <GenerationHistory />
      </div>
    </DashboardShell>
  );
}
