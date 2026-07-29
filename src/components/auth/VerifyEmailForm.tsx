"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import AuthMobileBrand from "./AuthMobileBrand";
import TextField from "./TextField";
import FormBanner from "./FormBanner";
import AuthFooterLink from "./AuthFooterLink";
import { isValidCode } from "@/lib/auth-validation";
import { resendVerificationAction, verifyEmailAction } from "@/app/verify-email/actions";

const RESEND_COOLDOWN_SECONDS = 30;

type VerifyEmailFormProps = {
  email: string;
};

export default function VerifyEmailForm({ email }: VerifyEmailFormProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [banner, setBanner] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );
  const [cooldown, setCooldown] = useState(0);
  const [isVerifying, startVerifying] = useTransition();
  const [isResending, startResending] = useTransition();

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBanner(null);

    if (!isValidCode(code)) {
      setError("6 haneli doğrulama kodunu girin.");
      return;
    }
    setError(undefined);

    startVerifying(async () => {
      const result = await verifyEmailAction(email, code);
      if (result?.error) {
        setBanner({ variant: "error", message: result.error });
      }
    });
  }

  function handleResend() {
    setBanner(null);
    startResending(async () => {
      const result = await resendVerificationAction(email);
      if (result?.error) {
        setBanner({ variant: "error", message: result.error });
      } else {
        setBanner({ variant: "success", message: "Doğrulama kodu tekrar gönderildi." });
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
              <span className="font-medium text-zinc-300">{email}</span> adresine 6 haneli bir
              doğrulama kodu gönderdik. Kodu aşağıya girin.
            </>
          ) : (
            "E-posta adresinize 6 haneli bir doğrulama kodu gönderdik. Kodu aşağıya girin."
          )}
        </p>
      </div>

      {banner && <FormBanner variant={banner.variant} message={banner.message} />}

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <TextField
          id="code"
          name="code"
          label="Doğrulama Kodu"
          placeholder="123456"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(value) => {
            setCode(value);
            setError(undefined);
          }}
          error={error}
        />

        <button
          type="submit"
          disabled={isVerifying}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerifying ? "Doğrulanıyor..." : "Doğrula"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Kod gelmedi mi?{" "}
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0 || isResending}
          className="font-medium text-indigo-400 hover:text-indigo-300 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {cooldown > 0 ? `Tekrar gönder (${cooldown}sn)` : "Tekrar gönder"}
        </button>
      </p>

      <AuthFooterLink prompt="Yanlış hesap mı?" linkText="Giriş sayfasına dön" href="/login" />
    </div>
  );
}
