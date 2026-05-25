alter table public.articles
  add column if not exists group_name text,
  add column if not exists subgroup_name text;
