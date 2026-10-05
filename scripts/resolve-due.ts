import "dotenv/config";
import pLimit from "p-limit";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { env } from "@/lib/env";
import { RESOLUTION_SCHEMA_VERSION } from "@/lib/constants";
import { canAutoResolve, proposeResolution, verifyResolution, type ResolutionUsage } from "@/lib/resolution/resolve";
import { checkEvidence } from "@/lib/resolution/evidence";
import { createBudgetGuard, recordSpend, tokenCostUsd } from "@/lib/pipeline/spend";
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
    from public.predictions p where published_at is not null and status in ('open','due','resolution_pending')
      and resolution_date is not null and resolution_date <= now()
      and record_type = 'prediction'
      -- No human approves resolutions. One that missed the auto thresholds
      -- stays unresolved and is retried monthly, as new evidence appears.
      and not exists (
        select 1 from public.resolutions r
        where r.prediction_id = p.id and r.approved_at is null and r.resolved_at > now() - interval '30 days'
      )
    order by resolution_date asc limit ${env.RESOLUTION_MAX_PER_RUN}
  `;
  for (const prediction of due) await sql`update public.predictions set status = 'resolution_pending' where id = ${prediction.id} and status in ('open','due')`;
  if (!env.OPENAI_API_KEY) return { due: due.length, proposed: 0, approved: 0, errors: 0, skipped: true };
  let proposed = 0; let approved = 0; let errors = 0;
  const guard = await createBudgetGuard("resolution");
  const price = { input: env.OPENAI_PRICE_INPUT_PER_MTOK_USD, output: env.OPENAI_PRICE_OUTPUT_PER_MTOK_USD };
  const costOf = (usage?: ResolutionUsage) => usage ? tokenCostUsd(usage, price) + usage.searchCalls * env.RESOLUTION_SEARCH_CALL_USD : 0;
  // Rough upper bound for one proposal (a few searches + tokens) + verification.
  const perResolutionEstimate = 4 * env.RESOLUTION_SEARCH_CALL_USD + tokenCostUsd({ inputTokens: 20_000, outputTokens: 3_000 }, price);
  const limit = pLimit(env.SEED_CONCURRENCY);
  await Promise.all(due.map((prediction) => limit(async () => {
    if (!guard.canSpend(perResolutionEstimate)) return;
    // Reserve the estimate while the call is in flight so concurrent workers respect the cap.
    guard.add(perResolutionEstimate);
    let spent = 0;
    try {
      const { usage: proposalUsage, ...proposal } = await proposeResolution({ normalizedClaim: prediction.normalized_claim, predictionDate: prediction.prediction_date, resolutionDate: prediction.resolution_date, resolutionCriteria: prediction.resolution_criteria });
      spent += costOf(proposalUsage);
      const checked = await checkEvidence(proposal.evidence);
      const confirmed = checked.filter((item) => item.confirmed).map((item) => ({ title: item.title, source_path: item.source_path, publisher: item.publisher, excerpt: item.excerpt, is_primary_source: item.is_primary_source }));
      const { usage: verifierUsage, ...verifier } = await verifyResolution({ normalizedClaim: prediction.normalized_claim, resolutionCriteria: prediction.resolution_criteria, resolutionDate: prediction.resolution_date, proposal, checkedEvidence: checked });
      spent += costOf(verifierUsage);
      const auto = canAutoResolve(proposal, verifier, confirmed);
      const [resolution] = await sql<{ id: string }[]>`
        insert into public.resolutions (prediction_id, outcome, explanation, resolution_confidence, resolution_method, scoring_eligible, resolved_at, approved_at)
        values (${prediction.id}, ${proposal.proposed_outcome}, ${proposal.explanation}, ${proposal.confidence}, 'openai_web', ${proposal.scoring_eligible && ["correct", "incorrect"].includes(proposal.proposed_outcome)}, now(), ${auto ? new Date() : null})
        on conflict (prediction_id) do update set outcome = excluded.outcome, explanation = excluded.explanation,
          resolution_confidence = excluded.resolution_confidence, resolution_method = excluded.resolution_method,
          scoring_eligible = excluded.scoring_eligible, resolved_at = excluded.resolved_at, approved_at = excluded.approved_at
        returning id
      `;
      await sql`delete from public.resolution_evidence where resolution_id = ${resolution.id}`;
      // Only evidence whose excerpt was found on the live page is stored and shown.
      for (const item of confirmed) await sql`
        insert into public.resolution_evidence (resolution_id, source_type, source_title, source_path, publisher, excerpt, is_primary_source)
        values (${resolution.id}, 'web', ${item.title}, ${item.source_path}, ${item.publisher}, ${item.excerpt}, ${item.is_primary_source})
      `;
      const evidenceCheck = checked.map((item) => ({ url: item.source_path, confirmed: item.confirmed, error: item.checkError }));
      await sql`insert into public.audit_log (entity_type, entity_id, action, actor_type, after, reason) values ('prediction', ${prediction.id}, ${auto ? "resolution_approved" : "resolution_proposed"}, 'system', ${sql.json({ proposal, verifier, evidence_check: evidenceCheck, resolution_schema_version: RESOLUTION_SCHEMA_VERSION } as never)}, ${auto ? "Passed resolution and evidence thresholds." : "Below auto-resolution thresholds; retried in 30 days."})`;
      proposed += 1;
      if (auto) {
        await sql`update public.predictions set status = ${proposal.proposed_outcome === "ambiguous" ? "ambiguous" : proposal.proposed_outcome === "void" ? "void" : "resolved"} where id = ${prediction.id}`;
        approved += 1;
      }
    } catch (error) { errors += 1; console.error(`Resolution failed for ${prediction.id}:`, error instanceof Error ? error.message : "unknown"); }
    finally {
      // Swap the reservation for the actual cost.
      guard.release(perResolutionEstimate);
      guard.add(spent);
      if (spent > 0) await recordSpend({ scope: "resolution", provider: "openai", stage: "resolve", units: 1, unitKind: "resolution", costUsd: spent, metadata: { prediction_id: prediction.id } });
    }
  })));
  if (approved > 0) {
    await revalidateLive(["/", "/leaderboard"]);
  }
  return { due: due.length, proposed, approved, errors, skipped: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  resolveDue().then((result) => console.log(`Due: ${result.due}\nProposed: ${result.proposed}\nApproved: ${result.approved}\nErrors: ${result.errors}${result.skipped ? "\nOpenAI not configured; proposal phase skipped." : ""}`)).finally(closeDatabase);
}
