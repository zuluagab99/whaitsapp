import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema.js";

export * as schema from "./schema.js";
export * from "./idempotency.js";
export { sql };

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

/**
 * Create a pooled connection. The application role must NOT be the table owner
 * (owners bypass RLS); provision a dedicated `whaitsapp_app` role in production.
 */
export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

/**
 * Run `fn` inside a transaction scoped to one tenant. Sets the `app.tenant_id`
 * GUC that every RLS policy checks, so a missing WHERE tenant_id cannot leak
 * rows across tenants. SET LOCAL scopes the value to this transaction only.
 */
/**
 * Run `fn` with routing access (SELECT-only on channels/shopify_stores via the
 * routing_lookup policy). Used by webhook ingestion to resolve which tenant an
 * event belongs to — the step that happens before any tenant context exists.
 */
export async function routingTransaction<T>(db: Database, fn: (tx: Database) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.routing', 'on', true)`);
    return fn(tx as unknown as Database);
  });
}

export async function tenantTransaction<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
    throw new Error(`tenantTransaction: invalid tenant id ${JSON.stringify(tenantId)}`);
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}
