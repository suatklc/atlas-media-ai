import { Bot, Share2, Wand2 } from "lucide-react";
import AuthVisual from "./AuthVisual";

const features = [
  { icon: Wand2, label: "AI İçerik Üretimi" },
  { icon: Share2, label: "Sosyal Medya Otomasyonu" },
  { icon: Bot, label: "Akıllı İş Asistanı" },
];

export default function AuthShowcase() {
  return (
    <div className="relative hidden flex-col justify-between overflow-hidden border-r border-zinc-800 bg-zinc-950 px-12 py-12 lg:flex xl:px-16">
      <div className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-base font-bold text-white">
          A
        </div>
        <span className="text-xl font-semibold tracking-tight text-white">
          Atlas AI
        </span>
      </div>

      <div className="max-w-md">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white xl:text-4xl">
          Gayrimenkul Profesyonelleri İçin Yapay Zeka
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          Atlas AI, gayrimenkul danışmanları ve ajansları için içerik üretimini,
          sosyal medya paylaşımlarını ve iş süreçlerini tek bir çatı altında
          birleştirir. İlan görsellerinden paylaşım metinlerine kadar tüm
          süreci yapay zeka ile hızlandırın.
        </p>

        <AuthVisual />

        <ul className="mt-8 space-y-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.label} className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-indigo-400 ring-1 ring-zinc-800">
                  <Icon className="h-[18px] w-[18px]" />
                </div>
                <span className="text-sm font-medium text-zinc-300">
                  {feature.label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-zinc-600">
        © {new Date().getFullYear()} Atlas AI. Tüm hakları saklıdır.
      </p>
    </div>
  );
}
