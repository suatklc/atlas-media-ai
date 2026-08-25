import { ArrowRight } from "lucide-react";
import { moduleShortcuts } from "@/lib/mock-data";

export default function ModuleShortcuts() {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold text-white">Hızlı Erişim</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {moduleShortcuts.map((shortcut, index) => {
          const Icon = shortcut.icon;
          return (
            <a
              key={shortcut.title}
              href="#"
              style={{ animationDelay: `${index * 60}ms` }}
              className="animate-fade-up group flex items-start gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-all hover:-translate-y-0.5 hover:border-indigo-500/40 hover:bg-zinc-900"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 transition-transform duration-200 group-hover:scale-110">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{shortcut.title}</h3>
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-indigo-400" />
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                  {shortcut.description}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
