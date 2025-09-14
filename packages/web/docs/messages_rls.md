# Messages Table RLS Policies

These policies assume the schema now uses `chat_sessions` (parent) and `messages` with a foreign key `chat_session_id` referencing `chat_sessions.id`.

## Preconditions

```sql
alter table public.messages
  add constraint messages_chat_session_id_fkey
  foreign key (chat_session_id)
  references public.chat_sessions(id) on delete cascade;
```

Ensure both tables have RLS enabled:

```sql
alter table public.chat_sessions enable row level security;
alter table public.messages enable row level security;
```

## Policies

1. Chat sessions are only visible to their owner.

```sql
create policy "chat_sessions_select_own" on public.chat_sessions
  for select using ( auth.uid() = user_id );
```

2. Insert chat sessions only for authenticated user (optional if created server-side):

```sql
create policy "chat_sessions_insert_own" on public.chat_sessions
  for insert with check ( auth.uid() = user_id );
```

3. Messages readable only if the parent chat_session belongs to the user.

```sql
create policy "messages_select_own_session" on public.messages
  for select using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  );
```

4. Messages insert allowed only if parent session belongs to user (for persisted chats):

```sql
create policy "messages_insert_own_session" on public.messages
  for insert with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  );
```

5. (Optional) Prevent updates/deletes except by owner:

```sql
create policy "messages_update_own_session" on public.messages
  for update using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  );

create policy "messages_delete_own_session" on public.messages
  for delete using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  );
```

## Guest / Anonymous Sessions

If you allow anonymous (not signed in) sessions stored server-side, keep those writes server-only (bypass RLS via service key) or add a nullable `user_id` and restrict anonymous row visibility only when `user_id is null` and maybe a signed token proves ownership. Recommended: do NOT expose anonymous rows via RLS; instead, upgrade to user before persisting.

## Indexes

For performance:

```sql
create index if not exists messages_session_created_at_idx
  on public.messages(chat_session_id, created_at asc);
```

## Notes

Idempotent policy creation examples:

```sql
create policy if not exists "messages_owned_by_user" on public.messages
  for select using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
  );

create policy if not exists "chat_sessions_owner_all" on public.chat_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### Transitional Dual-Schema Policy (chat_session_id OR conversation_id)

If you are migrating from a legacy `conversation_id` column on `messages` to the new `chat_session_id` foreign key, you can create a temporary policy that authorizes either linkage so old rows remain readable until you finish backfilling:

```sql
drop policy if exists "messages_owned_by_user" on public.messages;

create policy "messages_owned_by_user" on public.messages
  for select using (
    exists (
      select 1 from public.chat_sessions s
      where s.id = messages.chat_session_id
        and s.user_id = auth.uid()
    )
    OR
    exists (
      select 1 from public.chat_sessions s2
      where s2.id = messages.conversation_id
        and s2.user_id = auth.uid()
    )
  );
```

After running the one-time backfill (see below) you can revert to the stricter single-column policy.

### One-Time Backfill Helpers

Create missing `chat_sessions` rows for legacy conversations and then copy `conversation_id` to `chat_session_id`:

```sql
insert into chat_sessions (id, user_id, started_at, seconds_elapsed)
select m.conversation_id, m.user_id, min(m.created_at), 0
from messages m
left join chat_sessions s on s.id = m.conversation_id
where m.conversation_id is not null
  and s.id is null
group by m.conversation_id, m.user_id;

update messages m
set chat_session_id = m.conversation_id
where m.chat_session_id is null
  and m.conversation_id is not null;
```

Once all rows have `chat_session_id` populated and queries/clients are updated, drop the transitional policy and keep only the final one.
