import type { Queue } from "bullmq";
import type { Database } from "@whaitsapp/db";
import type { ChannelProvider } from "@whaitsapp/channels";
import type { ModelRouter } from "@whaitsapp/ai";
import type { Logger, QueueName } from "@whaitsapp/shared";

/** Dependencies injected into every processor — swap for fakes in tests. */
export interface WorkerContext {
  db: Database;
  provider: ChannelProvider;
  router: ModelRouter;
  logger: Logger;
  credentialsKey: string;
  enqueue: (queue: QueueName, name: string, data: unknown, opts?: { delay?: number; jobId?: string }) => Promise<void>;
  queues: Map<QueueName, Queue>;
}
