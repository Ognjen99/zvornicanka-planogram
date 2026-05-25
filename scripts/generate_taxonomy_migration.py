import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
rows = json.loads((ROOT / "images" / "podgrupe_parsed.json").read_text(encoding="utf-8"))


def esc(value: str) -> str:
    return value.replace("'", "''")


ddl = """-- Article taxonomy imported from podgrupe.pdf (Opis nove podgrupe)

create table if not exists public.article_taxonomy (
  code text primary key,
  name text not null,
  parent_code text references public.article_taxonomy (code) on delete cascade,
  created_at timestamptz default timezone('utc', now())
);

create index if not exists idx_article_taxonomy_parent_code on public.article_taxonomy (parent_code);
create index if not exists idx_article_taxonomy_name on public.article_taxonomy (name);

alter table public.article_taxonomy enable row level security;

drop policy if exists "Article taxonomy readable by authenticated users" on public.article_taxonomy;
create policy "Article taxonomy readable by authenticated users"
  on public.article_taxonomy
  for select
  to authenticated
  using (true);

truncate table public.article_taxonomy cascade;
"""

ordered = sorted(rows, key=lambda row: (len(row["code"]), row["code"]))
values: list[str] = []
for row in ordered:
    parent = "null" if row["parent_code"] is None else f"'{esc(row['parent_code'])}'"
    values.append(f"('{esc(row['code'])}', '{esc(row['name'])}', {parent})")

chunks: list[str] = []
batch_size = 200
for index in range(0, len(values), batch_size):
    chunk = values[index : index + batch_size]
    chunks.append(
        "insert into public.article_taxonomy (code, name, parent_code) values\n"
        + ",\n".join(chunk)
        + " on conflict (code) do update set name = excluded.name, parent_code = excluded.parent_code;"
    )

sql = ddl + "\n\n".join(chunks) + "\n"
out = ROOT / "supabase" / "migrations" / "0007_add_article_taxonomy_from_pdf.sql"
out.write_text(sql, encoding="utf-8")
print(f"Wrote {out} ({out.stat().st_size} bytes, {len(values)} rows)")
