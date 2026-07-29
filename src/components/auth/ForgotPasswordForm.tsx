"use client";

import { useState, type FormEvent } from "react";
import AuthMobileBrand from "./AuthMobileBrand";
import AuthHeading from "./AuthHeading";
import TextField from "./TextField";
import FormBanner from "./FormBanner";
import AuthFooterLink from "./AuthFooterLink";
import { isRequired, isValidEmail } from "@/lib/auth-validation";

type ForgotPasswordErrors = {
  email?: string;
};

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<ForgotPasswordErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: ForgotPasswordErrors = {};
    if (!isRequired(email)) {
      nextErrors.email = "E-posta adresi gerekli.";
    } else if (!isValidEmail(email)) {
      nextErrors.email = "Geçerli bir e-posta adresi girin.";
    }

    setErrors(nextErrors);
    setSubmitted(Object.keys(nextErrors).length === 0);
  }

  return (
    <div className="w-full max-w-sm">
      <AuthMobileBrand />
      <AuthHeading
        title="Şifremi Unuttum"
        subtitle="Hesabınıza kayıtlı e-posta adresini girin, size bir sıfırlama bağlantısı gönderelim."
      />

      {submitted && (
        <FormBanner
          variant="success"
          message={`${email} adresine bir şifre sıfırlama bağlantısı gönderildi.`}
        />
      )}

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          name="email"
          type="email"
          label="E-posta"
          placeholder="ornek@sirket.com"
          autoComplete="email"
          value={email}
          onChange={(value) => {
            setEmail(value);
            setSubmitted(false);
          }}
          error={errors.email}
        />

        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
        >
          Sıfırlama Bağlantısı Gönder
        </button>
      </form>

      <AuthFooterLink prompt="Şifrenizi hatırladınız mı?" linkText="Giriş yapın" href="/login" />
    </div>
  );
}
