"use client";

import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

type NotificationItem = {
  id: string;
  kind: "draft_ready" | "run_failed";
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

// The dashboard bell (Automation V1): the dot shows only when there are
// unread notifications; opening the list marks them read; an item links to
// its draft (/dashboard#draft-<id>).
export default function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) throw new Error("load failed");
      const data = (await response.json()) as { notifications: NotificationItem[]; unread: number };
      setItems(data.notifications);
      setUnread(data.unread);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setUnread(0);
      await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white"
        aria-label={unread > 0 ? `Bildirimler (${unread} okunmamış)` : "Bildirimler"}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-2.5 top-2.5 h-2.5 w-2.5 rounded-full bg-indigo-400 ring-2 ring-zinc-950" />}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl">
          <p className="border-b border-zinc-800 px-4 py-2.5 text-sm font-medium text-white">Bildirimler</p>
          {loadError ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Bildirimler şu anda yüklenemedi.</p>
          ) : items.length === 0 ? (
            <p className="px-4 py-3 text-sm text-zinc-400">Henüz bildirim yok.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-zinc-800 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <a href={item.link ?? "/dashboard"} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-zinc-900">
                    <p className={`text-sm font-medium ${item.kind === "run_failed" ? "text-red-300" : "text-white"}`}>{item.title}</p>
                    {item.body && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{item.body}</p>}
                    <p className="mt-1 text-xs text-zinc-500">
                      {new Date(item.created_at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
