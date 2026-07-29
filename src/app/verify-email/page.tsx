import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import VerifyEmailForm from "@/components/auth/VerifyEmailForm";

export const metadata: Metadata = {
  title: "E-postanızı Doğrulayın · Atlas AI",
  description: "Atlas AI e-posta doğrulama",
};

type VerifyEmailPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { email } = await searchParams;

  return (
    <AuthLayout>
      <VerifyEmailForm email={email ?? ""} />
    </AuthLayout>
  );
}
