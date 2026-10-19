"use client";

import { useActionState } from "react";
import {
  publishToFacebookAction,
  runFacebookCheckAction,
  selectFacebookPageAction,
  type StatusActionState,
} from "@/app/dashboard/actions";

// Facebook Page controls — each is one explicit user action (same
// useActionState pattern as StatusAction.tsx). Nothing here runs on its own.

const initialState: StatusActionState = { error: null };
const buttonClass =
  "rounded-full border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs font-medium text-indigo-300 transition-colors hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50";

export function FacebookPublishButton({ postId, disabledReason }: { postId: string; disabledReason?: string }) {
  const [state, formAction, isPending] = useActionState(publishToFacebookAction.bind(null, postId), initialState);
  return (
    <form action={formAction} className="space-y-1">
      <button type="submit" disabled={isPending || Boolean(disabledReason)} className={`block w-full ${buttonClass}`}>
        {isPending ? "Facebook'ta paylaşılıyor…" : "Facebook'ta Paylaş"}
      </button>
      {disabledReason && <span className="block text-[11px] text-zinc-500">{disabledReason}</span>}
      {state.error && <span className="block text-xs text-red-400">{state.error}</span>}
    </form>
  );
}

export function FacebookCheckButton({ label }: { label: string }) {
  const [state, formAction, isPending] = useActionState(runFacebookCheckAction, initialState);
  return (
    <form action={formAction} className="space-y-1">
      <button type="submit" disabled={isPending} className={buttonClass}>
        {isPending ? "Test çalışıyor (herkese açık değil)…" : label}
      </button>
      {state.error && <span className="block text-xs text-red-400">{state.error}</span>}
    </form>
  );
}

export function FacebookSelectPageButton({ accountId }: { accountId: string }) {
  const [state, formAction, isPending] = useActionState(selectFacebookPageAction.bind(null, accountId), initialState);
  return (
    <form action={formAction} className="space-y-1">
      <button type="submit" disabled={isPending} className={buttonClass}>
        {isPending ? "…" : "Bu Sayfayı Seç"}
      </button>
      {state.error && <span className="block text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
