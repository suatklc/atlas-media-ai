"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, X } from "lucide-react";
import { comingSoonNavItems, navItems } from "@/lib/mock-data";
import { getInitials } from "@/lib/format";
import type { AuthUser } from "@/lib/types";
import { signOutAction } from "@/app/dashboard/actions";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
  user: AuthUser;
};

const sectionIds = navItems.map((item) => item.sectionId).filter((id): id is string => Boolean(id));

// Highlights the dashboard section currently in view (the dashboard is one
// page; each menu item scrolls to its section). Falls back to the URL hash,
// then to the first item.
function useActiveSection(): [string, (id: string) => void] {
  const [active, setActive] = useState<string>(sectionIds[0] ?? "");

  useEffect(() => {
    const fromHash = () => {
      const hash = window.location.hash.slice(1);
      if (sectionIds.includes(hash)) setActive(hash);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);

    const elements = sectionIds
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0 || typeof IntersectionObserver === "undefined") {
      return () => window.removeEventListener("hashchange", fromHash);
    }

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        // The topmost visible section wins.
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (top) setActive(top[0]);
      },
      // A band just below the sticky top bar.
      { rootMargin: "-72px 0px -55% 0px" },
    );
    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      window.removeEventListener("hashchange", fromHash);
    };
  }, []);

  return [active, setActive];
}

export default function Sidebar({ open, onClose, user }: SidebarProps) {
  const [active, setActive] = useActiveSection();

  // Mobile drawer: Escape closes it, and the page behind it does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Ana menü"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-zinc-800 bg-zinc-950 transition-transform duration-200 ease-in-out lg:w-64 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="#pano" onClick={onClose} className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">
              A
            </div>
            <span className="text-base font-semibold tracking-tight text-white">Atlas AI</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white lg:hidden"
            aria-label="Menüyü kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.sectionId === active;
              return (
                <li key={item.label}>
                  <Link
                    href={item.href ?? "/dashboard"}
                    onClick={() => {
                      if (item.sectionId) setActive(item.sectionId);
                      onClose();
                    }}
                    aria-current={isActive ? "location" : undefined}
                    className={`flex min-h-12 items-center gap-3 rounded-lg border-l-2 px-3 py-3 text-[15px] font-medium transition-colors ${
                      isActive
                        ? "border-indigo-400 bg-indigo-500/15 text-white"
                        : "border-transparent text-zinc-300 hover:bg-zinc-900 hover:text-white"
                    }`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-indigo-300" : "text-zinc-400"}`} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          {comingSoonNavItems.length > 0 && (
            <div className="mt-6">
              <p className="px-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Henüz hazır değil</p>
              <ul className="mt-2 space-y-1">
                {comingSoonNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li
                      key={item.label}
                      className="flex min-h-11 cursor-not-allowed items-center gap-3 px-3 py-2.5 text-sm text-zinc-500"
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500">Yakında</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>

        <div className="border-t border-zinc-800 p-3">
          <div className="flex items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold text-white">
              {getInitials(user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{user.name}</p>
              <p className="truncate text-xs text-zinc-400">{user.email}</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white"
                aria-label="Çıkış yap"
                title="Çıkış yap"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
