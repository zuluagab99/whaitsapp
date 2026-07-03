import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().url().default("postgres://whaitsapp:whaitsapp@localhost:5432/whaitsapp"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),

  // 32-byte hex key for AES-256-GCM encryption of tenant credentials.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "must be 32 bytes hex (openssl rand -hex 32)")
    .optional(),

  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default("v21.0"),

  SHOPIFY_API_KEY: z.string().optional(),
  SHOPIFY_API_SECRET: z.string().optional(),
  SHOPIFY_APP_URL: z.string().optional(),
  SHOPIFY_SCOPES: z
    .string()
    .default(
      "read_products,read_orders,read_customers,read_checkouts,write_draft_orders,read_inventory,read_fulfillments",
    ),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  DASHBOARD_URL: z.string().default("http://localhost:3000"),

  // Bearer token guarding the admin/settings API (LLM config, workflows CRUD).
  // Interim until dashboard auth lands; unset disables the admin routes entirely.
  ADMIN_API_TOKEN: z.string().min(16).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

/** Parse and cache configuration from the environment. Fails fast on invalid values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!cached) {
    cached = envSchema.parse(env);
  }
  return cached;
}

/** Test hook: clear the cached config. */
export function resetConfigForTests(): void {
  cached = undefined;
}
