/**
 * Cross-tenant isolation tests — the plan's non-negotiable Phase 0 gate.
 * These run against a real Postgres (requires migrations applied) and are
 * skipped when TEST_DATABASE_URL is not set, so unit CI stays green without
 * a database while integration CI proves isolation.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, tenantTransaction, schema, type DbHandle } from "../src/index.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("row-level security", () => {
  let handle: DbHandle;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    handle = createDb(url!);
    const inserted = await handle.db
      .insert(schema.tenants)
      .values([{ name: "rls-test-a" }, { name: "rls-test-b" }])
      .returning({ id: schema.tenants.id });
    tenantA = inserted[0]!.id;
    tenantB = inserted[1]!.id;

    await tenantTransaction(handle.db, tenantA, async (tx) => {
      await tx.insert(schema.contacts).values({ tenantId: tenantA, waPhone: "+573001112233", name: "Ana" });
    });
    await tenantTransaction(handle.db, tenantB, async (tx) => {
      await tx.insert(schema.contacts).values({ tenantId: tenantB, waPhone: "+573009998877", name: "Beto" });
    });
  });

  afterAll(async () => {
    await handle.db.execute(sql`DELETE FROM tenants WHERE name LIKE 'rls-test-%'`);
    await handle.close();
  });

  it("a tenant sees only its own contacts", async () => {
    const rows = await tenantTransaction(handle.db, tenantA, (tx) => tx.select().from(schema.contacts));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Ana");
  });

  it("a query without tenant context sees no tenant-owned rows", async () => {
    const rows = await handle.db.select().from(schema.contacts);
    expect(rows).toHaveLength(0);
  });

  it("a tenant cannot insert rows for another tenant", async () => {
    await expect(
      tenantTransaction(handle.db, tenantA, (tx) =>
        tx.insert(schema.contacts).values({ tenantId: tenantB, waPhone: "+10000000000" }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a tenant cannot update or delete another tenant's rows", async () => {
    await tenantTransaction(handle.db, tenantA, async (tx) => {
      const updated = await tx
        .update(schema.contacts)
        .set({ name: "hacked" })
        .where(sql`wa_phone = '+573009998877'`)
        .returning();
      expect(updated).toHaveLength(0);
      const deleted = await tx
        .delete(schema.contacts)
        .where(sql`wa_phone = '+573009998877'`)
        .returning();
      expect(deleted).toHaveLength(0);
    });
  });

  it("rejects malformed tenant ids before touching the database", async () => {
    await expect(
      tenantTransaction(handle.db, "'; DROP TABLE tenants; --", async (tx) => tx.select().from(schema.contacts)),
    ).rejects.toThrow(/invalid tenant id/);
  });
});
