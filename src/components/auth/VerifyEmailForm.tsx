"use client";

import { useEffect, useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import AuthMobileBrand from "./AuthMobileBrand";
import FormBanner from "./FormBanner";
import AuthFooterLink from "./AuthFooterLink";
import { resendVerificationAction } from "@/app/verify-email/actions";

const RESEND_COOLDOWN_SECONDS = 30;

type VerifyEmailFormProps = {
  email: string;
};

export default function VerifyEmailForm({ email }: VerifyEmailFormProps) {
  const [banner, setBanner] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );
  const [cooldown, setCooldown] = useState(0);
  const [isResending, startResending] = useTransition();

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleResend() {
    setBanner(null);
    startResending(async () => {
      const result = await resendVerificationAction(email);
      if (result?.error) {
        setBanner({ variant: "error", message: result.error });
      } else {
        setBanner({ variant: "success", message: "Doğrulama bağlantısı tekrar gönderildi." });
        setCooldown(RESEND_COOLDOWN_SECONDS);
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <AuthMobileBrand />

      <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-zinc-800">
          <MailCheck className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-white">
          E-postanızı Doğrulayın
        </h2>
        <p className="mt-1.5 text-sm text-zinc-400">
          {email ? (
            <>
              <span className="font-medium text-zinc-300">{email}</span> adresine bir doğrulama
              bağlantısı gönderdik. Hesabınızı etkinleştirmek için e-postanızdaki bağlantıya
              tıklayın.
            </>
          ) : (
            "E-posta adresinize bir doğrulama bağlantısı gönderdik. Hesabınızı etkinleştirmek için e-postanızdaki bağlantıya tıklayın."
          )}
        </p>
      </div>

      {banner && <FormBanner variant={banner.variant} message={banner.message} />}

      <p className="text-center text-sm text-zinc-400 lg:text-left">
        Bağlantı gelmedi mi?{" "}
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || isResending}
          className="font-medium text-indigo-400 hover:text-indigo-300 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {isResending
            ? "Gönderiliyor..."
            : cooldown > 0
              ? `Tekrar gönder (${cooldown}sn)`
              : "Tekrar gönder"}
        </button>
      </p>

      <AuthFooterLink prompt="Yanlış hesap mı?" linkText="Giriş sayfasına dön" href="/login" />
    </div>
  );
}
