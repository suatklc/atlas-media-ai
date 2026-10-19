"use client";

import { useActionState } from "react";
import { updatePostStatus, type StatusActionState } from "@/app/dashboard/actions";

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  approved: "Onaylandı",
  // generated_posts.status "posted" = published to Instagram (the original
  // lifecycle); Facebook has its own per-platform result in PublishPanel.
  posted: "Onaylandı · Instagram'da paylaşıldı",
};

const initialState: StatusActionState = { error: null };

// Isolated to just this one control so the surrounding GenerationHistory
// card stays a plain Server Component — useActionState/isPending is the
// smallest standard mechanism for reflecting a mutation's result without a
// manual page reload or a client-side data-fetching layer.
//
// Only the explicit approval lives here (draft -> approved). Publishing is
// a separate, explicit step: PublishPanel's "Seçili Platformlarda Yayınla",
// where Suat ticks Instagram and/or Facebook — approving never publishes.
export default function StatusAction({ postId, status }: { postId: string; status: string }) {
  const [state, formAction, isPending] = useActionState(
    status === "draft" ? updatePostStatus.bind(null, postId, "approved") : async (prev: StatusActionState) => prev,
    initialState,
  );

  return (
    <div className="mt-2 space-y-1.5">
      <span className="inline-block rounded-full border border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300">
        {STATUS_LABELS[status] ?? status}
      </span>

      {status === "draft" && (
        <form action={formAction}>
          {/* Comfortable tap target — block + generous padding, still fits
              the existing compact history-card width. */}
          <button
            type="submit"
            disabled={isPending}
            className="block w-full rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "..." : "Onayla"}
          </button>
        </form>
      )}

      {state.error && <span className="text-xs text-red-400">{state.error}</span>}
    </div>
  );
}
