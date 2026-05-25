-- Planogram schema for Supabase
-- Tables: profiles, articles, shelves, planograms

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz default timezone('utc', now())
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Profiles are insertable by owner"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  width_mm numeric not null,
  height_mm numeric not null,
  depth_mm numeric,
  image_path text,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create index if not exists idx_articles_user_id on public.articles (user_id);

alter table public.articles enable row level security;

create policy "Articles are viewable by owner"
  on public.articles
  for select
  using (auth.uid() = user_id);

create policy "Articles are modifiable by owner"
  on public.articles
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.shelves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  bay_width_mm numeric not null,
  shelf_depth_mm numeric not null,
  shelf_count integer not null check (shelf_count > 0),
  shelf_clearances_mm jsonb,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create index if not exists idx_shelves_user_id on public.shelves (user_id);

alter table public.shelves enable row level security;

create policy "Shelves are viewable by owner"
  on public.shelves
  for select
  using (auth.uid() = user_id);

create policy "Shelves are modifiable by owner"
  on public.shelves
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.planograms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  shelf_id uuid not null references public.shelves (id) on delete cascade,
  name text not null,
  placements_jsonb jsonb not null default '[]'::jsonb,
  created_at timestamptz default timezone('utc', now()),
  updated_at timestamptz default timezone('utc', now())
);

create index if not exists idx_planograms_user_id on public.planograms (user_id);
create index if not exists idx_planograms_shelf_id on public.planograms (shelf_id);

alter table public.planograms enable row level security;

create policy "Planograms are viewable by owner"
  on public.planograms
  for select
  using (auth.uid() = user_id);

create policy "Planograms are modifiable by owner"
  on public.planograms
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_timestamp()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_timestamp_on_articles on public.articles;
create trigger set_timestamp_on_articles
before update on public.articles
for each row
execute procedure public.set_timestamp();

drop trigger if exists set_timestamp_on_shelves on public.shelves;
create trigger set_timestamp_on_shelves
before update on public.shelves
for each row
execute procedure public.set_timestamp();

drop trigger if exists set_timestamp_on_planograms on public.planograms;
create trigger set_timestamp_on_planograms
before update on public.planograms
for each row
execute procedure public.set_timestamp();
