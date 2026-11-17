import type { SourceCoverage } from "./diagnostics";

// The date window a discovery run is looking at. notBefore = the oldest
// publication date the caller still cares about (discover.ts: now minus
// maxAgeDays). Adapters with an archive or pagination use it to decide how
// far back to read; every adapter uses it to report whether it got there.
export type RetrievalWindow = { notBefore?: Date };

// Oldest valid ISO timestamp in a list (empty / unparsable values ignored).
export function oldestDate(dates: Array<string | undefined>): string | null {
  let oldest: number | null = null;
  for (const value of dates) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) continue;
    if (oldest === null || time < oldest) oldest = time;
  }
  return oldest === null ? null : new Date(oldest).toISOString();
}

// True when a listing whose oldest entry is `oldest` already reaches back to
// the window start — anything older was outside the window anyway. Without
// a window every read counts as complete; without any dated entry it never
// does.
export function reachesWindow(oldest: string | null, window?: RetrievalWindow): boolean {
  if (!window?.notBefore) return true;
  if (!oldest) return false;
  return new Date(oldest).getTime() <= window.notBefore.getTime();
}

// Coverage of a set of independent lists (feeds/listing pages): complete only
// when EVERY list reaches the window — one short feed is a real gap even if
// another goes back further. `since` is the most restrictive list's oldest
// entry (only after it was every list fully read); null if any list had no
// dated entry.
export function coverageOfLists(lists: Array<Array<string | undefined>>, window?: RetrievalWindow): SourceCoverage {
  const oldestPerList = lists.map((dates) => oldestDate(dates));
  const since =
    oldestPerList.length === 0 || oldestPerList.some((value) => value === null)
      ? null
      : new Date(Math.max(...oldestPerList.map((value) => new Date(value as string).getTime()))).toISOString();
  return {
    since,
    complete: lists.length > 0 && oldestPerList.every((value) => reachesWindow(value, window)),
  };
}
