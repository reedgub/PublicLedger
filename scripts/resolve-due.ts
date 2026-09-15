import "dotenv/config";
import pLimit from "p-limit";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { RESOLUTION_SCHEMA_VERSION } from "@/lib/constants";
import { canAutoResolve, proposeResolution, validateResolutionEvidence, verifyResolution } from "@/lib/resolution/resolve";
import { revalidateLive } from "@/lib/http/revalidate";

type DueRow = { id: string; normalized_claim: string; prediction_date: string; resolution_date: string | null; resolution_criteria: string };

export async function resolveDue(): Promise<{ due: number; proposed: number; approved: number; errors: number; skipped: boolean }> {
  const sql = getDatabase();
  // Takes are never scored (imputation-carrying claims stay display-only), so
  // pulling them into the OpenAI proposer wastes budget AND then trips the
  // DB integrity check that forbids scoring_eligible=true resolutions on
  // takes. Restrict this sweep to record_type='prediction' at the source.
  const due = await sql<DueRow[]>`
    select id, normalized_claim, prediction_date::text, resolution_date::text, resolution_criteria
    from public.predictions where published_at is not null and status in ('open','due','resolution_pending')
      and resolution_date is not null and resolution_date <= now()
      and record_type = 'prediction'
    order by resolution_date asc limit 100
  `;
  for (const prediction of due) await sql`update public.predictions set status = 'resolution_pending' where id = ${prediction.id} and status in ('open','due')`;
  if (!env.OPENAI_API_KEY) return { due: due.length, proposed: 0, approved: 0, errors: 0, skipped: true };
  let proposed = 0; let approved = 0; let errors = 0;
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(due.map((prediction) => limit(async () => {
    try {
      const proposal = await proposeResolution({ normalizedClaim: prediction.normalized_claim, predictionDate: prediction.prediction_date, resolutionDate: prediction.resolution_date, resolutionCriteria: prediction.resolution_criteria });
      const verifier = await verifyResolution({ normalizedClaim: prediction.normalized_claim, resolutionCriteria: prediction.resolution_criteria, proposal });
      const evidence = validateResolutionEvidence(proposal).validUrls;
      const auto = canAutoResolve(proposal, verifier);
      const [resolution] = await sql<{ id: string }[]>`
        insert into public.resolutions (prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
        values (${prediction.id}, ${proposal.proposed_outcome}, ${proposal.explanation}, ${proposal.confidence}, 'openai_web', ${proposal.scoring_eligible && ["correct", "incorrect"].includes(proposal.proposed_outcome)}, now(), ${auto ? new Date() : null})
        on conflict (prediction_id) do update set outcome = excluded.outcome, explanation = excluded.explanation,
          resolution_confidence = excluded.resolution_confidence, resolution_method = excluded.resolution_method,
          scoring_eligible = excluded.scoring_eligible, resolved_at = excluded.resolved_at, approved_at = excluded.approved_at
        returning id
      `;
      await sql`delete from public.resolution_evidence where resolution_id = ${resolution.id}`;
      for (const item of evidence) await sql`
        insert into public.resolution_evidence (resolution_id, source_type, source_title, source_path, publisher, excerpt, is_primary_source)
        values (${resolution.id}, 'web', ${item.title}, ${item.source_path}, ${item.publisher}, ${item.excerpt}, ${item.is_primary_source})
      `;
      await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, ${auto ? "resolution_approved" : "resolution_proposed"}, 'system', ${sql.json({ proposal, verifier, resolution_schema_version: RESOLUTION_SCHEMA_VERSION })}, ${auto ? "Passed resolution and evidence thresholds." : "Queued for admin review."})`;
      proposed += 1;
      if (auto) {
        await sql`update public.predictions set status = ${proposal.proposed_outcome === "ambiguous" ? "ambiguous" : proposal.proposed_outcome === "void" ? "void" : "resolved"} where id = ${prediction.id}`;
        approved += 1;
      }
    } catch (error) { errors += 1; console.error(`Resolution failed for ${prediction.id}:`, error instanceof Error ? error.message : "unknown"); }
  })));
  if (approved > 0) {
    await revalidateLive(["/", "/leaderboard"]);
  }
  return { due: due.length, proposed, approved, errors, skipped: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resolveDue().then((result) => console.log(`Due: ${result.due}\nProposed: ${result.proposed}\nApproved: ${result.approved}\nErrors: ${result.errors}${result.skipped ? "\nOpenAI not configured; proposal phase skipped." : ""}`)).finally(closeDatabase);
}
