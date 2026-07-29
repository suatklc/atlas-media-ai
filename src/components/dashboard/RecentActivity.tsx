import { recentActivity } from "@/lib/mock-data";

export default function RecentActivity() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
        <a
          href="#"
          className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
        >
          View all
        </a>
      </div>
      <ul className="mt-4 divide-y divide-zinc-800">
        {recentActivity.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{item.title}</p>
                <p className="truncate text-xs text-zinc-500">
                  {item.description}
                </p>
              </div>
              <span className="shrink-0 text-xs text-zinc-500">{item.time}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
