import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Giriş Yap · Atlas AI",
  description: "Atlas AI hesabınıza giriş yapın",
};

type LoginPageProps = {
  searchParams: Promise<{ reset?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;

  return (
    <AuthLayout>
      <LoginForm resetSuccess={params.reset === "success"} />
    </AuthLayout>
  );
}
