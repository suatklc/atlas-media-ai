"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/supabase/error-messages";

export async function signUpAction(fullName: string, email: string, password: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  redirect(`/verify-email?email=${encodeURIComponent(email)}`);
}
