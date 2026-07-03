import { sql, type Database } from "@whaitsapp/db";
import { renderTemplate, selectWorkflow, workflowDefinitionSchema, type Workflow, type WorkflowEvent } from "@whaitsapp/workflows";
import type { Logger, OutboundMessageJob } from "@whaitsapp/shared";

/**
 * Load a tenant's enabled workflows inside an existing tenant-scoped
 * transaction, ordered by created_at (first match wins). Rows that fail
 * validation are skipped with a warning — one bad row must not break the
 * message pipeline.
 */
export async function loadEnabledWorkflows(tx: Database, logger: Logger): Promise<Workflow[]> {
  const rows = await tx.execute(
    sql`SELECT id, name, enabled, trigger, actions FROM workflows WHERE enabled ORDER BY created_at`,
  );
  const workflows: Workflow[] = [];
  for (const row of rows.rows as Array<{ id: string; name: string; enabled: boolean; trigger: unknown; actions: unknown }>) {
    const parsed = workflowDefinitionSchema.safeParse({
      name: row.name,
      enabled: row.enabled,
      trigger: row.trigger,
      actions: row.actions,
    });
    if (parsed.success) {
      workflows.push({ id: row.id, ...parsed.data });
    } else {
      logger.warn({ workflowId: row.id }, "skipping invalid workflow definition");
    }
  }
  return workflows;
}

/**
 * Evaluate order-event workflows (order_created / order_fulfilled) and build
 * the outbound sends. Only send_message actions apply to order events —
 * there is no inbound message to answer, so ai_reply/handoff are ignored.
 * The 24h-window/opt-in policy is still enforced downstream by the outbound
 * processor; this never bypasses checkSendPolicy.
 */
export async function runOrderWorkflows(
  tx: Database,
  logger: Logger,
  tenantId: string,
  event: WorkflowEvent & { type: "order_created" | "order_fulfilled" },
  customerPhone: string | null,
): Promise<OutboundMessageJob[]> {
  if (!customerPhone) return [];
  const workflows = await loadEnabledWorkflows(tx, logger);
  const workflow = selectWorkflow(workflows, event);
  if (!workflow) return [];

  const channelRows = await tx.execute(sql`SELECT id FROM channels WHERE status = 'active' LIMIT 1`);
  const channel = channelRows.rows[0] as { id: string } | undefined;
  if (!channel) return [];

  // Attach to the contact's open conversation when one exists so the send is persisted.
  const convRows = await tx.execute(
    sql`SELECT cv.id FROM conversations cv
        JOIN contacts ct ON ct.id = cv.contact_id
        WHERE ct.wa_phone = ${customerPhone} AND cv.status != 'closed'
        ORDER BY cv.created_at DESC LIMIT 1`,
  );
  const conversationId = (convRows.rows[0] as { id: string } | undefined)?.id;

  await recordWorkflowRun(tx, workflow.id);

  const jobs: OutboundMessageJob[] = [];
  for (const action of workflow.actions) {
    if (action.type !== "send_message") continue;
    jobs.push({
      tenantId,
      channelId: channel.id,
      to: customerPhone,
      trigger: "system",
      ...(conversationId !== undefined ? { conversationId } : {}),
      text: renderTemplate(action.text, event),
    });
  }
  return jobs;
}

/** Bump run stats for a matched workflow (same transaction as its side effects). */
export async function recordWorkflowRun(tx: Database, workflowId: string): Promise<void> {
  await tx.execute(
    sql`UPDATE workflows SET run_count = run_count + 1, last_run_at = now() WHERE id = ${workflowId}`,
  );
}
