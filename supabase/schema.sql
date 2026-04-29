-- Brewbench database schema.
--
-- Paste this into the Supabase SQL Editor (Project → SQL Editor → New query)
-- and click Run. Idempotent: safe to re-run; will skip objects that exist.
--
-- Tables:
--   profiles             — one row per auth.users row, holds app preferences
--                          and the currently selected commander
--   collections          — one row per (user, scryfall_card). The user's owned
--                          card pool. Stores trimmed Scryfall data as JSONB so
--                          the deck builder can read it without re-fetching.
--   decks                — one row per saved deck. main_deck is a JSONB array.
--
-- Row-level security is enabled on every table; every query is auto-scoped to
-- the authenticated user. The client cannot bypass this — RLS runs in the
-- database, not in app code.

-- ───────────────────────────────────────────────────────────────────────────
-- profiles
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text,
  selected_commander_id    text,
  selected_commander_data  jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;

create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles: insert own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id);

-- ───────────────────────────────────────────────────────────────────────────
-- collections
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.collections (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  card_id             text not null,
  name                text not null,
  quantity            int  not null default 1,
  data                jsonb not null,
  needs_validation    boolean not null default false,
  validation_failed   boolean not null default false,
  added_at            timestamptz not null default now(),
  unique (user_id, card_id)
);

create index if not exists collections_user_id_idx       on public.collections (user_id);
create index if not exists collections_user_id_name_idx  on public.collections (user_id, name);

alter table public.collections enable row level security;

drop policy if exists "collections: read own"   on public.collections;
drop policy if exists "collections: insert own" on public.collections;
drop policy if exists "collections: update own" on public.collections;
drop policy if exists "collections: delete own" on public.collections;

create policy "collections: read own"
  on public.collections for select
  using (auth.uid() = user_id);

create policy "collections: insert own"
  on public.collections for insert
  with check (auth.uid() = user_id);

create policy "collections: update own"
  on public.collections for update
  using (auth.uid() = user_id);

create policy "collections: delete own"
  on public.collections for delete
  using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- decks
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists public.decks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  commander_data  jsonb not null,
  main_deck       jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists decks_user_id_idx           on public.decks (user_id);
create index if not exists decks_user_id_updated_idx   on public.decks (user_id, updated_at desc);

alter table public.decks enable row level security;

drop policy if exists "decks: read own"   on public.decks;
drop policy if exists "decks: insert own" on public.decks;
drop policy if exists "decks: update own" on public.decks;
drop policy if exists "decks: delete own" on public.decks;

create policy "decks: read own"
  on public.decks for select
  using (auth.uid() = user_id);

create policy "decks: insert own"
  on public.decks for insert
  with check (auth.uid() = user_id);

create policy "decks: update own"
  on public.decks for update
  using (auth.uid() = user_id);

create policy "decks: delete own"
  on public.decks for delete
  using (auth.uid() = user_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Auto-create a profile when a new auth user signs up.
-- Without this, every page that reads `profiles` would have to handle the
-- "profile doesn't exist yet" case after first login.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ───────────────────────────────────────────────────────────────────────────
-- updated_at maintenance
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

drop trigger if exists decks_touch_updated_at on public.decks;
create trigger decks_touch_updated_at
  before update on public.decks
  for each row execute procedure public.touch_updated_at();
