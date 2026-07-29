import type { InputHTMLAttributes } from "react";
import FieldError from "./FieldError";

type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  maxLength?: number;
};

export default function TextField({
  id,
  name,
  label,
  type = "text",
  placeholder,
  autoComplete,
  error,
  value,
  onChange,
  inputMode,
  maxLength,
}: TextFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-300">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 ${
          error
            ? "border-red-500/60 bg-zinc-900 focus:border-red-500 focus:ring-red-500"
            : "border-zinc-800 bg-zinc-900 focus:border-indigo-500 focus:ring-indigo-500"
        }`}
      />
      {error && <FieldError id={errorId} message={error} />}
    </div>
  );
}
