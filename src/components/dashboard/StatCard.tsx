import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Stat } from "@/lib/mock-data";

export default function StatCard({ label, value, change, trend, icon: Icon }: Stat) {
  const isUp = trend === "up";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-400">{label}</span>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <div className="mt-4 flex items-end justify-between">
        <span className="text-2xl font-semibold text-white">{value}</span>
        <span
          className={`flex items-center gap-0.5 text-xs font-medium ${
            isUp ? "text-emerald-400" : "text-red-400"
          }`}
        >
          {isUp ? (
            <ArrowUpRight className="h-3.5 w-3.5" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5" />
          )}
          {change}
        </span>
      </div>
    </div>
  );
}
