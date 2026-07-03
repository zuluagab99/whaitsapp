import { z } from "zod";
import { DEFAULT_ROUTES, type ModelTier, type RouterConfig } from "./router.js";

/**
 * Catalog of models merchants can pick from. Switching the LLM is a settings
 * change, never a code change: the dashboard renders this catalog, the API
 * validates against it, and the worker resolves it into a RouterConfig per run.
 */
export interface ModelCatalogEntry {
  provider: "anthropic" | "openai";
  model: string;
  label: string;
  /** Which tiers this model is a sensible choice for. */
  tiers: ModelTier[];
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { provider: "anthropic", model: "claude-opus-4-8", label: "Claude Opus 4.8 (best quality)", tiers: ["conversation"] },
  { provider: "anthropic", model: "claude-sonnet-5", label: "Claude Sonnet 5 (balanced)", tiers: ["conversation"] },
  { provider: "anthropic", model: "claude-haiku-4-5", label: "Claude Haiku 4.5 (fast/cheap)", tiers: ["conversation", "routing"] },
  { provider: "openai", model: "gpt-5", label: "GPT-5 (best quality)", tiers: ["conversation"] },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 mini (balanced)", tiers: ["conversation", "routing"] },
  { provider: "openai", model: "gpt-5-nano", label: "GPT-5 nano (fast/cheap)", tiers: ["routing"] },
];

const modelRouteSchema = z.object({
  provider: z.enum(["anthropic", "openai"]),
  model: z.string().min(1),
});

/** Shape of `tenants.settings.llm`. Both tiers optional — defaults fill the gaps. */
export const llmSettingsSchema = z
  .object({
    conversation: modelRouteSchema.optional(),
    routing: modelRouteSchema.optional(),
  })
  .refine(
    (s) =>
      (["conversation", "routing"] as const).every((tier) => {
        const route = s[tier];
        if (!route) return true;
        return MODEL_CATALOG.some(
          (e) => e.provider === route.provider && e.model === route.model && e.tiers.includes(tier),
        );
      }),
    { message: "model is not in the supported catalog for that tier" },
  );

export type LlmSettings = z.infer<typeof llmSettingsSchema>;

/**
 * Resolve a tenant's `settings.llm` (untrusted JSON from the DB) into a
 * RouterConfig. Invalid or missing settings fall back to platform defaults —
 * a bad settings row must never take a tenant's bot down.
 */
export function resolveRouterConfig(settings: unknown): RouterConfig {
  const parsed = llmSettingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return DEFAULT_ROUTES;
  return {
    routes: {
      conversation: parsed.data.conversation ?? DEFAULT_ROUTES.routes.conversation,
      routing: parsed.data.routing ?? DEFAULT_ROUTES.routes.routing,
    },
  };
}
