-- Fluentia sync schema. Run once in the Supabase SQL editor.
-- Every local record (cards, reviews, activities, settings) is stored as JSON in one table.
-- Conflicts are resolved by last-write-wins on the client timestamp `updated_at`.

create table if not exists public.records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  updated_at bigint not null,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);

create index if not exists records_pull_idx on public.records (user_id, server_updated_at);

alter table public.records enable row level security;

drop policy if exists "Users manage their own records" on public.records;
create policy "Users manage their own records" on public.records
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep the newer version when two devices write the same record, and stamp the
-- server time that other devices use as their pull cursor.
create or replace function public.records_last_write_wins()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists records_last_write_wins on public.records;
create trigger records_last_write_wins
  before insert or update on public.records
  for each row execute function public.records_last_write_wins();
