"use client";

import { createClient } from "@/lib/supabase/client";

async function signInWithGoogle() {
  const supabase = createClient();
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
  });
}

export default function SocialButtons() {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={signInWithGoogle}
        className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-base font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        <GoogleIcon className="h-[18px] w-[18px]" />
        Google ile devam et
      </button>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.94-2.9l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.28v3.1C3.26 21.3 7.3 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.31A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.58.38-2.31v-3.1H1.28A11.97 11.97 0 0 0 0 12c0 1.93.46 3.76 1.28 5.41l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.3 0 3.26 2.7 1.28 6.59l4 3.1c.95-2.83 3.6-4.94 6.72-4.94z"
      />
    </svg>
  );
}
