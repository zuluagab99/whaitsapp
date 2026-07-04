import { sql, type Database } from "@whaitsapp/db";
import { renderTemplate, selectWorkflow, workflowDefinitionSchema, type Workflow, type WorkflowEvent } from "@whaitsapp/workflows";
import type { Logger, OutboundMessageJob } from "@whaitsapp/shared";

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

  const convRows = await tx.execute(
    sql`SELECT cv.id FROM conversations cv
        JOIN contacts ct ON ct.id = cv.contact_id
        WHERE ct.wa_phone = ${customerPhone} AND cv.status != 'closed'
        ORDER BY cv.created_at DESC LIMIT 1`,
  );
  const conversationId = (convRows.rows[0] as { id: string } | undefined)?.id;

  const t0 = Date.now();
  await recordWorkflowRun(tx, workflow.id, {
    tenantId,
    workflowName: workflow.name,
    triggerType: event.type,
    contactPhone: customerPhone,
    status: "success",
    durationMs: Date.now() - t0,
  });

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

/** Record a workflow match: bumps run_count on the workflow row and inserts a run log entry. */
export async function recordWorkflowRun(
  tx: Database,
  workflowId: string,
  opts: {
    tenantId: string;
    workflowName: string;
    triggerType?: string;
    contactPhone?: string;
    status?: "success" | "failed";
    error?: string;
    durationMs?: number;
  },
): Promise<void> {
  const status = opts.status ?? "success";
  await tx.execute(
    sql`UPDATE workflows SET run_count = run_count + 1, last_run_at = now() WHERE id = ${workflowId}`,
  );
  await tx.execute(
    sql`INSERT INTO workflow_runs
          (tenant_id, workflow_id, workflow_name, status, trigger_type, contact_phone, error, duration_ms, finished_at)
        VALUES
          (${opts.tenantId}, ${workflowId}, ${opts.workflowName},
           ${status}, ${opts.triggerType ?? null}, ${opts.contactPhone ?? null},
           ${opts.error ?? null}, ${opts.durationMs ?? null},
           CASE WHEN ${status} IN ('success','failed') THEN now() ELSE NULL END)`,
  );
}
