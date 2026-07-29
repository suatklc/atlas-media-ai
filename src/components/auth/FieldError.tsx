import { AlertCircle } from "lucide-react";

type FieldErrorProps = {
  id?: string;
  message: string;
};

export default function FieldError({ id, message }: FieldErrorProps) {
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-xs font-medium text-red-400">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}
