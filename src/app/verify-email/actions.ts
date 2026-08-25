"use server";

import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/supabase/error-messages";

export async function resendVerificationAction(email: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  return { success: true };
}
