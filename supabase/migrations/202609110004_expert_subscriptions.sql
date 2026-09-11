-- Follow-an-expert intake. No email delivery yet; the row is captured so we
-- can flip it into a mailer or webhook downstream. RLS is closed: only the
-- service role sees the list, so an email address here is never exposed
-- publicly. Unsubscribe is by token or admin action.

create table if not exists public.expert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id) on delete cascade,
  email text not null,
  email_hash text generated always as (encode(sha256(lower(email)::bytea), 'hex')) stored,
  unsubscribe_token text not null default encode(gen_random_bytes(16), 'hex'),
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  created_at timestamptz not null default now(),
  ip_hash text
);

create unique index if not exists expert_subscriptions_unique
  on public.expert_subscriptions(expert_id, email_hash);

create index if not exists expert_subscriptions_expert_idx
  on public.expert_subscriptions(expert_id)
  where unsubscribed_at is null;

alter table public.expert_subscriptions enable row level security;

-- No anonymous SELECT: this table holds email addresses.
-- Service role writes via createAdminSupabaseClient; RLS is bypassed there.
-- Admin dashboard reads go through admin-only RLS.
create policy admin_all_expert_subscriptions on public.expert_subscriptions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
