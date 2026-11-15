import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSetupSql, SETUP_SQL_PATH } from "@/scripts/build-setup-sql";

describe("supabase/setup.sql", () => {
  it("is generated from the current migrations and roster (run `pnpm db:setup-sql`)", () => {
    expect(readFileSync(SETUP_SQL_PATH, "utf8") === buildSetupSql()).toBe(true);
  });
});
