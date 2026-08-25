"use client";

import { useActionState } from "react";
import { updatePostStatus, publishApprovedPost, type StatusActionState } from "@/app/dashboard/actions";

const STATUS_LABELS: Record<string, string> = {
  draft: "Taslak",
  approved: "Onaylandı",
  posted: "Paylaşıldı",
};

const initialState: StatusActionState = { error: null };

// Isolated to just this one control so the surrounding GenerationHistory
// card stays a plain Server Component — useActionState/isPending is the
// smallest standard mechanism for reflecting a mutation's result without a
// manual page reload or a client-side data-fetching layer.
//
// The "approved" state's button now triggers a REAL Instagram publish
// (publishApprovedPost), not a status label flip — status only reaches
// "posted" once Meta has actually confirmed the post. draft→approved is
// still the simple, reversible-in-effect status update.
export default function StatusAction({ postId, status }: { postId: string; status: string }) {
  const nextStatus = status === "draft" ? "approved" : status === "approved" ? "posted" : null;
  const boundAction =
    status === "draft"
      ? updatePostStatus.bind(null, postId, "approved")
      : status === "approved"
        ? publishApprovedPost.bind(null, postId)
        : null;

  const [state, formAction, isPending] = useActionState(
    boundAction ?? (async (prev: StatusActionState) => prev),
    initialState,
  );

  const label = STATUS_LABELS[status] ?? status;
  const buttonLabel = status === "draft" ? "Onayla" : "Instagram'da Paylaş";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-400">
        {label}
      </span>

      {nextStatus && boundAction && (
        <form action={formAction}>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-medium text-indigo-300 transition-colors hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "..." : buttonLabel}
          </button>
        </form>
      )}

      {state.error && <span className="text-[10px] text-red-400">{state.error}</span>}
    </div>
  );
}
