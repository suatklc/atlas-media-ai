"use client";

import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";

// Chrome/Edge/Samsung Internet event; not in TypeScript's DOM lib.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "atlas-install-dismissed-at";
const DISMISS_DAYS = 14;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari home-screen apps
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as Mac; touch points tell them apart.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function recentlyDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// Mobile-only hint to add Atlas to the home screen. Never shown inside the
// installed app, on desktop-sized screens, or again for 14 days after
// "Şimdi değil". Android/Chrome gets the browser's own install dialog;
// iOS (no install API) gets the two-step Share → "Ana Ekrana Ekle" hint.
export default function InstallPrompt() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px) and (pointer: coarse)").matches;
    if (!mobile || isStandalone() || recentlyDismissed()) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setMode("android");
    };
    const onInstalled = () => {
      setMode(null);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no beforeinstallprompt; show the manual hint after a moment
    // so it does not cover the page while it is still loading.
    const timer = isIos() ? window.setTimeout(() => setMode("ios"), 1500) : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage unavailable (private mode): just hide for this visit.
    }
    setMode(null);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === "accepted") setMode(null);
    else dismiss();
  }

  if (!mode) return null;

  return (
    <div
      role="dialog"
      aria-label="Atlas'ı ana ekrana ekle"
      className="fixed inset-x-3 bottom-3 z-40 rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl lg:hidden"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-base font-bold text-white">
          A
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">Atlas&apos;ı telefonunuza ekleyin</p>
          {mode === "android" ? (
            <p className="mt-1 text-sm text-zinc-300">Ana ekrandan tek dokunuşla, tam ekran açılır.</p>
          ) : (
            <p className="mt-1 text-sm text-zinc-300">
              Safari&apos;de Paylaş <Share className="inline h-4 w-4 align-[-2px]" aria-hidden="true" /> menüsünü açın,{" "}
              <span className="whitespace-nowrap font-medium text-white">
                <SquarePlus className="inline h-4 w-4 align-[-2px]" aria-hidden="true" /> Ana Ekrana Ekle
              </span>
              &apos;ye dokunun.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Kapat"
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-3 flex gap-2">
        {mode === "android" && (
          <button
            type="button"
            onClick={install}
            className="min-h-11 flex-1 rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            Uygulamayı Yükle
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 flex-1 rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500"
        >
          Şimdi değil
        </button>
      </div>
    </div>
  );
}
