"use client";

import { useCallback, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import type { AuthUser } from "@/lib/types";

type DashboardShellProps = {
  children: React.ReactNode;
  user: AuthUser;
};

export default function DashboardShell({ children, user }: DashboardShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeNav = useCallback(() => setMobileNavOpen(false), []);

  return (
    <div className="min-h-screen overflow-x-clip bg-zinc-950">
      <Sidebar open={mobileNavOpen} onClose={closeNav} user={user} />
      <div className="lg:pl-64">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="px-4 py-5 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
