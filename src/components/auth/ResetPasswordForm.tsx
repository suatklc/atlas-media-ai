"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import AuthMobileBrand from "./AuthMobileBrand";
import AuthHeading from "./AuthHeading";
import PasswordField from "./PasswordField";
import FormBanner from "./FormBanner";
import { hasMinLength, isRequired, valuesMatch } from "@/lib/auth-validation";
import { updatePasswordAction } from "@/app/reset-password/actions";
import { createClient } from "@/lib/supabase/client";

type ResetPasswordErrors = {
  password?: string;
  confirmPassword?: string;
};

type SessionState = "checking" | "ready" | "invalid";

type ResetPasswordFormProps = {
  linkError?: boolean;
};

export default function ResetPasswordForm({ linkError = false }: ResetPasswordFormProps) {
  const [sessionState, setSessionState] = useState<SessionState>(
    linkError ? "invalid" : "checking",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<ResetPasswordErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (linkError) return;

    const supabase = createClient();
    let resolved = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setSessionState("ready");
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (resolved) return;
      if (session) {
        resolved = true;
        setSessionState("ready");
        return;
      }
      // The recovery hash can take a moment to be parsed by the client; give
      // it a short grace window before treating the link as invalid.
      window.setTimeout(() => {
        if (!resolved) setSessionState("invalid");
      }, 1500);
    });

    return () => subscription.unsubscribe();
  }, [linkError]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);

    const nextErrors: ResetPasswordErrors = {};
    if (!isRequired(password)) {
      nextErrors.password = "Şifre gerekli.";
    } else if (!hasMinLength(password, 8)) {
      nextErrors.password = "Şifre en az 8 karakter olmalı.";
    }
    if (!isRequired(confirmPassword)) {
      nextErrors.confirmPassword = "Şifre tekrarı gerekli.";
    } else if (!valuesMatch(password, confirmPassword)) {
      nextErrors.confirmPassword = "Şifreler eşleşmiyor.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    startTransition(async () => {
      const result = await updatePasswordAction(password);
      if (result?.error) {
        setServerError(result.error);
      }
    });
  }

  if (sessionState !== "ready") {
    return (
      <div className="w-full max-w-sm">
        <AuthMobileBrand />
        <AuthHeading
          title="Bağlantı Geçersiz"
          subtitle="Bu şifre sıfırlama bağlantısının süresi dolmuş veya bağlantı geçersiz."
        />

        {sessionState === "checking" ? (
          <p className="text-sm text-zinc-400">Bağlantı doğrulanıyor...</p>
        ) : (
          <>
            <FormBanner
              variant="error"
              message="Bu bağlantı artık kullanılamıyor. Lütfen yeni bir şifre sıfırlama bağlantısı isteyin."
            />
            <Link
              href="/forgot-password"
              className="flex w-full items-center justify-center rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
            >
              Yeni Bağlantı İste
            </Link>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <AuthMobileBrand />
      <AuthHeading title="Yeni Şifre Belirle" subtitle="Hesabınız için yeni bir şifre oluşturun." />

      {serverError && <FormBanner variant="error" message={serverError} />}

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <PasswordField
          id="password"
          name="password"
          label="Yeni Şifre"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Yeni Şifre Tekrar"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errors.confirmPassword}
        />

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Güncelleniyor..." : "Şifreyi Güncelle"}
        </button>
      </form>
    </div>
  );
}
