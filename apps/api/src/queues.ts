import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { QUEUES, type QueueName } from "@whaitsapp/shared";

export interface QueueRegistry {
  get(name: QueueName): Queue;
  close(): Promise<void>;
}

export function createQueues(redisUrl: string): QueueRegistry {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = new Map<QueueName, Queue>();
  for (const name of Object.values(QUEUES)) {
    queues.set(
      name,
      new Queue(name, {
        connection,
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    );
  }
  return {
    get: (name) => queues.get(name)!,
    close: async () => {
      await Promise.all([...queues.values()].map((q) => q.close()));
      connection.disconnect();
    },
  };
}
