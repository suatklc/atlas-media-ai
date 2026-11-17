"use client";

import { useEffect } from "react";

// Registers public/sw.js (offline screen only — see that file). Production
// builds only: in `next dev` a service worker would get in the way of hot
// reload and serve stale navigations while debugging.
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the app works the same without it, minus the offline screen.
    });
  }, []);

  return null;
}
