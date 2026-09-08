-- Two-tier claim system.
--
-- record_type = 'prediction' (default): the strict, scored kind. Enters
--   accuracy, Brier, leaderboard. Backfill: every existing row is a
--   prediction because the strict prompt is all we've ever shipped.
--
-- record_type = 'take': the loose kind. The author said something
--   forward-looking with a specific claim, but at least one of the
--   ingredients (usually the resolution date, sometimes the criteria)
--   was not stated by the author and had to be imputed by the editor
--   or the extractor. Displayed on the site but never scored, never on
--   the leaderboard. imputation_note explains what was imputed and how,
--   so a reader can decide whether to trust it.

alter table public.predictions
  add column if not exists record_type text not null default 'prediction'
    check (record_type in ('prediction', 'take'));

alter table public.predictions
  add column if not exists imputation_note text;

alter table public.prediction_candidates
  add column if not exists record_type text not null default 'prediction'
    check (record_type in ('prediction', 'take'));

alter table public.prediction_candidates
  add column if not exists imputation_note text;

create index if not exists predictions_record_type_idx
  on public.predictions(record_type)
  where published_at is not null;

-- Existing indexes / views that touch predictions still work — the new
-- column has a default so no NULLs sneak in — but explicit filters in
-- code should scope scoring queries to record_type = 'prediction'.
