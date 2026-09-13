-- Broadens the sources.source_verification_level check constraint so the
-- xAI daily-discovery pipeline can persist non-X sources (Substack posts,
-- personal blogs, news / interview articles) verified by the web verifier.
--
-- Adds a new allowed value 'xai_web' alongside the existing X-focused
-- values. Nothing else about the sources table changes.

alter table public.sources
  drop constraint if exists sources_source_verification_level_check;

alter table public.sources
  add constraint sources_source_verification_level_check
  check (
    source_verification_level = any (array[
      'xai_discovery'::text,
      'xai_oembed'::text,
      'xai_web'::text,
      'x_api'::text
    ])
  );
