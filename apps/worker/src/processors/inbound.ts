import { claimEvent, tenantTransaction, sql } from "@whaitsapp/db";
import { runAgent, resolveRouterConfig } from "@whaitsapp/ai";
import { renderTemplate, selectWorkflow } from "@whaitsapp/workflows";
import { QUEUES, type InboundMessageJob, type OutboundMessageJob } from "@whaitsapp/shared";
import type { ChatMessage as AiChatMessage } from "@whaitsapp/ai";
import type { WorkerContext } from "../context.js";
import { createToolExecutor } from "../toolExecutor.js";
import { loadEnabledWorkflows, recordWorkflowRun } from "../workflowRuntime.js";

const HISTORY_WINDOW = 20;

/**
 * Inbound message pipeline: idempotency claim → contact + conversation upsert
 * → transcript persistence → AI agent (when the bot owns the conversation)
 * → outbound enqueue. All DB work is tenant-scoped via RLS.
 */
export async function processInboundMessage(ctx: WorkerContext, job: InboundMessageJob): Promise<void> {
  const result = await tenantTransaction(ctx.db, job.tenantId, async (tx) => {
    const fresh = await claimEvent(tx, `meta:${job.providerMessageId}`, "meta");
    if (!fresh) return null;

    // Upsert contact; every inbound message re-opens the 24h service window.
    const contactRows = await tx.execute(
      sql`INSERT INTO contacts (tenant_id, wa_phone, last_inbound_at)
          VALUES (${job.tenantId}, ${job.from}, to_timestamp(${job.timestamp / 1000}))
          ON CONFLICT (tenant_id, wa_phone)
          DO UPDATE SET last_inbound_at = EXCLUDED.last_inbound_at
          RETURNING id`,
    );
    const contactId = (contactRows.rows[0] as { id: string }).id;

    // Find an open conversation or start one.
    const convRows = await tx.execute(
      sql`SELECT id, status FROM conversations
          WHERE contact_id = ${contactId} AND status != 'closed'
          ORDER BY created_at DESC LIMIT 1`,
    );
    let conversationId: string;
    let status: string;
    if (convRows.rows.length) {
      const row = convRows.rows[0] as { id: string; status: string };
      conversationId = row.id;
      status = row.status;
    } else {
      const created = await tx.execute(
        sql`INSERT INTO conversations (tenant_id, contact_id, channel_id, status, last_message_at)
            VALUES (${job.tenantId}, ${contactId}, ${job.channelId}, 'bot', now())
            RETURNING id`,
      );
      conversationId = (created.rows[0] as { id: string }).id;
      status = "bot";
    }

    await tx.execute(
      sql`INSERT INTO messages (tenant_id, conversation_id, direction, type, body, provider_msg_id, status, ts)
          VALUES (${job.tenantId}, ${conversationId}, 'inbound', ${job.type}, ${job.body ?? null},
                  ${job.providerMessageId}, 'received', to_timestamp(${job.timestamp / 1000}))
          ON CONFLICT DO NOTHING`,
    );
    await tx.execute(sql`UPDATE conversations SET last_message_at = now() WHERE id = ${conversationId}`);

    if (status !== "bot") return null; // human owns it — never auto-reply

    // Sliding window of recent transcript for the LLM.
    const historyRows = await tx.execute(
      sql`SELECT direction, body FROM messages
          WHERE conversation_id = ${conversationId} AND body IS NOT NULL
          ORDER BY ts DESC LIMIT ${HISTORY_WINDOW}`,
    );
    const history = (historyRows.rows as Array<{ direction: string; body: string }>)
      .reverse()
      .slice(0, -1) // current inbound goes in as inboundText, not history
      .map((m): AiChatMessage =>
        m.direction === "inbound" ? { role: "user", content: m.body } : { role: "assistant", content: m.body },
      );

    const tenantRows = await tx.execute(
      sql`SELECT name, settings FROM tenants WHERE id = ${job.tenantId}`,
    );
    const tenant = tenantRows.rows[0] as { name: string; settings: Record<string, unknown> } | undefined;
    const settings = tenant?.settings ?? {};

    // Merchant automations run before the AI: first enabled match wins.
    const workflows = await loadEnabledWorkflows(tx, ctx.logger);
    const event = { type: "message_received" as const, text: job.body ?? "" };
    const workflow = selectWorkflow(workflows, event);

    const replies: Array<{ text: string; trigger: "bot" | "system" }> = [];
    let handoff = false;
    let runAi = !workflow; // no workflow matched → default AI path
    let extraInstructions: string | undefined;

    if (workflow) {
      await recordWorkflowRun(tx, workflow.id, {
        tenantId: job.tenantId,
        workflowName: workflow.name,
        triggerType: "message_received",
        contactPhone: job.from,
        status: "success",
      });
      for (const action of workflow.actions) {
        if (action.type === "send_message") {
          replies.push({ text: renderTemplate(action.text, event), trigger: "system" });
        } else if (action.type === "handoff") {
          handoff = true;
          if (action.text) replies.push({ text: action.text, trigger: "system" });
        } else {
          runAi = true;
          extraInstructions = action.instructions;
        }
      }
    }

    if (runAi && !handoff) {
      const executor = createToolExecutor(tx, {
        tenantId: job.tenantId,
        contactPhone: job.from,
        conversationId,
      });

      const agentResult = await runAgent(ctx.router, executor, {
        botConfig: {
          storeName: tenant?.name ?? "the store",
          language: (settings["language"] as "es" | "en" | "auto") ?? "auto",
          ...(typeof settings["persona"] === "string" ? { persona: settings["persona"] as string } : {}),
          ...(typeof settings["policies"] === "string" ? { policies: settings["policies"] as string } : {}),
        },
        history,
        inboundText: job.body ?? "[non-text message]",
        // Model routing is per-tenant configuration (tenants.settings.llm).
        routerConfig: resolveRouterConfig(settings["llm"]),
        ...(extraInstructions !== undefined ? { extraInstructions } : {}),
      });

      // Metering: every agent run is billable usage.
      await tx.execute(
        sql`INSERT INTO usage_events (tenant_id, kind, qty, meta)
            VALUES (${job.tenantId}, 'llm_tokens', ${agentResult.usage.inputTokens + agentResult.usage.outputTokens},
                    ${JSON.stringify({ conversationId, toolCalls: agentResult.toolCallsMade.length })}::jsonb)`,
      );

      if (agentResult.guardrailFindings.length) {
        ctx.logger.warn(
          { conversationId, findings: agentResult.guardrailFindings },
          "guardrail findings on agent reply",
        );
      }

      if (agentResult.reply) replies.push({ text: agentResult.reply, trigger: "bot" });
      handoff = handoff || agentResult.handoff;
    }

    if (handoff) {
      // Pause the bot: a human owns the conversation until they close or release it.
      await tx.execute(sql`UPDATE conversations SET status = 'human' WHERE id = ${conversationId}`);
    }

    if (!replies.length) return null;
    return { conversationId, replies };
  });

  if (!result) return;

  for (const reply of result.replies) {
    const outbound: OutboundMessageJob = {
      tenantId: job.tenantId,
      channelId: job.channelId,
      to: job.from,
      trigger: reply.trigger,
      conversationId: result.conversationId,
      text: reply.text,
    };
    await ctx.enqueue(QUEUES.outboundMessages, "send", outbound);
  }
}
