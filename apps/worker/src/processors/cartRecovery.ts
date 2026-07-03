import { tenantTransaction, sql } from "@whaitsapp/db";
import { decideRecoveryRun } from "@whaitsapp/commerce";
import { QUEUES, type CartRecoveryJob, type OutboundMessageJob } from "@whaitsapp/shared";
import type { WorkerContext } from "../context.js";

export async function processCartRecovery(ctx: WorkerContext, job: CartRecoveryJob): Promise<void> {
  const send = await tenantTransaction(ctx.db, job.tenantId, async (tx) => {
    const cartRows = await tx.execute(
      sql`SELECT c.id, c.status, c.recovery_state, c.abandoned_checkout_url, c.items, c.value, c.currency,
                 ct.wa_phone, ct.opt_in
          FROM carts c
          LEFT JOIN contacts ct ON ct.id = c.contact_id
          WHERE c.id = ${job.cartId}`,
    );
    const cart = cartRows.rows[0] as
      | {
          id: string;
          status: string;
          recovery_state: string;
          abandoned_checkout_url: string | null;
          wa_phone: string | null;
          opt_in: boolean | null;
        }
      | undefined;
    if (!cart) return null;

    const decision = decideRecoveryRun({
      cartStatus: cart.status as "open" | "completed" | "expired",
      contactOptIn: cart.opt_in ?? false,
      recoveryState: cart.recovery_state as never,
    });
    if (decision.action === "skip") {
      ctx.logger.info({ cartId: job.cartId, reason: decision.reason }, "cart recovery skipped");
      if (cart.status === "completed") {
        await tx.execute(sql`UPDATE carts SET recovery_state = 'none' WHERE id = ${cart.id}`);
      }
      return null;
    }
    if (!cart.wa_phone) return null;

    const tplRows = await tx.execute(
      sql`SELECT name, language FROM message_templates
          WHERE category = 'MARKETING' AND status = 'approved'
          ORDER BY created_at DESC LIMIT 1`,
    );
    const tpl = tplRows.rows[0] as { name: string; language: string } | undefined;
    if (!tpl) {
      ctx.logger.warn({ tenantId: job.tenantId }, "no approved recovery template; skipping");
      return null;
    }

    await tx.execute(sql`UPDATE carts SET recovery_state = 'sent', updated_at = now() WHERE id = ${cart.id}`);

    const channelRows = await tx.execute(sql`SELECT id FROM channels WHERE status = 'active' LIMIT 1`);
    const channel = channelRows.rows[0] as { id: string } | undefined;
    if (!channel) return null;

    const outbound: OutboundMessageJob = {
      tenantId: job.tenantId,
      channelId: channel.id,
      to: cart.wa_phone,
      trigger: "campaign",
      template: {
        name: tpl.name,
        language: tpl.language,
        components: cart.abandoned_checkout_url
          ? [
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: cart.abandoned_checkout_url }],
              },
            ]
          : [],
      },
    };
    return outbound;
  });

  if (send) {
    await ctx.enqueue(QUEUES.outboundMessages, "send", send);
  }
}
