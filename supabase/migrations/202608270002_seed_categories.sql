insert into public.categories (slug, name, sort_order) values
  ('ai-tech', 'AI & Technology', 10),
  ('economy-rates', 'Economy & Rates', 20),
  ('markets-investing', 'Markets & Investing', 30),
  ('crypto', 'Crypto', 40),
  ('politics-elections', 'Politics & Elections', 50),
  ('geopolitics-conflict', 'Geopolitics & Conflict', 60),
  ('business-startups', 'Business & Startups', 70),
  ('energy-climate', 'Energy & Climate', 80),
  ('science-space', 'Science & Space', 90),
  ('sports', 'Sports', 100),
  ('media-culture', 'Media & Culture', 110),
  ('other', 'Other', 120)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;
