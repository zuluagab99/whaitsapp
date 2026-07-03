import Fastify, { type FastifyInstance } from "fastify";
import type { Queue } from "bullmq";
import { MetaCloudProvider } from "@whaitsapp/channels";
import { ShopifyClient, parseShopifyWebhookHeaders } from "@whaitsapp/commerce";
import { QUEUES, type InboundMessageJob, type ShopifyEventJob } from "@whaitsapp/shared";
import { registerAdminRoutes, type AdminStore } from "./admin.js";

export interface AppDeps {
  meta: MetaCloudProvider;
  metaVerifyToken: string;
  shopify: ShopifyClient;
  queues: {
    inboundMessages: Pick<Queue, "add">;
    shopifyEvents: Pick<Queue, "add">;
  };
  /** Resolve a Meta phone_number_id to a tenant channel. Returns null when unknown. */
  resolveChannel: (phoneNumberId: string) => Promise<{ tenantId: string; channelId: string } | null>;
  /** Resolve a Shopify shop domain to a tenant. Returns null when unknown. */
  resolveShop: (shopDomain: string) => Promise<{ tenantId: string } | null>;
  /** Admin/settings API (LLM config, workflows). Omit to leave the routes unregistered. */
  admin?: { token: string; store: AdminStore };
}

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/**
 * Webhook ingestion follows three non-negotiables:
 * 1. Verify signatures against the RAW body, reject early.
 * 2. Ack fast (<1s): enqueue and return 200; all processing is async in the worker.
 * 3. Idempotency is enforced at processing time via the processed_events ledger.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: true });

  // Keep the raw bytes: HMAC verification must run over the exact payload.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString("utf8")));
    } catch {
      done(null, {});
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  if (deps.admin) {
    registerAdminRoutes(app, deps.admin.token, deps.admin.store);
  }

  // --- Meta WhatsApp Cloud API webhooks ---

  app.get("/webhooks/meta", async (req, reply) => {
    const challenge = deps.meta.verifySubscription(
      req.query as Record<string, string | undefined>,
      deps.metaVerifyToken,
    );
    if (challenge === null) return reply.code(403).send("forbidden");
    return reply.code(200).send(challenge);
  });

  app.post("/webhooks/meta", async (req, reply) => {
    const raw = { rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers };
    if (!deps.meta.verifyWebhookSignature(raw)) {
      req.log.warn("meta webhook signature verification failed");
      return reply.code(401).send({ error: "invalid signature" });
    }

    const events = deps.meta.parseInboundWebhook(raw);
    for (const event of events) {
      if (event.kind !== "message") continue; // status updates handled via separate queue later
      const channel = await deps.resolveChannel(event.phoneNumberId);
      if (!channel) {
        req.log.warn({ phoneNumberId: event.phoneNumberId }, "webhook for unknown channel");
        continue;
      }
      const job: InboundMessageJob = {
        tenantId: channel.tenantId,
        channelId: channel.channelId,
        providerMessageId: event.providerMessageId,
        from: event.from,
        type: event.type === "unsupported" ? "text" : event.type,
        ...(event.text !== undefined ? { body: event.text } : {}),
        ...(event.mediaId !== undefined ? { mediaId: event.mediaId } : {}),
        timestamp: event.timestamp,
      };
      await deps.queues.inboundMessages.add(QUEUES.inboundMessages, job, {
        jobId: `meta:${event.providerMessageId}`, // queue-level dedupe for at-least-once delivery
      });
    }
    return reply.code(200).send({ received: true });
  });

  // --- Shopify webhooks ---

  app.post("/webhooks/shopify", async (req, reply) => {
    const headers = parseShopifyWebhookHeaders(req.headers);
    if (!deps.shopify.verifyWebhookHmac(req.rawBody ?? Buffer.alloc(0), headers.hmac)) {
      req.log.warn("shopify webhook HMAC verification failed");
      return reply.code(401).send({ error: "invalid hmac" });
    }
    if (!headers.topic || !headers.shopDomain || !headers.webhookId) {
      return reply.code(400).send({ error: "missing shopify headers" });
    }

    const tenant = await deps.resolveShop(headers.shopDomain);
    if (!tenant) {
      // Unknown shop (e.g. already offboarded) — ack so Shopify stops retrying.
      req.log.warn({ shopDomain: headers.shopDomain }, "webhook for unknown shop");
      return reply.code(200).send({ received: true });
    }

    const job: ShopifyEventJob = {
      tenantId: tenant.tenantId,
      shopDomain: headers.shopDomain,
      topic: headers.topic,
      eventId: headers.webhookId,
      payload: req.body,
    };
    await deps.queues.shopifyEvents.add(QUEUES.shopifyEvents, job, {
      jobId: `shopify:${headers.webhookId}`,
    });
    return reply.code(200).send({ received: true });
  });

  return app;
}
