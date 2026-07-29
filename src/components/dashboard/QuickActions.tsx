import { quickActions } from "@/lib/mock-data";

export default function QuickActions() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="text-sm font-semibold text-white">Quick Actions</h2>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.label}
              type="button"
              className="flex flex-col items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-4 text-center transition-colors hover:border-indigo-500/50 hover:bg-indigo-500/5"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <span className="text-xs font-medium text-zinc-300">
                {action.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
