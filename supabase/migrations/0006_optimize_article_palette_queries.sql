create index if not exists idx_articles_group_name on public.articles (group_name);
create index if not exists idx_articles_subgroup_name on public.articles (subgroup_name);
create index if not exists idx_articles_name on public.articles (name);
