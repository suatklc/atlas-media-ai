import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Yeni Şifre Belirle · Atlas AI",
  description: "Atlas AI hesabınız için yeni bir şifre belirleyin",
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <AuthLayout>
      <ResetPasswordForm linkError={Boolean(params.error)} />
    </AuthLayout>
  );
}
