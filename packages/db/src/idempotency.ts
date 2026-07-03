import { sql } from "drizzle-orm";
import type { Database } from "./index.js";
import { processedEvents } from "./schema.js";

/**
 * At-least-once delivery guard. Call inside the same transaction as the side
 * effect: returns true exactly once per event id, false for duplicates.
 */
export async function claimEvent(tx: Database, eventId: string, source: string): Promise<boolean> {
  const result = await tx
    .insert(processedEvents)
    .values({ eventId, source })
    .onConflictDoNothing()
    .returning({ eventId: processedEvents.eventId });
  return result.length > 0;
}

/** Retention: prune ledger entries older than `days` (run from a scheduled job). */
export async function pruneProcessedEvents(db: Database, days = 30): Promise<void> {
  await db.execute(sql`DELETE FROM processed_events WHERE processed_at < now() - make_interval(days => ${days})`);
}
