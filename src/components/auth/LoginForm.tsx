"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import AuthMobileBrand from "./AuthMobileBrand";
import AuthHeading from "./AuthHeading";
import TextField from "./TextField";
import PasswordField from "./PasswordField";
import AuthDivider from "./AuthDivider";
import SocialButtons from "./SocialButtons";
import AuthFooterLink from "./AuthFooterLink";
import FormBanner from "./FormBanner";
import { isRequired, isValidEmail } from "@/lib/auth-validation";
import { signInAction } from "@/app/login/actions";

type LoginErrors = {
  email?: string;
  password?: string;
};

type LoginFormProps = {
  resetSuccess?: boolean;
};

export default function LoginForm({ resetSuccess = false }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [serverError, setServerError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);

    const nextErrors: LoginErrors = {};
    if (!isRequired(email)) {
      nextErrors.email = "E-posta adresi gerekli.";
    } else if (!isValidEmail(email)) {
      nextErrors.email = "Geçerli bir e-posta adresi girin.";
    }
    if (!isRequired(password)) {
      nextErrors.password = "Şifre gerekli.";
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    startTransition(async () => {
      const result = await signInAction(email, password);
      if (result?.error) {
        setServerError(result.error);
      }
    });
  }

  return (
    <div className="w-full max-w-sm">
      <AuthMobileBrand />
      <AuthHeading title="Giriş Yap" subtitle="Devam etmek için hesabınıza giriş yapın." />

      {resetSuccess && (
        <FormBanner
          variant="success"
          message="Şifreniz başarıyla güncellendi. Yeni şifrenizle giriş yapabilirsiniz."
        />
      )}
      {serverError && <FormBanner variant="error" message={serverError} />}

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          name="email"
          type="email"
          label="E-posta"
          placeholder="ornek@sirket.com"
          autoComplete="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
        />

        <PasswordField
          id="password"
          name="password"
          label="Şifre"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />

        <div className="flex justify-end text-sm">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-11 items-center font-medium text-indigo-400 hover:text-indigo-300"
          >
            Şifremi unuttum
          </Link>
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="min-h-12 w-full rounded-lg bg-indigo-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>

      <AuthDivider />
      <SocialButtons />

      <AuthFooterLink prompt="Hesabınız yok mu?" linkText="Kayıt olun" href="/register" />
    </div>
  );
}
