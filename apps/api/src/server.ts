import { loadConfig, createLogger } from "@whaitsapp/shared";
import { MetaCloudProvider } from "@whaitsapp/channels";
import { ShopifyClient } from "@whaitsapp/commerce";
import { createDb, routingTransaction, schema, sql } from "@whaitsapp/db";
import { buildApp } from "./app.js";
import { createAdminStore } from "./adminStore.js";
import { createQueues } from "./queues.js";
import { QUEUES } from "@whaitsapp/shared";

const logger = createLogger("api");
const config = loadConfig();

const dbHandle = createDb(config.DATABASE_URL);
const queues = createQueues(config.REDIS_URL);

const meta = new MetaCloudProvider({
  appSecret: config.META_APP_SECRET ?? "",
  graphApiVersion: config.META_GRAPH_API_VERSION,
});

const shopify = new ShopifyClient({
  apiKey: config.SHOPIFY_API_KEY ?? "",
  apiSecret: config.SHOPIFY_API_SECRET ?? "",
  scopes: config.SHOPIFY_SCOPES,
  appUrl: config.SHOPIFY_APP_URL ?? "",
});

const app = buildApp({
  ...(config.ADMIN_API_TOKEN
    ? { admin: { token: config.ADMIN_API_TOKEN, store: createAdminStore(dbHandle.db) } }
    : {}),
  meta,
  metaVerifyToken: config.META_WEBHOOK_VERIFY_TOKEN ?? "",
  shopify,
  queues: {
    inboundMessages: queues.get(QUEUES.inboundMessages),
    shopifyEvents: queues.get(QUEUES.shopifyEvents),
  },
  // Channel/shop resolution is what *establishes* the tenant for a webhook,
  // so it runs under the explicit SELECT-only routing policy.
  resolveChannel: async (phoneNumberId) =>
    routingTransaction(dbHandle.db, async (tx) => {
      const rows = await tx
        .select({ tenantId: schema.channels.tenantId, channelId: schema.channels.id })
        .from(schema.channels)
        .where(sql`phone_number_id = ${phoneNumberId}`);
      const row = rows[0];
      return row ? { tenantId: row.tenantId, channelId: row.channelId } : null;
    }),
  resolveShop: async (shopDomain) =>
    routingTransaction(dbHandle.db, async (tx) => {
      const rows = await tx
        .select({ tenantId: schema.shopifyStores.tenantId })
        .from(schema.shopifyStores)
        .where(sql`shop_domain = ${shopDomain}`);
      const row = rows[0];
      return row ? { tenantId: row.tenantId } : null;
    }),
});

const shutdown = async () => {
  await app.close();
  await queues.close();
  await dbHandle.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app
  .listen({ port: config.PORT, host: "0.0.0.0" })
  .then(() => logger.info({ port: config.PORT }, "api listening"))
  .catch((err) => {
    logger.error(err, "failed to start api");
    process.exit(1);
  });
