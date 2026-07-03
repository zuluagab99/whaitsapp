import { tenantTransaction, sql } from "@whaitsapp/db";
import { checkSendPolicy, type ChannelCredentials } from "@whaitsapp/channels";
import { decryptSecret, type OutboundMessageJob } from "@whaitsapp/shared";
import type { WorkerContext } from "../context.js";

/**
 * Every outbound send routes through here: 24h-window + opt-in policy check,
 * just-in-time credential decryption, provider send, audit-trail persistence.
 */
export async function processOutboundMessage(ctx: WorkerContext, job: OutboundMessageJob): Promise<void> {
  const prepared = await tenantTransaction(ctx.db, job.tenantId, async (tx) => {
    const contactRows = await tx.execute(
      sql`SELECT id, opt_in, last_inbound_at FROM contacts WHERE wa_phone = ${job.to}`,
    );
    const contact = contactRows.rows[0] as
      | { id: string; opt_in: boolean; last_inbound_at: string | null }
      | undefined;

    const decision = checkSendPolicy({
      kind: job.template
        ? job.trigger === "campaign"
          ? "template_marketing"
          : "template_utility"
        : "freeform",
      optIn: contact?.opt_in ?? false,
      lastInboundAt: contact?.last_inbound_at ? new Date(contact.last_inbound_at) : null,
    });
    if (!decision.allowed) {
      ctx.logger.warn({ to: job.to, trigger: job.trigger, reason: decision.reason }, "outbound send blocked by policy");
      return null;
    }

    const channelRows = await tx.execute(
      sql`SELECT phone_number_id, credentials_enc FROM channels WHERE id = ${job.channelId}`,
    );
    const channel = channelRows.rows[0] as
      | { phone_number_id: string; credentials_enc: string | null }
      | undefined;
    if (!channel?.credentials_enc) {
      throw new Error(`channel ${job.channelId} has no credentials`);
    }

    const creds: ChannelCredentials = {
      accessToken: decryptSecret(channel.credentials_enc, ctx.credentialsKey),
      phoneNumberId: channel.phone_number_id,
    };
    return { creds, contactId: contact?.id ?? null };
  });

  if (!prepared) return;

  const ref = job.template
    ? await ctx.provider.sendTemplate(prepared.creds, job.to, job.template)
    : await ctx.provider.sendText(prepared.creds, job.to, job.text ?? "");

  await tenantTransaction(ctx.db, job.tenantId, async (tx) => {
    if (job.conversationId) {
      await tx.execute(
        sql`INSERT INTO messages (tenant_id, conversation_id, direction, type, body, provider_msg_id, status, trigger)
            VALUES (${job.tenantId}, ${job.conversationId}, 'outbound',
                    ${job.template ? "template" : "text"},
                    ${job.text ?? job.template?.name ?? null},
                    ${ref.providerMessageId}, 'sent', ${job.trigger})`,
      );
    }
    await tx.execute(
      sql`INSERT INTO usage_events (tenant_id, kind, qty, meta)
          VALUES (${job.tenantId}, 'wa_message', 1, ${JSON.stringify({ trigger: job.trigger })}::jsonb)`,
    );
  });
}
