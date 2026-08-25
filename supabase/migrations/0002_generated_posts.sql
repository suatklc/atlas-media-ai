-- Atlas AI — generation history
-- Run this once in the Supabase SQL Editor (or via `supabase db push` if you
-- have the project linked with the Supabase CLI).
--
-- Persists successfully generated Instagram posts (caption + branded
-- visual) so a signed-in user can return later and see previous work.
-- `status` defaults to 'draft' and already supports the values Package 2
-- (approval workflow) will need — no schema change required for that later
-- package, only new UI/update calls.

create table if not exists public.generated_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  content text not null,
  visual_headline text not null,
  final_image_url text not null,
  base_image_url text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'posted')),
  metadata jsonb
);

-- Newest-first per-user listing is the only query this package needs.
create index if not exists generated_posts_user_id_created_at_idx
  on public.generated_posts (user_id, created_at desc);

alter table public.generated_posts enable row level security;

drop policy if exists "Generated posts are viewable by owner" on public.generated_posts;
create policy "Generated posts are viewable by owner"
  on public.generated_posts for select
  using (auth.uid() = user_id);

drop policy if exists "Generated posts are insertable by owner" on public.generated_posts;
create policy "Generated posts are insertable by owner"
  on public.generated_posts for insert
  with check (auth.uid() = user_id);

-- Not used by this package (no status/approval UI yet) — included now so
-- Package 2 needs no migration of its own, only a status-update call.
drop policy if exists "Generated posts are updatable by owner" on public.generated_posts;
create policy "Generated posts are updatable by owner"
  on public.generated_posts for update
  using (auth.uid() = user_id);
