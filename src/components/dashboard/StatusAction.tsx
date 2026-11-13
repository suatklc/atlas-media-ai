"use client";

import { useActionState } from "react";
import { rejectPostAction, updatePostStatus, type StatusActionState } from "@/app/dashboard/actions";

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
  // "Reddet" (Automation V1): marks the draft rejected; never publishes.
  const [rejectState, rejectAction, isRejecting] = useActionState(
    status === "draft" ? rejectPostAction.bind(null, postId) : async (prev: StatusActionState) => prev,
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
            className="block min-h-11 w-full rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-sm font-medium text-indigo-200 transition-colors hover:border-indigo-500/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Onaylanıyor…" : "Onayla"}
          </button>
        </form>
      )}

      {status === "draft" && (
        <form action={rejectAction}>
          <button
            type="submit"
            disabled={isRejecting || isPending}
            className="block min-h-11 w-full rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-red-500/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRejecting ? "Reddediliyor…" : "Reddet"}
          </button>
        </form>
      )}

      {state.error && <span className="block text-sm text-red-400">{state.error}</span>}
      {rejectState.error && <span className="block text-sm text-red-400">{rejectState.error}</span>}
    </div>
  );
}
