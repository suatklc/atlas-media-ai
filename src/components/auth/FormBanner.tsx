import { CheckCircle2, Info } from "lucide-react";

type FormBannerProps = {
  variant?: "success" | "info";
  message: string;
};

export default function FormBanner({ variant = "info", message }: FormBannerProps) {
  const Icon = variant === "success" ? CheckCircle2 : Info;
  const styles =
    variant === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
      : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";

  return (
    <div
      role="status"
      className={`mb-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${styles}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
