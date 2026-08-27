import "dotenv/config";
import pLimit from "p-limit";
import { getDatabase, closeDatabase } from "@/lib/db/postgres";
import { resolveXUser } from "@/lib/sources/x";
import { EXPERT_ROSTER } from "@/seed/experts";

export async function seedExperts(): Promise<{ seeded: number; verified: number; unresolved: number }> {
  const sql = getDatabase();
  for (const expert of EXPERT_ROSTER) {
    const [stored] = await sql<{ id: string }[]>`
      insert into public.experts (slug, display_name, x_handle, headline, primary_category_slug, source_status)
      values (${expert.slug}, ${expert.displayName}, ${expert.xHandle}, ${expert.headline}, ${expert.primaryCategorySlug}, ${expert.xHandle ? "unverified" : "unresolved"})
      on conflict (slug) do update set display_name = excluded.display_name, x_handle = excluded.x_handle,
        headline = excluded.headline, primary_category_slug = excluded.primary_category_slug, updated_at = now()
      returning id
    `;
    await sql`delete from public.expert_categories where expert_id = ${stored.id}`;
    for (const category of expert.categorySlugs) {
      await sql`insert into public.expert_categories (expert_id, category_slug) values (${stored.id}, ${category}) on conflict do nothing`;
    }
  }

  let verified = 0;
  let unresolved = EXPERT_ROSTER.filter((expert) => !expert.xHandle).length;
  if (process.env.X_BEARER_TOKEN) {
    const limit = pLimit(1);
    await Promise.all(EXPERT_ROSTER.filter((expert) => expert.xHandle).map((expert) => limit(async () => {
      try {
        const user = await resolveXUser(expert.xHandle!);
        const matches = user?.username.toLowerCase() === expert.xHandle!.toLowerCase();
        if (user && matches) {
          await sql`update public.experts set x_user_id = ${user.id}, x_handle = ${user.username}, avatar_url = ${user.profileImageUrl}, source_status = 'verified', updated_at = now() where slug = ${expert.slug}`;
          verified += 1;
        } else {
          await sql`update public.experts set x_user_id = null, source_status = 'unresolved', updated_at = now() where slug = ${expert.slug}`;
          unresolved += 1;
        }
      } catch (error) {
        console.error(`X identity validation failed for ${expert.displayName}:`, error instanceof Error ? error.message : "unknown error");
        await sql`update public.experts set x_user_id = null, source_status = 'unresolved', updated_at = now() where slug = ${expert.slug}`;
        unresolved += 1;
      }
    })));
  }
  return { seeded: EXPERT_ROSTER.length, verified, unresolved };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedExperts().then((result) => console.log(`Experts seeded: ${result.seeded}\nExperts X-verified: ${result.verified}\nExperts unresolved: ${result.unresolved}`)).finally(closeDatabase);
}
