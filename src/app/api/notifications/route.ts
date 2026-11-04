import { createClient } from "@/lib/supabase/server";

// Dashboard bell (Automation V1): the signed-in user's own notifications
// (RLS + explicit user filter). POST only marks them read — the one column
// the owner may update (0004_automation.sql).
const LIST_LIMIT = 20;

async function sessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await sessionUser();
  if (!user) return Response.json({ error: "Bu işlem için giriş yapmanız gerekiyor." }, { status: 401 });

  const { data, error } = await supabase
    .from("notifications")
    .select("id, kind, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) {
    console.error("Notifications select error:", error.message);
    return Response.json({ error: "Bildirimler alınamadı." }, { status: 502 });
  }
  const notifications = data ?? [];
  return Response.json({ notifications, unread: notifications.filter((n) => !n.read_at).length });
}

export async function POST(request: Request) {
  const { supabase, user } = await sessionUser();
  if (!user) return Response.json({ error: "Bu işlem için giriş yapmanız gerekiyor." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : null;

  let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  if (ids) query = query.in("id", ids);
  const { error } = await query;
  if (error) {
    console.error("Notifications update error:", error.message);
    return Response.json({ error: "Bildirimler güncellenemedi." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
