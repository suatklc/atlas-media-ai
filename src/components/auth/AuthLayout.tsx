import type { ReactNode } from "react";
import AuthShowcase from "./AuthShowcase";

type AuthLayoutProps = {
  children: ReactNode;
};

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-screen bg-zinc-950 lg:grid-cols-2">
      <AuthShowcase />
      <div className="flex items-center justify-center px-4 py-12 sm:px-6 lg:px-12">
        {children}
      </div>
    </div>
  );
}
