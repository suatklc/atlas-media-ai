import { AlertCircle, CheckCircle2, Info } from "lucide-react";

type FormBannerProps = {
  variant?: "success" | "info" | "error";
  message: string;
};

const ICONS = {
  success: CheckCircle2,
  info: Info,
  error: AlertCircle,
};

const STYLES = {
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  info: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300",
  error: "border-red-500/30 bg-red-500/10 text-red-300",
};

export default function FormBanner({ variant = "info", message }: FormBannerProps) {
  const Icon = ICONS[variant];

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`mb-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${STYLES[variant]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
