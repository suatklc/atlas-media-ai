"use client";

import { useState } from "react";

type ExportActionsProps = {
  postId: string;
  content: string;
  finalImageUrl: string;
};

type CopyState = "idle" | "copied" | "error";
type DownloadState = "idle" | "downloading" | "error";

// Separate, small client component from StatusAction — copy/download are
// pure client-side operations (clipboard + fetch→Blob), no Server Action or
// server round-trip needed, so there's no reason to share that mechanism.
export default function ExportActions({ postId, content, finalImageUrl }: ExportActionsProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");

  async function handleCopy() {
    try {
      // The full stored caption, exactly as persisted — never the truncated
      // card preview, never regenerated/rewritten.
      await navigator.clipboard.writeText(content);
      setCopyState("copied");
      setTimeout(() => setCopyState((s) => (s === "copied" ? "idle" : s)), 2000);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState((s) => (s === "error" ? "idle" : s)), 3000);
    }
  }

  async function handleDownload() {
    if (downloadState === "downloading") {
      return;
    }
    setDownloadState("downloading");

    let objectUrl: string | null = null;
    try {
      // fetch→Blob→object URL, not the raw <a download> attribute on the
      // cross-origin Supabase URL directly: Storage doesn't send a
      // Content-Disposition: attachment header, so browsers were opening
      // the image instead of saving it. A blob: URL is same-origin to the
      // page, so `download` on it is honored reliably. CORS was confirmed
      // permissive (Access-Control-Allow-Origin: *) before choosing this.
      const response = await fetch(finalImageUrl);
      if (!response.ok) {
        throw new Error("download failed");
      }
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `atlas-post-${postId.slice(0, 8)}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setDownloadState("idle");
    } catch {
      setDownloadState("error");
      setTimeout(() => setDownloadState((s) => (s === "error" ? "idle" : s)), 3000);
    } finally {
      if (objectUrl) {
        const urlToRevoke = objectUrl;
        // Slight delay so the browser has started the download before the
        // object URL is revoked.
        setTimeout(() => URL.revokeObjectURL(urlToRevoke), 1000);
      }
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={handleCopy}
        className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300"
      >
        {copyState === "copied" ? "Kopyalandı" : copyState === "error" ? "Kopyalanamadı" : "Caption'ı Kopyala"}
      </button>

      <button
        type="button"
        onClick={handleDownload}
        disabled={downloadState === "downloading"}
        className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[10px] font-medium text-zinc-300 transition-colors hover:border-indigo-500/40 hover:text-indigo-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {downloadState === "downloading"
          ? "İndiriliyor…"
          : downloadState === "error"
            ? "İndirilemedi"
            : "Görseli İndir"}
      </button>
    </div>
  );
}
