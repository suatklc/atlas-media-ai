import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/layout/DashboardShell";
import WelcomeSection from "@/components/dashboard/WelcomeSection";
import StatsGrid from "@/components/dashboard/StatsGrid";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";

export default async function DashboardPage() {
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
      <WelcomeSection />
      <div className="space-y-6">
        <StatsGrid />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <QuickActions />
          <div className="lg:col-span-2">
            <RecentActivity />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
