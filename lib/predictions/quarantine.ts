// Quarantine: the only way a published prediction leaves public view.
//
// Quarantine never unpublishes: published_at stays set (so the record stays
// frozen by the database guard) and status becomes 'source_unavailable',
// which every public read, the scorecards and the history view exclude.
// The database also refuses to change or delete a source while a visible
// prediction depends on it, so callers quarantine first, inside the same
// transaction as the source change.

import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";

type Tx = Sql | TransactionSql;

/** Quarantine visible predictions (all of a source's, or specific ids). Returns the ids quarantined. */
export async function quarantinePredictions(
  tx: Tx,
  target: { sourceId: string } | { predictionIds: string[] },
  reason: string,
): Promise<string[]> {
  const rows = "sourceId" in target
    ? await tx<{ id: string; previous: string }[]>`
        update public.predictions p set status = 'source_unavailable'
        from (select id, status from public.predictions where source_id = ${target.sourceId} and published_at is not null and status <> 'source_unavailable' for update) old
        where p.id = old.id returning p.id, old.status as previous`
    : target.predictionIds.length === 0 ? [] : await tx<{ id: string; previous: string }[]>`
        update public.predictions p set status = 'source_unavailable'
        from (select id, status from public.predictions where id = any(${target.predictionIds}::uuid[]) and published_at is not null and status <> 'source_unavailable' for update) old
        where p.id = old.id returning p.id, old.status as previous`;
  for (const row of rows) {
    await tx`insert into public.audit_log (entity_type, entity_id, action, actor_type, before, after, reason)
      values ('prediction', ${row.id}, 'source_unavailable_marked', 'system', ${tx.json({ status: row.previous } as never)}, ${tx.json({ status: "source_unavailable" } as never)}, ${reason.slice(0, 1000)})`;
  }
  return rows.map((row) => row.id);
}

function fingerprintText(text: string | null): { sha256: string | null; length: number } {
  return { sha256: text === null ? null : createHash("sha256").update(text).digest("hex"), length: text?.length ?? 0 };
}

/** The original is gone (deleted, protected, 404/410) or permanently unverifiable: quarantine, then drop the stored text. */
export async function markSourceUnavailable(sql: Sql, sourceId: string, reason: string): Promise<string[]> {
  return sql.begin(async (tx) => {
    const quarantined = await quarantinePredictions(tx, { sourceId }, reason);
    // Removed text is not kept anywhere, including the audit log: only its hash.
    const [before] = await tx<{ exact_text: string | null }[]>`select exact_text from public.sources where id = ${sourceId} for update`;
    await tx`update public.sources set deleted_at = now(), exact_text = null, last_verified_at = now() where id = ${sourceId}`;
    await tx`insert into public.audit_log (entity_type, entity_id, action, actor_type, before, after, reason)
      values ('source', ${sourceId}, 'source_deleted', 'system', ${tx.json(fingerprintText(before?.exact_text ?? null) as never)}, ${tx.json({ quarantined_predictions: quarantined } as never)}, ${reason.slice(0, 1000)})`;
    return quarantined;
  });
}

/** The original was edited: quarantine its predictions, then store the new text. */
export async function markSourceEdited(sql: Sql, sourceId: string, newText: string, reason: string): Promise<string[]> {
  return sql.begin(async (tx) => {
    const quarantined = await quarantinePredictions(tx, { sourceId }, reason);
    const [before] = await tx<{ exact_text: string | null }[]>`select exact_text from public.sources where id = ${sourceId} for update`;
    const after = fingerprintText(newText);
    await tx`update public.sources set exact_text = ${newText}, content_hash = ${after.sha256}, fetched_at = now(), last_verified_at = now() where id = ${sourceId}`;
    await tx`insert into public.audit_log (entity_type, entity_id, action, actor_type, before, after, reason)
      values ('source', ${sourceId}, 'source_updated', 'system', ${tx.json(fingerprintText(before?.exact_text ?? null) as never)}, ${tx.json({ ...after, quarantined_predictions: quarantined } as never)}, ${reason.slice(0, 1000)})`;
    return quarantined;
  });
}
