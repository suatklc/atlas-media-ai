"use client";

import { useEffect, useState, type FormEvent } from "react";
import { MailCheck } from "lucide-react";
import AuthMobileBrand from "./AuthMobileBrand";
import TextField from "./TextField";
import FormBanner from "./FormBanner";
import AuthFooterLink from "./AuthFooterLink";
import { isValidCode } from "@/lib/auth-validation";

const RESEND_COOLDOWN_SECONDS = 30;

export default function VerifyEmailForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [verified, setVerified] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown === 0) return;
    const timer = setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isValidCode(code)) {
      setError("6 haneli doğrulama kodunu girin.");
      setVerified(false);
      return;
    }

    setError(undefined);
    setVerified(true);
  }

  function handleResend() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
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
          E-posta adresinize 6 haneli bir doğrulama kodu gönderdik. Kodu aşağıya girin.
        </p>
      </div>

      {verified && (
        <FormBanner variant="success" message="E-posta adresiniz başarıyla doğrulandı." />
      )}

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
            setVerified(false);
          }}
          error={error}
        />

        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
        >
          Doğrula
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-zinc-400">
        Kod gelmedi mi?{" "}
        <button
          type="button"
          onClick={handleResend}
          disabled={cooldown > 0}
          className="font-medium text-indigo-400 hover:text-indigo-300 disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {cooldown > 0 ? `Tekrar gönder (${cooldown}sn)` : "Tekrar gönder"}
        </button>
      </p>

      <AuthFooterLink prompt="Yanlış hesap mı?" linkText="Giriş sayfasına dön" href="/login" />
    </div>
  );
}
