// TEMPORARY Radar diagnostics (Handoff 9): production returned fewer
// property topics than the same code locally, and several adapter failures
// are swallowed silently. These lines make each stage observable in the
// Vercel runtime log, searchable by the "[radar-diag]" prefix.
//
// Counts, durations and safe error kinds ONLY — never a cookie, token,
// request body or article text. Removing this module and its call sites
// restores the previous behavior exactly; nothing here changes what is
// fetched, filtered, ranked or returned.

export function radarDiag(event: string, data: Record<string, unknown>): void {
  try {
    if (typeof console !== "undefined" && typeof console.log === "function") {
      console.log(`[radar-diag] ${event} ${JSON.stringify(data)}`);
    }
  } catch {
    // Diagnostics must never affect the pipeline.
  }
}

// "AbortError", "TypeError:ECONNRESET", "Error:request failed with status 403"
// — the error's class, network code when present, and (for this codebase's
// own short Error messages) the message, capped. Never a URL or body.
export function errorKind(error: unknown): string {
  const value = error as { name?: unknown; code?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
  const name = typeof value?.name === "string" ? value.name : typeof error;
  const code = value?.cause?.code ?? value?.code;
  if (typeof code === "string") return `${name}:${code}`;
  if (name === "Error" && typeof value?.message === "string") {
    return `${name}:${value.message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 80)}`;
  }
  return name;
}

// Adapters catch their own failures and return [] (so one source can never
// break discovery). They report each swallowed failure here, so the router
// logs the real status ("error" / "partial") instead of "ok". Optional:
// callers that pass nothing (tests, other code) see no change at all.
export type AdapterReport = { fail: (kind: string) => void };

// Increments a counter map in place ({ "AbortError": 2, ... }).
export function tally(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
