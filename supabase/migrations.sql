-- Auth is managed by Supabase Auth (email magic link, OAuth, etc.)

create table if not exists public.user_memories (
  user_id uuid primary key references auth.users(id) on delete cascade,
  facts jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',               -- 'free' | 'supporter'
  seconds_remaining int not null default 1200,     -- 20 min trial
  updated_at timestamptz default now()
);

-- Profiles to store external billing identifiers
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Conversations and messages
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

create table if not exists public.usage_counters (
  user_id uuid references auth.users(id) on delete cascade,
  period_start date not null default current_date,
  seconds_stt int not null default 0,
  seconds_tts int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  chars_tts int not null default 0,
  primary key (user_id, period_start)
);

alter table public.user_memories enable row level security;
alter table public.entitlements enable row level security;
alter table public.usage_counters enable row level security;
alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "memories-own" on public.user_memories
  for select using (auth.uid() = user_id);
create policy "entitlements-own" on public.entitlements
  for select using (auth.uid() = user_id);
create policy "usage-own" on public.usage_counters
  for select using (auth.uid() = user_id);

create policy "profiles-own" on public.profiles
  for select using (auth.uid() = user_id);

-- RLS for conversations: owner can select/modify/delete
create policy "convos-select-own" on public.conversations
  for select using (auth.uid() = user_id);
create policy "convos-insert-own" on public.conversations
  for insert with check (auth.uid() = user_id);
create policy "convos-update-own" on public.conversations
  for update using (auth.uid() = user_id);
create policy "convos-delete-own" on public.conversations
  for delete using (auth.uid() = user_id);

-- RLS for messages: join to verify conversation ownership
create policy "messages-select-own" on public.messages
  for select using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy "messages-insert-own" on public.messages
  for insert with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
create policy "messages-delete-own" on public.messages
  for delete using (exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

-- Helper RPC: list supporters without a stored Stripe customer id
create or replace function public.supporters_to_backfill()
returns table(user_id uuid, email text) as $$
  select u.id as user_id, u.email
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  left join public.profiles p on p.user_id = e.user_id
  where e.plan = 'supporter' and (p.stripe_customer_id is null or length(p.stripe_customer_id) = 0);
$$ language sql stable security definer;

-- Seed entitlements when a new user signs up
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.entitlements (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atomic decrease of seconds_remaining
create or replace function public.decrement_seconds(p_user_id uuid, p_seconds int)
returns void as $$
begin
  update public.entitlements
  set seconds_remaining = greatest(0, seconds_remaining - p_seconds),
      updated_at = now()
  where user_id = p_user_id;
end;
$$ language plpgsql security definer;

-- Helpers to increment counters (optional)
create or replace function public.bump_usage(
  p_user_id uuid,
  p_seconds_stt int,
  p_seconds_tts int,
  p_tokens_in int,
  p_tokens_out int,
  p_chars_tts int
) returns void as $$
begin
  insert into public.usage_counters (user_id, period_start, seconds_stt, seconds_tts, tokens_in, tokens_out, chars_tts)
  values (p_user_id, current_date, p_seconds_stt, p_seconds_tts, p_tokens_in, p_tokens_out, p_chars_tts)
  on conflict (user_id, period_start) do
  update set
    seconds_stt = usage_counters.seconds_stt + p_seconds_stt,
    seconds_tts = usage_counters.seconds_tts + p_seconds_tts,
    tokens_in   = usage_counters.tokens_in + p_tokens_in,
    tokens_out  = usage_counters.tokens_out + p_tokens_out,
    chars_tts   = usage_counters.chars_tts + p_chars_tts;
end;
$$ language plpgsql security definer;
