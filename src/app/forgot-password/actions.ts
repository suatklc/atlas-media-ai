"use server";

import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/supabase/error-messages";

type RecoveryError = {
  name: string;
  status?: number;
  message: string;
};

function isIndeterminateRecoveryTransportError(error: RecoveryError) {
  return (
    error.name === "AuthRetryableFetchError" &&
    error.status === 0 &&
    error.message === "fetch failed"
  );
}

export async function requestPasswordResetAction(email: string) {
  try {
    const supabase = await createClient();
    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    ).replace(/\/+$/, "");

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteUrl}/reset-password`,
    });

    if (error) {
      if (isIndeterminateRecoveryTransportError(error)) {
        console.warn("Password reset response could not be confirmed", {
          name: error.name,
          status: error.status,
          message: error.message,
        });

        return { error: "Bağlantı sağlanamadı. Lütfen tekrar deneyin." };
      }

      console.error("Password reset request failed", {
        name: error.name,
        code: error.code,
        status: error.status,
        message: error.message,
      });

      return { error: translateAuthError(error.message, error.code) };
    }

    return { success: true };
  } catch (error) {
    console.error(
      "Password reset request failed unexpectedly",
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { type: typeof error },
    );

    return { error: "Bir hata oluştu. Lütfen tekrar deneyin." };
  }
}
