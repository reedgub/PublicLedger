-- Public-safe view of the audit log, scoped to a single prediction.
--
-- audit_log itself is admin-only RLS because rows can carry actor IDs, raw
-- extraction payloads, and other sensitive detail. This view exposes only
-- the fields a reader needs to trust the record: what changed, when, and
-- who kind of actor made the change ('admin' vs 'system').
--
-- Restricted to predictions the public can already read (published_at is
-- not null and status <> 'source_unavailable') so we don't leak the
-- pre-publication candidate lifecycle.

-- security_invoker = false: the view runs with its owner's rights so it can
-- read audit_log rows without granting broader public RLS on that table.
-- The WHERE clause already caps exposure to publicly visible predictions and
-- the SELECT list omits every sensitive column.
create or replace view public.prediction_history
with (security_invoker = false)
as
select
  al.id,
  al.entity_id as prediction_id,
  al.action,
  al.actor_type,
  al.reason,
  al.created_at
from public.audit_log al
join public.predictions p on p.id = al.entity_id
where al.entity_type = 'prediction'
  and p.published_at is not null
  and p.status <> 'source_unavailable';

grant select on public.prediction_history to anon, authenticated;
