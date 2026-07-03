import { tenantTransaction, sql, type Database } from "@whaitsapp/db";
import { llmSettingsSchema, type LlmSettings } from "@whaitsapp/ai";
import { workflowDefinitionSchema, type Workflow, type WorkflowDefinition } from "@whaitsapp/workflows";
import type { AdminStore } from "./admin.js";

interface WorkflowRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: unknown;
  actions: unknown;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  // Rows were validated on write; re-parse so a hand-edited row fails loudly here, not in the worker.
  const def = workflowDefinitionSchema.parse({
    name: row.name,
    enabled: row.enabled,
    trigger: row.trigger,
    actions: row.actions,
  });
  return { id: row.id, ...def };
}

/** AdminStore backed by Postgres through tenant-scoped (RLS) transactions. */
export function createAdminStore(db: Database): AdminStore {
  return {
    async getLlmSettings(tenantId) {
      return tenantTransaction(db, tenantId, async (tx) => {
        const rows = await tx.execute(sql`SELECT settings FROM tenants WHERE id = ${tenantId}`);
        const settings = (rows.rows[0] as { settings: Record<string, unknown> } | undefined)?.settings ?? {};
        const parsed = llmSettingsSchema.safeParse(settings["llm"] ?? {});
        return parsed.success ? parsed.data : {};
      });
    },

    async putLlmSettings(tenantId, llm: LlmSettings) {
      await tenantTransaction(db, tenantId, async (tx) => {
        await tx.execute(
          sql`UPDATE tenants SET settings = settings || jsonb_build_object('llm', ${JSON.stringify(llm)}::jsonb)
              WHERE id = ${tenantId}`,
        );
      });
    },

    async listWorkflows(tenantId) {
      return tenantTransaction(db, tenantId, async (tx) => {
        const rows = await tx.execute(
          sql`SELECT id, name, enabled, trigger, actions FROM workflows ORDER BY created_at`,
        );
        return (rows.rows as unknown as WorkflowRow[]).map(rowToWorkflow);
      });
    },

    async createWorkflow(tenantId, def: WorkflowDefinition) {
      return tenantTransaction(db, tenantId, async (tx) => {
        const rows = await tx.execute(
          sql`INSERT INTO workflows (tenant_id, name, enabled, trigger, actions)
              VALUES (${tenantId}, ${def.name}, ${def.enabled},
                      ${JSON.stringify(def.trigger)}::jsonb, ${JSON.stringify(def.actions)}::jsonb)
              RETURNING id, name, enabled, trigger, actions`,
        );
        return rowToWorkflow(rows.rows[0] as unknown as WorkflowRow);
      });
    },

    async updateWorkflow(tenantId, id, def: WorkflowDefinition) {
      return tenantTransaction(db, tenantId, async (tx) => {
        const rows = await tx.execute(
          sql`UPDATE workflows
              SET name = ${def.name}, enabled = ${def.enabled},
                  trigger = ${JSON.stringify(def.trigger)}::jsonb,
                  actions = ${JSON.stringify(def.actions)}::jsonb,
                  updated_at = now()
              WHERE id = ${id}
              RETURNING id, name, enabled, trigger, actions`,
        );
        const row = rows.rows[0] as unknown as WorkflowRow | undefined;
        return row ? rowToWorkflow(row) : null;
      });
    },

    async deleteWorkflow(tenantId, id) {
      return tenantTransaction(db, tenantId, async (tx) => {
        const rows = await tx.execute(sql`DELETE FROM workflows WHERE id = ${id} RETURNING id`);
        return rows.rows.length > 0;
      });
    },
  };
}
