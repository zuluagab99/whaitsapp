import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, createLogger, QUEUES, type QueueName } from "@whaitsapp/shared";
import { createDb } from "@whaitsapp/db";
import { MetaCloudProvider } from "@whaitsapp/channels";
import { AnthropicProvider, ModelRouter, OpenAIProvider } from "@whaitsapp/ai";
import type { WorkerContext } from "./context.js";
import { processInboundMessage } from "./processors/inbound.js";
import { processOutboundMessage } from "./processors/outbound.js";
import { processShopifyEvent } from "./processors/shopifyEvents.js";
import { processCartRecovery } from "./processors/cartRecovery.js";

const logger = createLogger("worker");
const config = loadConfig();

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const dbHandle = createDb(config.DATABASE_URL);

const router = new ModelRouter();
if (config.ANTHROPIC_API_KEY) router.register(new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY }));
if (config.OPENAI_API_KEY) router.register(new OpenAIProvider({ apiKey: config.OPENAI_API_KEY }));

const queues = new Map<QueueName, Queue>(
  Object.values(QUEUES).map((name) => [name, new Queue(name, { connection })]),
);

const ctx: WorkerContext = {
  db: dbHandle.db,
  provider: new MetaCloudProvider({
    appSecret: config.META_APP_SECRET ?? "",
    graphApiVersion: config.META_GRAPH_API_VERSION,
  }),
  router,
  logger,
  credentialsKey: config.CREDENTIALS_ENCRYPTION_KEY ?? "",
  queues,
  enqueue: async (queue, name, data, opts) => {
    await queues.get(queue)!.add(name, data, opts);
  },
};

const workerOpts = { connection, concurrency: 10 };

const workers = [
  new Worker(QUEUES.inboundMessages, async (job) => processInboundMessage(ctx, job.data), workerOpts),
  new Worker(QUEUES.outboundMessages, async (job) => processOutboundMessage(ctx, job.data), workerOpts),
  new Worker(QUEUES.shopifyEvents, async (job) => processShopifyEvent(ctx, job.data), workerOpts),
  new Worker(QUEUES.cartRecovery, async (job) => processCartRecovery(ctx, job.data), workerOpts),
];

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    logger.error({ queue: worker.name, jobId: job?.id, err: err.message }, "job failed");
  });
}

logger.info("worker started");

const shutdown = async () => {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  connection.disconnect();
  await dbHandle.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
