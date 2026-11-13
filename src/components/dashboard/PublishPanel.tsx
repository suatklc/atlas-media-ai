"use client";

import { useActionState, useState } from "react";
import { publishSelectedPlatformsAction, type PublishPanelState } from "@/app/dashboard/actions";

// The single explicit publish step for an APPROVED post. Nothing is
// pre-selected: Suat ticks the destinations (only connected, ready, not yet
// published platforms can be ticked), sees what each will publish, and
// presses "Seçili Platformlarda Yayınla". Results are shown per platform.

export type PlatformPanelInfo = {
  // Why it can't be selected (not connected, already published, ...); null = selectable.
  unavailable: string | null;
  // Current per-platform state from the post row.
  status: "published" | "failed" | "pending";
  failureMessage?: string;
  preview: string;
  account?: string;
};

const LABELS = { instagram: "Instagram", facebook: "Facebook" } as const;
type Platform = keyof typeof LABELS;

const initialState: PublishPanelState = { error: null, results: [] };

const STATUS_TEXT: Record<PlatformPanelInfo["status"], string> = {
  published: "Paylaşıldı",
  failed: "Başarısız",
  pending: "Paylaşılmadı",
};

export default function PublishPanel({ postId, platforms }: { postId: string; platforms: Record<Platform, PlatformPanelInfo> }) {
  const [ticked, setSelected] = useState<Platform[]>([]);
  // A platform that became unavailable (e.g. just published) drops out.
  const selected = ticked.filter((platform) => !platforms[platform].unavailable);
  const [state, formAction, isPending] = useActionState(publishSelectedPlatformsAction.bind(null, postId), initialState);
  const toggle = (platform: Platform, on: boolean) =>
    setSelected((current) => (on ? [...current.filter((p) => p !== platform), platform] : current.filter((p) => p !== platform)));

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-lg border border-zinc-800 p-2.5">
      <p className="text-xs font-semibold text-zinc-200">Yayınlanacak platformlar</p>
      {(Object.keys(LABELS) as Platform[]).map((platform) => {
        const info = platforms[platform];
        return (
          <div key={platform} className="space-y-1">
            <label className={`flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm ${info.unavailable ? "cursor-not-allowed text-zinc-500" : "cursor-pointer text-zinc-100"}`}>
              <input
                type="checkbox"
                name="platform"
                value={platform}
                disabled={Boolean(info.unavailable) || isPending}
                checked={selected.includes(platform)}
                onChange={(event) => toggle(platform, event.target.checked)}
                className="h-5 w-5 shrink-0 accent-indigo-500"
              />
              <span className="font-medium">{LABELS[platform]}</span>
              {info.account && <span className="min-w-0 truncate text-xs text-zinc-400">· {info.account}</span>}
              <span
                className={`ml-auto text-xs ${info.status === "published" ? "text-emerald-400" : info.status === "failed" ? "text-red-400" : "text-zinc-500"}`}
              >
                {STATUS_TEXT[info.status]}
              </span>
            </label>
            {info.unavailable && <p className="pl-7 text-xs text-zinc-400">{info.unavailable}</p>}
            {info.status === "failed" && info.failureMessage && <p className="pl-7 text-xs text-red-400">{info.failureMessage}</p>}
            {!info.unavailable && (
              <details className="pl-7">
                <summary className="flex min-h-10 cursor-pointer items-center text-xs text-indigo-300">{LABELS[platform]} metnini gör</summary>
                <p className="mt-1 max-h-60 overflow-y-auto whitespace-pre-line break-words text-xs text-zinc-300">{info.preview}</p>
              </details>
            )}
          </div>
        );
      })}

      <p className="text-xs text-zinc-400">
        {selected.length > 0 ? `Seçili: ${selected.map((p) => LABELS[p]).join(", ")} · 5 görsel, sırasıyla` : "Henüz platform seçilmedi."}
      </p>
      <button
        type="submit"
        disabled={isPending || selected.length === 0}
        className="block min-h-11 w-full rounded-full border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-sm font-medium text-indigo-200 transition-colors hover:border-indigo-500/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Yayınlanıyor…" : "Seçili Platformlarda Yayınla"}
      </button>

      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      {state.results.length > 0 && (
        <ul className="space-y-0.5 text-sm">
          {state.results.map((result) => (
            <li key={result.platform} className={result.status === "failed" ? "text-red-400" : "text-emerald-400"}>
              {LABELS[result.platform]} — {result.status === "failed" ? `Başarısız: ${result.message}` : result.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
