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

-- Streak columns (safe to re-run)
alter table if exists public.entitlements
  add column if not exists current_streak int not null default 0,
  add column if not exists last_streak_date date;

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
  user_id uuid references auth.users(id) on delete cascade,
  is_guest boolean not null default false,
  title text not null default 'New chat',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Add per-conversation remaining seconds for guests (ignored for authed users)
alter table if exists public.conversations
  add column if not exists seconds_remaining int;

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
  for select using (
    -- Authenticated users can access their own
    (user_id is not null and auth.uid() = user_id)
  );
create policy "convos-insert-own" on public.conversations
  for insert with check (
    -- Allow inserts by service role (server) for guests (user_id null) or users
    true
  );
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

-- Enable pgvector for vector similarity if not already enabled
create extension if not exists vector;

-- Upgrade user_memories to a per-fact vector store (id, content, embedding)
-- Previous schema used a single JSON per user; this expands it for RAG
alter table if exists public.user_memories drop constraint if exists user_memories_pkey;
alter table if exists public.user_memories drop column if exists facts;
alter table if exists public.user_memories add column if not exists id uuid default gen_random_uuid();
alter table if exists public.user_memories add column if not exists content text;
alter table if exists public.user_memories add column if not exists embedding vector(1536);
alter table if exists public.user_memories add column if not exists created_at timestamptz default now();
alter table if exists public.user_memories add primary key (id);
create index if not exists user_memories_user_id_idx on public.user_memories(user_id);

-- RAG retriever: semantic match memories for a user
create or replace function match_memories (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid
)
returns table (
  content text,
  similarity float
)
language sql stable
as $$
  select
    user_memories.content,
    1 - (user_memories.embedding <=> query_embedding) as similarity
  from user_memories
  where user_memories.user_id = p_user_id
    and 1 - (user_memories.embedding <=> query_embedding) > match_threshold
  order by similarity desc
  limit match_count;
$$;

-- Helper RPC: list supporters without a stored Stripe customer id
create or replace function public.supporters_to_backfill()
returns table(user_id uuid, email text) as $$
  select u.id as user_id, u.email
  from public.entitlements e
  join auth.users u on u.id = e.user_id
  where e.plan = 'supporter' and (e.stripe_customer_id is null or length(e.stripe_customer_id) = 0);
$$ language sql stable security definer;

-- Seed entitlements when a new user signs up
create or replace function public.handle_new_user() returns trigger as $$
begin
  insert into public.entitlements (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Achievements tables (lean v1)
create table if not exists public.achievements (
  id text primary key,
  name text not null,
  description text
);

create table if not exists public.user_achievements (
  user_id uuid references auth.users(id) on delete cascade,
  achievement_id text references public.achievements(id) on delete cascade,
  unlocked_at timestamptz default now(),
  primary key (user_id, achievement_id)
);

alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

-- Anyone can read the catalog
create policy if not exists "achievements-read" on public.achievements for select using (true);

-- Users can read their own unlocks and insert new ones for themselves
create policy if not exists "user_achievements-select-own" on public.user_achievements for select using (auth.uid() = user_id);
create policy if not exists "user_achievements-insert-own" on public.user_achievements for insert with check (auth.uid() = user_id);

-- Seed a few example achievements (idempotent)
insert into public.achievements (id, name, description) values
  ('ICEBREAKER','First Hello','Send your first message'),
  ('DEEP_THINKER','Deep Thinker','Reach 100 total messages'),
  ('CHATTERBOX','Chatterbox','Have 5 conversations'),
  ('FIRST_MEMORY','First Memory','Save your first memory')
on conflict (id) do nothing;

-- Guest conversations: decrement remaining seconds atomically by RPC
create or replace function public.decrement_guest_seconds(conv_id uuid, seconds_to_decrement int)
returns void as $$
begin
  update public.conversations
  set seconds_remaining = greatest(0, coalesce(seconds_remaining, 0) - seconds_to_decrement),
      updated_at = now()
  where id = conv_id;
end;
$$ language plpgsql security definer;

-- Create paywall events table for conversion tracking
create table if not exists public.paywall_events (
  id uuid default gen_random_uuid() primary key,
  event text not null,
  properties jsonb,
  timestamp timestamptz default now(),
  user_agent text,
  url text,
  user_id uuid references auth.users(id) on delete set null,
  user_type text,
  plan text,
  seconds_remaining integer,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists paywall_events_user_id_idx on public.paywall_events(user_id);
create index if not exists paywall_events_event_idx on public.paywall_events(event);
create index if not exists paywall_events_timestamp_idx on public.paywall_events(timestamp);

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
