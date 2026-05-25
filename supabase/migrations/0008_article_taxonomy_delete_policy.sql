-- Allow authenticated users to manage article taxonomy (groups/subgroups)

drop policy if exists "Article taxonomy modifiable by authenticated users" on public.article_taxonomy;
create policy "Article taxonomy modifiable by authenticated users"
  on public.article_taxonomy
  for all
  to authenticated
  using (true)
  with check (true);
