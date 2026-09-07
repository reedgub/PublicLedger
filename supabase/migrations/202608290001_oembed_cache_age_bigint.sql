-- X's publish.x.com/oembed returns cache_age = "3153600000" (about 100 years,
-- meaning "cache forever"), which overflows PostgreSQL's 4-byte integer type
-- (max ~2.1B). Widen to bigint so any oEmbed value fits.

alter table public.sources
  alter column oembed_cache_age type bigint using oembed_cache_age::bigint;
