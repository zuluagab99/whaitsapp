import type { CompletionRequest, CompletionResponse, LLMProvider } from "./llm.js";

/** Task classes routed to different models: cheap-fast vs strong conversation. */
export type ModelTier = "routing" | "conversation";

export interface ModelRoute {
  provider: string;
  model: string;
}

export interface RouterConfig {
  routes: Record<ModelTier, ModelRoute>;
}

export const DEFAULT_ROUTES: RouterConfig = {
  routes: {
    routing: { provider: "anthropic", model: "claude-haiku-4-5" },
    conversation: { provider: "anthropic", model: "claude-opus-4-8" },
  },
};

/**
 * Provider-agnostic model router. Register providers, then complete against a
 * tier — the tier→model mapping is configuration, giving pricing leverage and
 * provider independence.
 */
export class ModelRouter {
  private readonly providers = new Map<string, LLMProvider>();

  constructor(private readonly config: RouterConfig = DEFAULT_ROUTES) {}

  register(provider: LLMProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  resolve(tier: ModelTier): { provider: LLMProvider; model: string } {
    const route = this.config.routes[tier];
    const provider = this.providers.get(route.provider);
    if (!provider) {
      throw new Error(`no provider registered for route ${tier} → ${route.provider}`);
    }
    return { provider, model: route.model };
  }

  async complete(tier: ModelTier, req: Omit<CompletionRequest, "model">): Promise<CompletionResponse> {
    const { provider, model } = this.resolve(tier);
    return provider.complete({ ...req, model });
  }
}
