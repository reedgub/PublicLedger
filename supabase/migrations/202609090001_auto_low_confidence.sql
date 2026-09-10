-- Add 'auto_low_confidence' to the verification_mode check constraint.
-- Used when the LLM auto-approver judges a candidate ready for public display
-- but with confidence in the 0.5–0.8 band. These predictions publish, but the
-- mode value lets an admin easily surface and spot-check them:
--   select * from public.predictions where verification_mode = 'auto_low_confidence';
alter table public.predictions
  drop constraint if exists predictions_verification_mode_check;
alter table public.predictions
  add constraint predictions_verification_mode_check
  check (verification_mode in ('auto', 'admin', 'auto_low_confidence'));
