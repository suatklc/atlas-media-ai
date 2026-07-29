"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import AuthMobileBrand from "./AuthMobileBrand";
import AuthHeading from "./AuthHeading";
import TextField from "./TextField";
import PasswordField from "./PasswordField";
import FieldError from "./FieldError";
import AuthDivider from "./AuthDivider";
import SocialButtons from "./SocialButtons";
import AuthFooterLink from "./AuthFooterLink";
import {
  hasMinLength,
  isRequired,
  isValidEmail,
  valuesMatch,
} from "@/lib/auth-validation";

type RegisterErrors = {
  name?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  terms?: string;
};

export default function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: RegisterErrors = {};
    if (!isRequired(name)) {
      nextErrors.name = "Ad soyad gerekli.";
    }
    if (!isRequired(email)) {
      nextErrors.email = "E-posta adresi gerekli.";
    } else if (!isValidEmail(email)) {
      nextErrors.email = "Geçerli bir e-posta adresi girin.";
    }
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
    if (!termsAccepted) {
      nextErrors.terms = "Devam etmek için kullanım şartlarını kabul edin.";
    }

    setErrors(nextErrors);
  }

  return (
    <div className="w-full max-w-sm">
      <AuthMobileBrand />
      <AuthHeading
        title="Hesap Oluştur"
        subtitle="Atlas AI'ı kullanmaya başlamak için birkaç bilgi girin."
      />

      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <TextField
          id="name"
          name="name"
          label="Ad Soyad"
          placeholder="Ayşe Yılmaz"
          autoComplete="name"
          value={name}
          onChange={setName}
          error={errors.name}
        />

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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          error={errors.password}
        />

        <PasswordField
          id="confirmPassword"
          name="confirmPassword"
          label="Şifre Tekrar"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={errors.confirmPassword}
        />

        <div className="space-y-1.5">
          <label className="flex items-start gap-2.5 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
              aria-invalid={Boolean(errors.terms)}
              className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:ring-offset-0"
            />
            <span>
              <Link href="#" className="font-medium text-indigo-400 hover:text-indigo-300">
                Kullanım Şartları
              </Link>
              &apos;nı ve{" "}
              <Link href="#" className="font-medium text-indigo-400 hover:text-indigo-300">
                Gizlilik Politikası
              </Link>
              &apos;nı kabul ediyorum.
            </span>
          </label>
          {errors.terms && <FieldError message={errors.terms} />}
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400"
        >
          Hesap Oluştur
        </button>
      </form>

      <AuthDivider />
      <SocialButtons />

      <AuthFooterLink prompt="Zaten hesabınız var mı?" linkText="Giriş yapın" href="/login" />
    </div>
  );
}
