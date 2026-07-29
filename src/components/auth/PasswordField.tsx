"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import FieldError from "./FieldError";

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
};

export default function PasswordField({
  id,
  name,
  label,
  placeholder = "••••••••",
  autoComplete = "current-password",
  error,
  value,
  onChange,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-300">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className={`w-full rounded-lg border px-3.5 py-2.5 pr-10 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 ${
            error
              ? "border-red-500/60 bg-zinc-900 focus:border-red-500 focus:ring-red-500"
              : "border-zinc-800 bg-zinc-900 focus:border-indigo-500 focus:ring-indigo-500"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
        >
          {visible ? (
            <EyeOff className="h-[18px] w-[18px]" />
          ) : (
            <Eye className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}
