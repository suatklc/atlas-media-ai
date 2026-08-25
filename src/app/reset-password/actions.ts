"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/supabase/error-messages";

export async function updatePasswordAction(password: string) {
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  await supabase.auth.signOut();
  redirect("/login?reset=success");
}
