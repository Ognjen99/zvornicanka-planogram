alter table public.shelves
  add column if not exists bay_widths_mm jsonb;
