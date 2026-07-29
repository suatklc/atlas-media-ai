import type { Metadata } from "next";
import AuthLayout from "@/components/auth/AuthLayout";
import VerifyEmailForm from "@/components/auth/VerifyEmailForm";

export const metadata: Metadata = {
  title: "E-postanızı Doğrulayın · Atlas AI",
  description: "Atlas AI e-posta doğrulama",
};

export default function VerifyEmailPage() {
  return (
    <AuthLayout>
      <VerifyEmailForm />
    </AuthLayout>
  );
}
