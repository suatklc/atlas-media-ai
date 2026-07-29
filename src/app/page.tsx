import DashboardShell from "@/components/layout/DashboardShell";
import WelcomeSection from "@/components/dashboard/WelcomeSection";
import StatsGrid from "@/components/dashboard/StatsGrid";
import QuickActions from "@/components/dashboard/QuickActions";
import RecentActivity from "@/components/dashboard/RecentActivity";

export default function Home() {
  return (
    <DashboardShell>
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
