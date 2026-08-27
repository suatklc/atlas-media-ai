"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import type { AuthUser } from "@/lib/types";

type DashboardShellProps = {
  children: React.ReactNode;
  user: AuthUser;
};

export default function DashboardShell({ children, user }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} user={user} />
      <div className="lg:pl-60">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} user={user} />
        <main className="p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
